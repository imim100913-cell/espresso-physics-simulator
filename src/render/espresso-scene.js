import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";
import {
  turned,
  roundedProfile,
  beanGeometry,
  spiralBurr,
  perforatedPlate,
  woodTexture,
} from "./geometry.js";
import {
  powderUniforms,
  powderMaterial,
  powderDepth,
  microPowderMaterial,
} from "./shaders.js";
import { capSolid } from "./cutaway.js";
import { LiquidSurface, smooth } from "./fluid.js";

const yBasket = 1.3,
  clamp = THREE.MathUtils.clamp;
const presets = {
  wide: { eye: [3.1, 2.65, 4.8], target: [-0.38, 1.55, 0] },
  section: { eye: [1.55, 2.05, 3.4], target: [0, 1.4, 0] },
  stream: { eye: [1.2, 1.35, 2.8], target: [0, 0.87, 0] },
};
export class EspressoScene {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.config = {
      dose: 18,
      grindSize: 380,
      tampForce: 15,
      waterTemp: 93,
      maxPressure: 9,
      targetYield: 36,
    };
    this.mobile =
      options.mobile ??
      (/Android|iPhone|iPad/i.test(navigator.userAgent) ||
        matchMedia("(max-width: 700px)").matches);
    this.quality = options.quality ?? (this.mobile ? "low" : "balanced");
    this.currentTime = 0;
    this.cutaway = true;
    this.isRunning = false;
    this.disposed = false;
    this.lastFrame = 0;
    this.view = "wide";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x131a18);
    this.scene.fog = new THREE.FogExp2(0x131a18, 0.065);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
    this.camera.position.fromArray(presets.wide.eye);
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== "low",
      alpha: false,
      stencil: true,
      powerPreference: "low-power",
    });
    this.renderer.debug.onShaderError = () => {
      this.renderError = new Error("3Dシェーダーを利用できません");
      console.error("WebGL shader compilation failed");
    };
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio || 1,
        this.quality === "low" ? 1 : this.mobile ? 1.25 : 1.75,
      ),
    );
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = this.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.dataset.renderer = "espresso-pbr";
    this.container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.fromArray(presets.wide.target);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.57;
    this.controls.addEventListener("start", () => (this.cameraMotion = null));
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    room.dispose();
    pmrem.dispose();
    this.reflective = [];
    this.sections = [];
    this.buildLighting();
    this.buildMachine();
    this.buildPowder();
    this.buildDosing();
    // The guided journey introduces preparation tools in dedicated SVG scenes.
    this.preparationTools.visible = !options.extractionOnly;
    this.beans.visible = !options.extractionOnly;
    this.liquid = new LiquidSurface(this.scene, {
      top: yBasket - 0.015,
      bottom: 0.2,
      mobile: this.mobile,
    });
    this.setCutaway(true);
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(this.container);
    this.onResize();
    this.renderer.domElement.addEventListener("webglcontextlost", () => {
      this.isRunning = false;
      cancelAnimationFrame(this.raf);
    });
    this.animate = this.animate.bind(this);
    this.raf = requestAnimationFrame(this.animate);
  }
  buildLighting() {
    this.scene.add(new THREE.HemisphereLight(0xeeeeea, 0x342b1f, 1));
    const key = new THREE.SpotLight(0xffe7c7, 90, 15, Math.PI * 0.23, 0.5, 1.7);
    key.position.set(2.8, 5.8, 3.1);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.mobile ? 512 : 1024, this.mobile ? 512 : 1024);
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.015;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xc8e1e4, 3);
    rim.position.set(-3, 4, -3);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffe6bb, 1.3);
    fill.position.set(1, 1, 5);
    this.scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x161d18, roughness: 0.82 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }
  mesh(g, m, parent = this.scene, x = 0, y = 0, z = 0) {
    const obj = new THREE.Mesh(g, m);
    obj.position.set(x, y, z);
    obj.castShadow = obj.receiveShadow = true;
    parent.add(obj);
    if (m.metalness > 0.7) this.reflective.push(obj);
    return obj;
  }
  buildMachine() {
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.chrome = new THREE.MeshPhysicalMaterial({
      color: 0xdce1de,
      metalness: 1,
      roughness: 0.17,
      anisotropy: 0.65,
      anisotropyRotation: Math.PI / 2,
    });
    this.brushed = new THREE.MeshPhysicalMaterial({
      color: 0xb6bbb7,
      metalness: 1,
      roughness: 0.32,
      anisotropy: 0.85,
    });
    const brass = new THREE.MeshPhysicalMaterial({
      color: 0xb49b65,
      metalness: 1,
      roughness: 0.28,
      anisotropy: 0.5,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x161b17,
      roughness: 0.8,
    });
    const wood = new THREE.MeshPhysicalMaterial({
      color: 0xc28a57,
      map: woodTexture(),
      roughness: 0.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
    });
    const ceramic = new THREE.MeshPhysicalMaterial({
      color: 0xf7edcf,
      roughness: 0.23,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xf5f0e3,
      roughness: 0.08,
      transmission: 1,
      thickness: 0.025,
      ior: 1.48,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.mesh(
      turned(roundedProfile(0.75, 0.1, 0.035)),
      this.brushed,
      this.scene,
      0,
      -0.01,
      0,
    );
    // Closed basket wall with a rolled bead, interior wall, and stepped heel.
    const profile = [
      [0.445, 0],
      [0.49, -0.025],
      [0.516, -0.005],
      [0.53, 0.32],
      [0.552, 0.34],
      [0.559, 0.36],
      [0.552, 0.38],
      [0.52, 0.388],
      [0.495, 0.37],
      [0.481, 0.32],
      [0.445, 0.015],
      [0.445, 0],
    ];
    const capGeometry = new THREE.PlaneGeometry(1.14, 0.48).translate(
      0,
      0.19,
      0,
    );
    this.basket = capSolid({
      parent: this.scene,
      geometry: turned(profile, 128),
      material: this.chrome.clone(),
      plane: this.clipPlane,
      capGeometry,
      capMaterial: brass.clone(),
      order: 20,
    });
    this.basket.group.position.y = yBasket;
    this.sections.push(this.basket);
    this.reflective.push(this.basket.skin);
    this.plate = this.mesh(
      perforatedPlate(),
      this.brushed.clone(),
      this.scene,
      0,
      yBasket,
      0,
    );
    this.plate.material.clippingPlanes = [this.clipPlane];
    this.plate.material.clipShadows = true;
    // Rounded wood grip, metal ferrule and end cap, aligned along the x axis.
    const handle = this.mesh(
      turned(
        [
          [0, 0],
          [0.07, 0],
          [0.09, 0.04],
          [0.1, 0.1],
          [0.092, 0.25],
          [0.105, 0.5],
          [0.115, 0.74],
          [0.108, 0.8],
          [0.08, 0.83],
          [0, 0.84],
        ],
        64,
      ),
      wood,
      this.scene,
      0.49,
      yBasket + 0.18,
      0,
    );
    handle.rotation.z = -Math.PI / 2;
    const ferrule = this.mesh(
      turned(roundedProfile(0.104, 0.16, 0.01)),
      this.chrome,
      this.scene,
      0.57,
      yBasket + 0.18,
      0,
    );
    ferrule.rotation.z = Math.PI / 2;
    const cupProfile = [
      [0, 0],
      [0.26, 0],
      [0.31, 0.025],
      [0.35, 0.1],
      [0.382, 0.35],
      [0.39, 0.4],
      [0.382, 0.415],
      [0.367, 0.415],
      [0.358, 0.39],
      [0.338, 0.15],
      [0.3, 0.09],
      [0, 0.09],
      [0, 0],
    ];
    this.cupBody = this.mesh(
      turned(cupProfile, 128),
      ceramic,
      this.scene,
      0,
      0.08,
      0,
    );
    const cupHandle = this.mesh(
      new THREE.TorusGeometry(0.135, 0.034, 16, 48, Math.PI * 1.6),
      ceramic,
      this.scene,
      0.39,
      0.3,
      0,
    );
    this.cupHandle = cupHandle;
    cupHandle.rotation.z = -Math.PI * 0.8;
    this.mesh(
      turned(
        [
          [0, 0],
          [0.4, 0],
          [0.52, 0.015],
          [0.56, 0.04],
          [0.56, 0.055],
          [0.52, 0.065],
          [0.39, 0.06],
          [0.32, 0.04],
          [0, 0.04],
          [0, 0],
        ],
        96,
      ),
      ceramic,
      this.scene,
      0,
      0.005,
      0,
    );
    // Rear stand makes every part visibly supported rather than floating.
    this.mesh(
      turned(roundedProfile(0.12, 2.5, 0.035)),
      this.brushed,
      this.scene,
      0,
      1.18,
      -0.67,
    );
    const arm = this.mesh(
      turned(roundedProfile(0.15, 0.7, 0.035)),
      this.brushed,
      this.scene,
      0,
      1.85,
      -0.34,
    );
    arm.rotation.x = Math.PI / 2;
    this.head = new THREE.Group();
    this.head.position.y = yBasket + 0.6;
    this.scene.add(this.head);
    const headProfile = [
      [0, 0],
      [0.38, 0],
      [0.47, 0.025],
      [0.49, 0.08],
      [0.47, 0.15],
      [0.42, 0.18],
      [0.42, 0.24],
      [0.46, 0.27],
      [0.46, 0.31],
      [0.4, 0.35],
      [0, 0.35],
      [0, 0],
    ];
    const head = capSolid({
      parent: this.head,
      geometry: turned(headProfile, 96),
      material: this.chrome.clone(),
      plane: this.clipPlane,
      capGeometry: new THREE.PlaneGeometry(1.1, 0.4).translate(0, 0.17, 0),
      capMaterial: this.brushed.clone(),
      order: 30,
    });
    this.sections.push(head);
    this.mesh(
      turned(roundedProfile(0.41, 0.018, 0.005)),
      this.brushed,
      this.head,
      0,
      0.005,
      0,
    );
    this.preparationTools = new THREE.Group();
    this.scene.add(this.preparationTools);
    this.tamper = new THREE.Group();
    this.preparationTools.add(this.tamper);
    this.mesh(
      turned(roundedProfile(0.439, 0.055, 0.015)),
      this.brushed,
      this.tamper,
    );
    this.mesh(
      turned(
        [
          [0, 0],
          [0.08, 0],
          [0.075, 0.09],
          [0.13, 0.19],
          [0.15, 0.28],
          [0.12, 0.34],
          [0, 0.35],
          [0, 0],
        ],
        64,
      ),
      wood,
      this.tamper,
      0,
      0.025,
      0,
    );
    this.grinder = new THREE.Group();
    this.grinder.position.set(-1.05, 0, -0.05);
    this.preparationTools.add(this.grinder);
    this.mesh(
      turned(roundedProfile(0.09, 1.8, 0.025)),
      this.brushed,
      this.preparationTools,
      -1.12,
      0.85,
      -0.24,
    );
    this.mesh(
      turned(roundedProfile(0.34, 0.1, 0.025)),
      rubber,
      this.preparationTools,
      -1.12,
      -0.01,
      -0.24,
    );
    this.tamperArm = this.mesh(
      turned(roundedProfile(0.025, 1, 0.008), 32),
      this.brushed,
      this.preparationTools,
    );
    this.armAnchor = new THREE.Vector3(0, 2.37, -0.67);
    this.armEnd = new THREE.Vector3();
    this.armDirection = new THREE.Vector3();
    this.upAxis = new THREE.Vector3(0, 1, 0);
    this.mesh(
      turned(roundedProfile(0.3, 0.42, 0.055)),
      this.brushed,
      this.grinder,
      0,
      2.05,
      0,
    );
    this.mesh(
      turned(
        [
          [0.2, 0],
          [0.28, 0],
          [0.3, 0.04],
          [0.3, 0.11],
          [0.26, 0.15],
          [0.2, 0.15],
          [0.2, 0],
        ],
        96,
      ),
      this.chrome,
      this.grinder,
      0,
      2.25,
      0,
    );
    this.burr = this.mesh(spiralBurr(), brass, this.grinder, 0, 2.4, 0);
    this.mesh(
      turned(
        [
          [0.11, 0],
          [0.13, 0.08],
          [0.36, 0.44],
          [0.37, 0.48],
          [0.35, 0.49],
          [0.34, 0.45],
          [0.1, 0.085],
          [0.09, 0],
          [0.11, 0],
        ],
        96,
      ),
      glass,
      this.grinder,
      0,
      2.4,
      0,
    );
    this.mesh(
      turned(
        [
          [0.33, 0],
          [0.38, 0],
          [0.39, 0.015],
          [0.38, 0.04],
          [0.33, 0.04],
          [0.33, 0],
        ],
        96,
      ),
      rubber,
      this.grinder,
      0,
      2.87,
      0,
    );
    const chutePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1, 2.04, 0.12),
      new THREE.Vector3(-0.52, 2.08, 0.1),
      new THREE.Vector3(0, 1.94, 0.03),
    ]);
    this.chute = this.mesh(
      new THREE.TubeGeometry(chutePath, 40, 0.038, 12, false),
      this.brushed,
      this.preparationTools,
    );
    // Hidden during tamping by mechanical translation, never a hard visibility cut.
    this.mesh(
      turned(roundedProfile(0.29, 0.08, 0.025)),
      rubber,
      this.grinder,
      0,
      1.81,
      0,
    );
  }
  buildPowder() {
    this.powder = powderUniforms();
    this.powder.uCut = { value: 1 };
    const geometry = new THREE.CylinderGeometry(0.442, 0.438, 1, 96, 20, false);
    const skin = powderMaterial(this.powder),
      cap = powderMaterial(this.powder, false);
    const capGeometry = new THREE.PlaneGeometry(0.9, 0.6).translate(0, 0.3, 0);
    this.bed = capSolid({
      parent: this.scene,
      geometry,
      material: skin,
      plane: this.clipPlane,
      capGeometry,
      capMaterial: cap,
      order: 40,
      depthFactory: () => powderDepth(this.powder, true),
    });
    this.bed.group.position.y = yBasket + 0.018;
    this.bed.skin.customDepthMaterial = powderDepth(this.powder);
    this.bed.skin.customDepthMaterial.clippingPlanes = [this.clipPlane];
    this.bed.skin.customDepthMaterial.clipShadows = true;
    this.sections.push(this.bed);
    const count = this.mobile ? 9000 : 28000,
      g = new THREE.BufferGeometry(),
      positions = new Float32Array(count * 3),
      seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = i * 2.399963,
        r = Math.sqrt((i + 0.5) / count) * 0.438;
      positions.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      seeds[i] = (i * 0.618034) % 1;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.micro = new THREE.Points(
      g,
      microPowderMaterial(this.powder, this.renderer.getPixelRatio()),
    );
    this.micro.position.y = yBasket + 0.018;
    this.micro.frustumCulled = false;
    this.scene.add(this.micro);
  }
  buildDosing() {
    const geometry = beanGeometry(),
      material = new THREE.MeshStandardMaterial({
        color: 0x633217,
        roughness: 0.62,
      });
    this.beans = new THREE.InstancedMesh(geometry, material, 34);
    this.beans.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beans.castShadow = true;
    this.beans.frustumCulled = false;
    this.scene.add(this.beans);
    this.dummy = new THREE.Object3D();
    const count = this.mobile ? 900 : 2200,
      position = new Float32Array(count * 3),
      seeds = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.dosingPowder = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0x734225,
        size: 0.009,
        sizeAttenuation: true,
      }),
    );
    this.dosingPowder.frustumCulled = false;
    this.scene.add(this.dosingPowder);
    this.doseCount = count;
  }
  updateConfig(params) {
    Object.assign(this.config, params);
    this.powder.uHeight.value = clamp(
      (0.235 * (params.dose || 18)) / 18,
      0.13,
      0.32,
    );
    this.powder.uRisk.value = clamp(
      ((params.grindSize < 260 ? (260 - params.grindSize) * 0.6 : 0) +
        Math.max(0, (params.maxPressure || 9) - 9.5) * 12) /
        100,
      0,
      0.9,
    );
  }
  start(duration) {
    this.maxTime = duration;
    this.isRunning = true;
    this.currentTime = 0;
    this.config.sample = { t: 0, p: 0, q: 0, yield: 0, tdsCup: 0 };
    this.setView("wide");
    this.step3DPhysics(0);
  }
  stop() {
    this.isRunning = false;
    this.cameraMotion = null;
  }
  setCutaway(enabled) {
    this.cutaway = enabled;
    this.sections.forEach((s) => s.setEnabled(enabled));
    this.plate.material.clippingPlanes = enabled ? [this.clipPlane] : [];
    this.plate.material.needsUpdate = true;
    if (this.powder) this.powder.uCut.value = enabled ? 1 : 0;
    for (const pass of [this.ao, this.ssr, this.dof])
      if (pass) pass.enabled = !enabled;
  }
  setView(name) {
    if (!presets[name]) return;
    this.view = name;
    this.cameraMotion = {
      from: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      to: new THREE.Vector3(...presets[name].eye),
      target: new THREE.Vector3(...presets[name].target),
      start: performance.now(),
    };
  }
  setQuality(quality) {
    if (!["low", "balanced", "cinematic"].includes(quality)) return;
    if (
      quality === "cinematic" &&
      !this.renderer.extensions.has("EXT_color_buffer_float")
    )
      quality = "balanced";
    this.quality = quality;
    this.disposeComposer();
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio || 1,
        quality === "low" ? 1 : this.mobile ? 1.25 : 1.75,
      ),
    );
    this.renderer.shadowMap.enabled = quality !== "low";
    if (quality === "cinematic") {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        stencilBuffer: true,
        samples: 0,
      });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.ao = new SSAOPass(this.scene, this.camera, 256, 256, 12);
      this.ao.kernelRadius = 0.1;
      this.ao.minDistance = 0.002;
      this.ao.maxDistance = 0.18;
      // SSR samples only selected metal surfaces. Off-screen detail stays in PMREM.
      this.ssr = new SSRPass({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        width: 256,
        height: 256,
        selects: this.reflective,
        bouncing: false,
      });
      this.ssr.opacity = 0.25;
      this.ssr.maxDistance = 1.6;
      this.ssr.thickness = 0.035;
      this.ssr.resolutionScale = 0.5;
      this.composer.addPass(this.ssr);
      this.composer.addPass(this.ao);
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(256, 256),
        0.035,
        0.2,
        4.0,
      );
      // An invalid or extreme specular texel must not contaminate the blur pyramid.
      const highPass = this.bloom.materialHighPassFilter;
      highPass.fragmentShader = highPass.fragmentShader.replace(
        "vec4 texel = texture2D( tDiffuse, vUv );",
        "vec4 texel = texture2D( tDiffuse, vUv );\nif(any(notEqual(texel.rgb,texel.rgb)))texel.rgb=vec3(0.);\ntexel.rgb=clamp(texel.rgb,vec3(0.),vec3(64.));",
      );
      this.composer.addPass(this.bloom);
      this.dof = new BokehPass(this.scene, this.camera, {
        focus: 4,
        aperture: 0.00065,
        maxblur: 0.004,
      });
      this.composer.addPass(this.dof);
      this.composer.addPass(new OutputPass());
    }
    for (const pass of [this.ao, this.ssr, this.dof])
      if (pass) pass.enabled = !this.cutaway;
    this.sizeKey = null;
    this.onResize();
  }
  disposeComposer() {
    if (this.composer) {
      this.composer.passes.forEach((p) => p.dispose?.());
      this.composer.dispose();
      this.composer = null;
    }
  }
  onResize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    const key = `${w}:${h}:${this.renderer.getPixelRatio()}`;
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }
  step3DPhysics() {
    const t = this.currentTime,
      c = this.config,
      prepare = smooth(0, 4.5, t),
      compact =
        smooth(4.8, 6.1, t) *
        clamp(
          (1 - Math.exp(-(c.tampForce ?? 15) / 5)) / (1 - Math.exp(-3)),
          0,
          1,
        ),
      extract = Math.max(0, t - 7.5),
      s = c.sample || { p: 0, q: 0, yield: 0, tdsCup: 0 };
    this.powder.uFill.value = prepare;
    this.powder.uCompact.value = compact;
    // Visual wetting proxy from cup outflow, not a solved inlet/storage water balance.
    const poreCapacity = (c.dose * 0.38) / 0.65;
    this.powder.uWet.value =
      t > 7.5 ? clamp(s.yield / Math.max(1, poreCapacity), 0, 1) : 0;
    const retract = smooth(4.3, 4.8, t);
    this.grinder.position.x = -1.05;
    this.chute.position.x = -0.64 * retract;
    this.chute.position.y = 0.2 * retract;
    this.burr.rotation.y = (t * (c.grinderRPM || 400) * Math.PI) / 30;
    const contactY =
      yBasket +
      0.018 +
      (this.powder.uHeight.value + 0.14 * (1 - compact)) *
        (1 - 0.24 * compact) +
      0.0275;
    this.tamper.position.set(
      0,
      2.45 - (smooth(4.5, 5.8, t) - smooth(6.2, 7.4, t)) * (2.45 - contactY),
      0.52 * (1 - smooth(4.5, 5, t) + smooth(6.5, 7.4, t)),
    );
    this.armEnd.copy(this.tamper.position);
    this.armEnd.y += 0.27;
    this.armDirection.subVectors(this.armEnd, this.armAnchor);
    this.tamperArm.position
      .copy(this.armAnchor)
      .add(this.armEnd)
      .multiplyScalar(0.5);
    this.tamperArm.scale.y = this.armDirection.length();
    this.tamperArm.quaternion.setFromUnitVectors(
      this.upAxis,
      this.armDirection.normalize(),
    );
    this.head.position.y = yBasket + 0.6 - 0.2 * smooth(6.7, 7.5, t);
    for (let i = 0; i < 34; i++) {
      const phase = (t * 0.3 + i * 0.618034) % 1,
        a = i * 2.39996,
        r = 0.09 + ((i * 7) % 11) / 110;
      this.dummy.position.set(
        this.grinder.position.x + Math.cos(a) * r,
        2.49 + phase * 0.32,
        -0.05 + Math.sin(a) * r,
      );
      this.dummy.rotation.set(i * 0.7 + t * 0.12, i * 1.3, t * 0.2 + i);
      const scale = t < 4.5 ? 1 : Math.max(0, 1 - smooth(4.5, 5, t));
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.beans.setMatrixAt(i, this.dummy.matrix);
    }
    this.beans.instanceMatrix.needsUpdate = true;
    const pos = this.dosingPowder.geometry.attributes.position;
    for (let i = 0; i < this.doseCount; i++) {
      const age = (t * 1.7 + i * 0.618034) % 1,
        angle = i * 2.399963,
        spread = 0.02 + age * 0.12;
      pos.setXYZ(
        i,
        Math.cos(angle) * spread,
        1.94 - age * 0.42,
        Math.sin(angle) * spread - 0.02,
      );
    }
    pos.needsUpdate = true;
    this.dosingPowder.visible = !this.gpuView && t > 0.1 && t < 4.5;
    this.liquid.update({
      t: extract,
      q: t > 7.5 ? s.q : 0,
      pressure: s.p,
      tds: s.tdsCup ?? s.tds ?? 0,
      output: t > 7.5 ? s.yield : 0,
      target: c.targetYield,
      waterTemp: c.waterTemp,
    });
    if (this.gpuView) {
      this.liquid.strands.forEach((s) => (s.mesh.visible = false));
      this.liquid.drops.visible = false;
      this.liquid.crema.scale.setScalar(1.35);
      this.liquid.pool.scale.set(1.35, 1, 1.35);
    }
  }
  setGpuView(view) {
    this.gpuView = view;
    if (view) {
      this.liquid.strands.forEach((s) => (s.mesh.visible = false));
      this.liquid.drops.visible = false;
    }
    if (!view) {
      this.liquid.crema.scale.setScalar(1);
      this.liquid.pool.scale.set(1, 1, 1);
      this.liquid.drops.visible = true;
    }
    const visible = !view;
    this.bed.group.visible = visible;
    this.micro.visible = visible;
    this.dosingPowder.visible = visible;
    if (this.cupHandle) {
      this.cupHandle.position.x = 0.39 * (visible ? 1 : 1.35);
      this.cupHandle.scale.setScalar(visible ? 1 : 1.35);
    }
    if (this.cupBody) {
      this.cupBody.scale.set(visible ? 1 : 1.35, 1, visible ? 1 : 1.35);
    }
  }
  animate(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    if (
      document.hidden ||
      this.renderer.domElement.hidden ||
      this.container.closest("[hidden]") ||
      now - this.lastFrame < 1000 / (this.quality === "low" ? 24 : 30)
    )
      return;
    this.lastFrame = now;
    if (this.cameraMotion) {
      const m = this.cameraMotion,
        f = clamp((now - m.start) / 1000, 0, 1),
        ease = f * f * (3 - 2 * f);
      this.camera.position.lerpVectors(m.from, m.to, ease);
      this.controls.target.lerpVectors(m.fromTarget, m.target, ease);
      if (f === 1) this.cameraMotion = null;
    }
    this.controls.update();
    if (this.dof)
      this.dof.uniforms.focus.value = this.camera.position.distanceTo(
        this.controls.target,
      );
    try {
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    } catch (error) {
      cancelAnimationFrame(this.raf);
      this.isRunning = false;
      this.onError?.(error);
      return;
    }
    if (this.renderError || this.renderer.getContext().isContextLost()) {
      cancelAnimationFrame(this.raf);
      this.isRunning = false;
      this.onError?.(
        this.renderError ?? new Error("3Dコンテキストが失われました"),
      );
      return;
    }
    if (!this.hasRenderedFrame) {
      const gl = this.renderer.getContext();
      if (gl.getError() !== gl.NO_ERROR) {
        cancelAnimationFrame(this.raf);
        this.onError?.(new Error("3D描画を開始できませんでした"));
        return;
      }
      this.hasRenderedFrame = true;
      this.onFirstFrame?.();
    }
    try {
      this.gpuView?.render();
    } catch (error) {
      if (this.gpuView) {
        this.gpuView.enabled = false;
        this.gpuView.onError?.(error);
      }
    }
    this.container.dataset.drawCalls = String(this.renderer.info.render.calls);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gpuView?.dispose();
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.disposeComposer();
    const resources = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m) {
          resources.add(m);
          for (const v of Object.values(m)) if (v?.isTexture) resources.add(v);
        }
      if (o.customDepthMaterial) resources.add(o.customDepthMaterial);
    });
    resources.forEach((r) => r.dispose());
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
export { THREE };

export { ScreenSpaceFluid } from "./ssfr.js";

export { createCoupledSolver } from "../gpu/coupled-solver.js";

export { CoupledGpuView } from "../gpu/gpu-view.js";
