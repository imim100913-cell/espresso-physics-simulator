import * as THREE from "three";
// Reference SSFR pass for a future particle solver. The live mobile renderer uses
// analytic strands; this pass accepts solver positions without prescribing dynamics.
export class ScreenSpaceFluid {
  constructor(width, height, { radius = 0.018, metersPerUnit = 0.05 } = {}) {
    this.width = width;
    this.height = height;
    const rt = () =>
      new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
      });
    this.depth = rt();
    this.blurA = rt();
    this.blurB = rt();
    this.thickness = rt();
    this.output = rt();
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const pointVertex = /* glsl */ `uniform float uRadius,uHeight;varying vec3 vCenter;void main(){vec4 v=modelViewMatrix*vec4(position,1.);vCenter=v.xyz;gl_Position=projectionMatrix*v;gl_PointSize=2.*uRadius*projectionMatrix[1][1]*uHeight*.5/max(.001,-v.z);}`;
    const uniforms = { uRadius: { value: radius }, uHeight: { value: height } };
    this.depthMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: pointVertex,
      fragmentShader: /* glsl */ `uniform mat4 projectionMatrix;uniform float uRadius;varying vec3 vCenter;void main(){vec2 xy=gl_PointCoord*2.-1.;float r2=dot(xy,xy);if(r2>1.)discard;float z=sqrt(1.-r2)*uRadius;vec3 p=vCenter+vec3(xy*uRadius,z);vec4 clip=projectionMatrix*vec4(p,1.);gl_FragDepth=clip.z/clip.w*.5+.5;gl_FragColor=vec4(-p.z,0.,0.,1.);}`,
    });
    this.thicknessMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: pointVertex,
      fragmentShader: /* glsl */ `uniform float uRadius;void main(){vec2 p=gl_PointCoord*2.-1.;float d=dot(p,p);if(d>1.)discard;gl_FragColor=vec4(2.*uRadius*sqrt(1.-d),0.,0.,1.);}`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fullscreen = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
    this.bilateral = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: null },
        uDirection: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uSigma: { value: radius * 2 },
      },
      vertexShader: fullscreen,
      fragmentShader: /* glsl */ `varying vec2 vUv;uniform sampler2D uDepth;uniform vec2 uTexel,uDirection;uniform float uSigma;void main(){float center=texture2D(uDepth,vUv).r;if(center<=0.){gl_FragColor=vec4(0.);return;}float total=0.,weight=0.;for(int i=-4;i<=4;i++){float z=texture2D(uDepth,vUv+uDirection*uTexel*float(i)).r;if(z<=0.)continue;float delta=(z-center)/uSigma;float w=exp(-float(i*i)/8.-delta*delta*.5);total+=z*w;weight+=w;}gl_FragColor=vec4(total/max(weight,.00001),0.,0.,1.);}`,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        uDepth: { value: this.blurB.texture },
        uThickness: { value: this.thickness.texture },
        uScene: { value: null },
        uSceneDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uInverseProjection: { value: new THREE.Matrix4() },
        uTDS: { value: 10 },
        uMeters: { value: metersPerUnit },
      },
      vertexShader: fullscreen,
      fragmentShader: /* glsl */ `
      varying vec2 vUv;uniform sampler2D uDepth,uThickness,uScene,uSceneDepth;uniform vec2 uTexel;uniform mat4 uInverseProjection;uniform float uTDS,uMeters;
      vec3 viewPosition(vec2 uv,float depth){vec4 ray=uInverseProjection*vec4(uv*2.-1.,1.,1.);return ray.xyz*(-depth/ray.z);}
      void main(){vec4 opaque=texture2D(uScene,vUv);float z=texture2D(uDepth,vUv).r;
        float raw=texture2D(uSceneDepth,vUv).r;vec4 sceneView=uInverseProjection*vec4(vUv*2.-1.,raw*2.-1.,1.);float opaqueZ=-sceneView.z/sceneView.w;
        if(z<=0.||z>opaqueZ){gl_FragColor=opaque;return;}
        vec3 p=viewPosition(vUv,z);float zx=texture2D(uDepth,vUv+vec2(uTexel.x,0.)).r,zy=texture2D(uDepth,vUv+vec2(0.,uTexel.y)).r;
        vec3 dx=viewPosition(vUv+vec2(uTexel.x,0.),zx>0.?zx:z)-p,dy=viewPosition(vUv+vec2(0.,uTexel.y),zy>0.?zy:z)-p;
        vec3 n=normalize(cross(dx,dy));if(n.z<0.)n=-n;vec3 v=normalize(-p);
        float fresnel=.0204+(1.-.0204)*pow(1.-max(0.,dot(n,v)),5.);
        float path=texture2D(uThickness,vUv).r*uMeters;vec3 transmittance=exp(-vec3(200.,650.,1200.)*(uTDS/10.)*path);
        vec2 offset=n.xy*.012;vec3 transmitted=texture2D(uScene,clamp(vUv+offset,vec2(.001),vec2(.999))).rgb*transmittance;
        vec3 reflection=vec3(.75,.78,.73)*(.2+.8*pow(max(0.,dot(reflect(-v,n),normalize(vec3(1.,2.,3.)))),16.));
        gl_FragColor=vec4(mix(transmitted,reflection,fresnel),1.);
      }`,
    });
    this.particles = new THREE.Points(
      new THREE.BufferGeometry(),
      this.depthMaterial,
    );
    this.particles.frustumCulled = false;
    this.particleScene = new THREE.Scene();
    this.particleScene.add(this.particles);
  }
  render(renderer, positions, count, sceneColor, sceneDepth, camera, tds = 10) {
    if (!sceneColor || !sceneDepth)
      throw new Error("SSFR requires opaque color and depth textures");
    const previousTarget = renderer.getRenderTarget(),
      clear = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha(),
      autoClear = renderer.autoClear;
    try {
      const geometry = this.particles.geometry,
        attr = geometry.getAttribute("position");
      if (!attr || attr.array !== positions)
        geometry.setAttribute(
          "position",
          new THREE.BufferAttribute(positions, 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
      else attr.needsUpdate = true;
      geometry.setDrawRange(0, Math.min(count, positions.length / 3));
      renderer.setClearColor(0, 0);
      renderer.autoClear = true;
      this.particles.material = this.depthMaterial;
      renderer.setRenderTarget(this.depth);
      renderer.clear();
      renderer.render(this.particleScene, camera);
      this.particles.material = this.thicknessMaterial;
      renderer.setRenderTarget(this.thickness);
      renderer.clear();
      renderer.render(this.particleScene, camera);
      this.quad.material = this.bilateral;
      this.bilateral.uniforms.uDepth.value = this.depth.texture;
      this.bilateral.uniforms.uDirection.value.set(1, 0);
      renderer.setRenderTarget(this.blurA);
      renderer.render(this.scene, this.camera);
      this.bilateral.uniforms.uDepth.value = this.blurA.texture;
      this.bilateral.uniforms.uDirection.value.set(0, 1);
      renderer.setRenderTarget(this.blurB);
      renderer.render(this.scene, this.camera);
      this.composite.uniforms.uScene.value = sceneColor;
      this.composite.uniforms.uSceneDepth.value = sceneDepth;
      this.composite.uniforms.uInverseProjection.value.copy(
        camera.projectionMatrixInverse,
      );
      this.composite.uniforms.uTDS.value = tds;
      this.quad.material = this.composite;
      renderer.setRenderTarget(this.output);
      renderer.render(this.scene, this.camera);
      return this.output.texture;
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, alpha);
      renderer.autoClear = autoClear;
    }
  }
  dispose() {
    for (const target of [
      this.depth,
      this.blurA,
      this.blurB,
      this.thickness,
      this.output,
    ])
      target.dispose();
    for (const m of [
      this.depthMaterial,
      this.thicknessMaterial,
      this.bilateral,
      this.composite,
    ])
      m.dispose();
    this.quad.geometry.dispose();
    this.particles.geometry.dispose();
  }
}
