import * as THREE from "three";
export const noiseGLSL = /* glsl */ `
float hash31(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float worley(vec3 p){vec3 cell=floor(p),f=fract(p);float d=2.;for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 o=vec3(float(x),float(y),float(z));vec3 q=vec3(hash31(cell+o),hash31(cell+o+17.),hash31(cell+o+37.));d=min(d,length(o+q-f));}return d;}
`;
export const bedVertexGLSL = /* glsl */ `
uniform float uFill,uCompact,uHeight,uDeform;
varying vec3 vBed;
float bedHeight(vec2 xz){float r=clamp(length(xz)/.445,0.,1.);float heap=(1.-r*r)*.14*(1.-uCompact);return max(.001,(uHeight+heap)*uFill*(1.-.24*uCompact));}
`;
export const bedFragmentGLSL = /* glsl */ `
uniform float uFill,uCompact,uHeight,uWet,uRisk;
varying vec3 vBed;
${noiseGLSL}
float channel(vec2 xz){vec2 center=vec2(.14,-.11);return exp(-dot(xz-center,xz-center)/.0016)*uRisk;}
float moisture(vec3 p){float localTop=(uHeight+(1.-clamp(dot(p.xz,p.xz)/.198,0.,1.))*.14*(1.-uCompact))*uFill*(1.-.24*uCompact);float depth=(localTop-p.y)/max(localTop,.001);float front=uWet*(1.45+channel(p.xz)*.65)-.08;return smoothstep(depth-.06,depth+.06,front);}
`;
export function powderUniforms() {
  return {
    uFill: { value: 0 },
    uCompact: { value: 0 },
    uHeight: { value: 0.25 },
    uDeform: { value: 1 },
    uWet: { value: 0 },
    uRisk: { value: 0 },
  };
}
function deformVertex(shader, uniforms, deform = true) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = bedVertexGLSL + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>
    ${deform ? "transformed.y = (position.y+.5)*bedHeight(position.xz);" : ""}
    vBed=transformed;`,
  );
  if (deform)
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
    if(normal.y>.5){float h=bedHeight(position.xz);objectNormal=normalize(vec3((h-bedHeight(position.xz+vec2(.002,0.)))/.002,1.,(h-bedHeight(position.xz+vec2(0.,.002)))/.002));}`,
    );
}
export function powderMaterial(uniforms, deform = true) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
  });
  m.onBeforeCompile = (shader) => {
    deformVertex(shader, uniforms, deform);
    shader.fragmentShader = bedFragmentGLSL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      float wet=moisture(vBed);float n=noise3(vBed*240.);float speck=step(.79,hash31(floor(vBed*430.)));
      vec3 dry=mix(vec3(.035,.011,.003),vec3(.095,.035,.009),n);
      vec3 damp=mix(vec3(.014,.006,.003),vec3(.055,.019,.007),n);
      diffuseColor.rgb=mix(dry,damp,wet)*(1.-uCompact*.16)+speck*.012;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.17,.072,.022),channel(vBed.xz)*wet*.35);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      roughnessFactor=mix(.98,.56,moisture(vBed));`,
    );
  };
  m.customProgramCacheKey = () => `powder-${deform}`;
  return m;
}
export function powderDepth(uniforms, stencil = false) {
  const m = stencil
    ? new THREE.MeshBasicMaterial()
    : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => deformVertex(s, uniforms);
  m.customProgramCacheKey = () => `bed-depth-${stencil}`;
  return m;
}
export function microPowderMaterial(uniforms, pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uPixelRatio: { value: pixelRatio } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `${bedVertexGLSL}
uniform float uPixelRatio;attribute float aSeed;varying float vSeed;
void main(){vec3 p=position;p.y=bedHeight(p.xz)+.0015+aSeed*.001;vBed=p;vSeed=aSeed;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((1.2+aSeed*1.2)*uPixelRatio*4./-mv.z,.8,3.5);}`,
    fragmentShader: /* glsl */ `${bedFragmentGLSL}
uniform float uCut;varying float vSeed;void main(){vec2 p=gl_PointCoord-.5;if(dot(p,p)>.25||uFill<.01||(uCut>.5&&vBed.z>0.))discard;vec3 c=mix(vec3(.10,.035,.009),vec3(.025,.007,.002),moisture(vBed));gl_FragColor=vec4(c*(.8+vSeed*.4),.55);#include <tonemapping_fragment>
#include <colorspace_fragment>}`.replace(";#include", ";\n#include"),
  });
}
export function cremaMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uTDS: { value: 10 },
  };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.48,
    clearcoat: 0.28,
    clearcoatRoughness: 0.25,
  });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = "varying vec3 vCrema;\n" + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvCrema=vec3(position.x,0.,position.y);",
    );
    s.fragmentShader =
      `varying vec3 vCrema;uniform float uTime,uLevel,uTDS;\n${noiseGLSL}` +
      s.fragmentShader;
    s.fragmentShader = s.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 p=vCrema.xz;float r=length(p);float a=atan(p.y,p.x+.000001)+uTime*.09*exp(-r*3.);
      vec3 advected=vec3(cos(a)*r,sin(a)*r,uTime*.018);
      float cell=worley(advected*55.);float streak=noise3(advected*18.+vec3(0.,uTime*.02,0.));
      float bubble=smoothstep(.20,.26,cell);float tiger=smoothstep(.37,.63,streak);
      diffuseColor.rgb=mix(vec3(.16,.045,.012),vec3(.66,.37,.13),tiger)*mix(.7,1.1,bubble);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.77,.55,.29),smoothstep(.34,.4,r)*.5);`,
    );
  };
  m.customProgramCacheKey = () => "crema-worley";
  return { material: m, uniforms };
}
export const steamVertex = /* glsl */ `
attribute float aSeed;uniform float uTime,uAmount;varying float vAlpha;
void main(){float age=fract(aSeed+uTime*.09);vec3 p=position;p.y+=age*.7;p.x+=sin(age*5.+aSeed*40.)*.07*age;p.z+=cos(age*7.+aSeed*29.)*.04*age;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((20.+age*55.)*2./-mv.z,2.,45.);vAlpha=sin(age*3.14159)*.05*uAmount;}`;
export const steamFragment = /* glsl */ `
varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.85,.81,.74,exp(-r*r*5.)*vAlpha);}`;
