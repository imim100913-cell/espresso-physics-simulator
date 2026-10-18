/** Canvas charts and optional Three.js presentation. Shot state lives in journey.js. */

(function () {
  "use strict";

  // =========================================================================
  // 1. PRESSURE PROFILE EDITOR (2D Canvas)
  // =========================================================================
  class PressureProfileEditor {
    constructor(canvasId = "canvasMultiGraph") {
      this.canvas = document.getElementById(canvasId);
      this.dpr = window.devicePixelRatio || 1;
      this.points = [
        { t: 0, p: 2.0 },
        { t: 4, p: 2.0 },
        { t: 6, p: 9.0 },
        { t: 25, p: 8.5 },
        { t: 35, p: 6.0 },
      ];
      this.activePointIndex = -1;
      this.isDragging = false;
      this.hoverPointIndex = -1;
      this.padL = 40;
      this.padR = 40;
      this.padT = 20;
      this.padB = 30;
      this.maxTime = 35.0;
      this.maxPressure = 12.0;
      this.listeners = [];
    }

    init() {
      if (!this.canvas) return;
      this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
      window.addEventListener("mousemove", (e) => this.onMouseMove(e));
      window.addEventListener("mouseup", () => this.onMouseUp());
      this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    }

    setPreset(presetName, maxP = 9.0, piDuration = 4.0) {
      switch (presetName) {
        case "flat":
          this.points = [
            { t: 0, p: maxP },
            { t: this.maxTime, p: maxP },
          ];
          break;
        case "preinfusion":
          this.points = [
            { t: 0, p: 2.0 },
            { t: piDuration, p: 2.0 },
            { t: Math.min(piDuration + 2.0, this.maxTime), p: maxP },
            { t: this.maxTime, p: maxP },
          ];
          break;
        case "declining":
          this.points = [
            { t: 0, p: 2.0 },
            { t: piDuration, p: 2.0 },
            { t: piDuration + 1.5, p: maxP },
            { t: 18, p: maxP * 0.8 },
            { t: this.maxTime, p: maxP * 0.55 },
          ];
          break;
        case "blooming":
          this.points = [
            { t: 0, p: 3.0 },
            { t: 3.0, p: 3.0 },
            { t: 4.0, p: 0.0 },
            { t: 9.0, p: 0.0 },
            { t: 11.0, p: maxP },
            { t: this.maxTime, p: maxP * 0.85 },
          ];
          break;
        case "turbo":
          this.points = [
            { t: 0, p: 6.0 },
            { t: 15, p: 6.0 },
            { t: this.maxTime, p: 5.5 },
          ];
          break;
        default:
          break;
      }
      this.notifyChange();
    }

    getPlotBounds() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const plotW = w - this.padL - this.padR;
      const plotH = h - this.padT - this.padB;
      return { w, h, plotW, plotH, rect };
    }

    valToPx(t, p) {
      const { plotW, plotH } = this.getPlotBounds();
      const x = this.padL + (t / this.maxTime) * plotW;
      const y = this.padT + plotH - (p / this.maxPressure) * plotH;
      return { x, y };
    }

    pxToVal(px, py) {
      const { plotW, plotH } = this.getPlotBounds();
      const t = Math.max(
        0,
        Math.min(this.maxTime, ((px - this.padL) / plotW) * this.maxTime),
      );
      const p = Math.max(
        0,
        Math.min(
          this.maxPressure,
          ((plotH - (py - this.padT)) / plotH) * this.maxPressure,
        ),
      );
      return { t: Math.round(t * 10) / 10, p: Math.round(p * 10) / 10 };
    }

    onMouseDown(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          this.activePointIndex = i;
          this.isDragging = true;
          return;
        }
      }
    }

    onMouseMove(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging && this.activePointIndex >= 0) {
        const { t, p } = this.pxToVal(mx, my);
        if (this.activePointIndex === 0) {
          this.points[0].p = p;
        } else if (this.activePointIndex === this.points.length - 1) {
          this.points[this.points.length - 1].p = p;
        } else {
          this.points[this.activePointIndex].t = t;
          this.points[this.activePointIndex].p = p;
          this.points.sort((a, b) => a.t - b.t);
          this.activePointIndex = this.points.findIndex(
            (pt) => pt.t === t && pt.p === p,
          );
        }
        this.notifyChange();
        return;
      }

      let found = -1;
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          found = i;
          break;
        }
      }
      this.hoverPointIndex = found;
      this.canvas.style.cursor = found >= 0 ? "grab" : "crosshair";
    }

    onMouseUp() {
      this.isDragging = false;
      this.activePointIndex = -1;
    }

    onDoubleClick(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { t, p } = this.pxToVal(mx, my);

      for (let i = 1; i < this.points.length - 1; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          this.points.splice(i, 1);
          this.notifyChange();
          return;
        }
      }

      this.points.push({ t, p });
      this.points.sort((a, b) => a.t - b.t);
      this.notifyChange();
    }

    getP(t) {
      if (this.points.length === 0) return 9.0;
      if (t <= this.points[0].t) return this.points[0].p;
      if (t >= this.points[this.points.length - 1].t)
        return this.points[this.points.length - 1].p;

      for (let i = 0; i < this.points.length - 1; i++) {
        const p0 = this.points[i];
        const p1 = this.points[i + 1];
        if (t >= p0.t && t <= p1.t) {
          const ratio = (t - p0.t) / (p1.t - p0.t);
          return p0.p + ratio * (p1.p - p0.p);
        }
      }
      return 9.0;
    }

    render(ctx) {
      if (!ctx) return;
      const { plotW, plotH } = this.getPlotBounds();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;

      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";
      for (let t = 0; t <= this.maxTime; t += 5) {
        const { x } = this.valToPx(t, 0);
        ctx.beginPath();
        ctx.moveTo(x, this.padT);
        ctx.lineTo(x, this.padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, this.padT + plotH + 16);
      }

      ctx.textAlign = "right";
      for (let p = 0; p <= this.maxPressure; p += 3) {
        const { y } = this.valToPx(0, p);
        ctx.beginPath();
        ctx.moveTo(this.padL, y);
        ctx.lineTo(this.padL + plotW, y);
        ctx.stroke();
        ctx.fillStyle = "hsl(270, 75%, 65%)";
        ctx.fillText(`${p} bar`, this.padL - 6, y + 4);
      }

      ctx.beginPath();
      ctx.strokeStyle = "hsl(270, 85%, 68%)";
      ctx.lineWidth = 3;

      for (let px = 0; px <= plotW; px += 2) {
        const t = (px / plotW) * this.maxTime;
        const p = this.getP(t);
        const { x, y } = this.valToPx(t, p);
        if (px === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      this.points.forEach((pt, idx) => {
        const { x, y } = this.valToPx(pt.t, pt.p);
        const isHover = idx === this.hoverPointIndex;
        const isActive = idx === this.activePointIndex;

        ctx.beginPath();
        ctx.arc(x, y, isActive ? 8 : isHover ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? "#fff" : "#c084fc";
        ctx.fill();
        ctx.strokeStyle = "#581c87";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (isHover || isActive) {
          ctx.fillStyle = "rgba(20, 24, 30, 0.9)";
          ctx.fillRect(x - 28, y - 24, 56, 16);
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 28, y - 24, 56, 16);

          ctx.fillStyle = "#f3e8ff";
          ctx.font = '9px "JetBrains Mono"';
          ctx.textAlign = "center";
          ctx.fillText(`${pt.p}b / ${pt.t}s`, x, y - 12);
        }
      });
    }

    subscribe(callback) {
      this.listeners.push(callback);
    }
    notifyChange() {
      this.listeners.forEach((cb) => cb(this.points));
    }
  }

  // =========================================================================
  // 2. UNREAL ENGINE 5 AAA-QUALITY 3D PHYSICS SIMULATOR (Three.js WebGL)
  // =========================================================================
  class UE5Style3DPhysicsEngine {
    constructor(containerId = "viewport3DContainer") {
      this.container = document.getElementById(containerId);
      this.isRunning = false;
      this.currentTime = 0;
      this.maxTime = 28.0;
      this.rafId = null;

      this.config = {
        grindSize: 380,
        dose: 18.0,
        tampForce: 15,
        waterTemp: 93,
        maxPressure: 9,
        rpm: 400,
        roastLevel: 65,
      };

      this.beans3D = [];
      this.grounds3D = null;
      this.groundsData = [];
      this.waterParticles3D = null;
      this.waterData = [];

      this.init3DScene();
    }

    init3DScene() {
      if (typeof THREE === "undefined")
        throw new Error("3D library unavailable");

      const w = this.container.clientWidth || 650;
      const h = this.container.clientHeight || 290;

      // 1. Scene & Camera Setup
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x06080c);

      this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
      this.camera.position.set(0, 1.4, 4.2);

      // 2. High-Performance WebGL Renderer with HDR Tone Mapping
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.35;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      this.container.appendChild(this.renderer.domElement);

      // 3. OrbitControls (Smooth 360 Viewport Navigation)
      if (typeof THREE.OrbitControls !== "undefined") {
        this.controls = new THREE.OrbitControls(
          this.camera,
          this.renderer.domElement,
        );
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.dampingFactor = 0.06;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.12;
        this.controls.minDistance = 1.8;
        this.controls.maxDistance = 7.5;
        this.controls.target.set(0, 0.2, 0);
      }

      // 4. Procedural Studio Environment Map (Gives AAA Metallic PBR Reflections)
      this.setupStudioEnvironment();

      // 5. Cinematic 3-Point Studio Lighting
      this.setupLighting();

      // 6. Build High-Detail 3D Models
      this.buildHighDetailModels();
      this.initParticles();

      window.addEventListener("resize", () => this.onResize());
      this.animateLoop();
    }

    setupStudioEnvironment() {
      // Procedural Studio Gradient Cube/Equirectangular Map
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();

      const envScene = new THREE.Scene();
      const envGeo = new THREE.SphereGeometry(10, 16, 16);
      const envMat = new THREE.MeshBasicMaterial({
        color: 0x334155,
        side: THREE.BackSide,
      });
      const envMesh = new THREE.Mesh(envGeo, envMat);
      envScene.add(envMesh);

      // Add studio light soft boxes in environment
      const lightPlane1 = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff0dd }),
      );
      lightPlane1.position.set(4, 6, 4);
      lightPlane1.lookAt(0, 0, 0);
      envScene.add(lightPlane1);

      const lightPlane2 = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ color: 0x93c5fd }),
      );
      lightPlane2.position.set(-6, 3, -4);
      lightPlane2.lookAt(0, 0, 0);
      envScene.add(lightPlane2);

      const renderTarget = pmremGenerator.fromScene(envScene);
      this.scene.environment = renderTarget.texture;
    }

    setupLighting() {
      const ambLight = new THREE.AmbientLight(0x1e293b, 1.2);
      this.scene.add(ambLight);

      // Warm Key Light
      const keyLight = new THREE.SpotLight(
        0xfff7ed,
        4.5,
        20,
        Math.PI / 4,
        0.4,
        1,
      );
      keyLight.position.set(2.5, 4.5, 3.5);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      this.scene.add(keyLight);

      // Cool Rim Light
      const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.0);
      rimLight.position.set(-3.5, 2.0, -2.5);
      this.scene.add(rimLight);

      // Amber Bottom Glow (Reflecting off espresso crema)
      const amberGlow = new THREE.PointLight(0xf59e0b, 2.0, 4);
      amberGlow.position.set(0, -0.6, 0.8);
      this.scene.add(amberGlow);
    }

    buildHighDetailModels() {
      // PBR Materials
      this.matChrome = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        metalness: 0.96,
        roughness: 0.12,
        envMapIntensity: 1.5,
      });

      this.matBrushedSteel = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.85,
        roughness: 0.28,
      });

      this.matWalnutWood = new THREE.MeshStandardMaterial({
        color: 0x4a2511,
        roughness: 0.5,
        metalness: 0.05,
      });

      this.matGlassHopper = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        roughness: 0.08,
        metalness: 0.05,
        transmission: 0.95,
        ior: 1.52,
        thickness: 0.4,
      });

      this.matEspressoLiquid = new THREE.MeshStandardMaterial({
        color: 0x1f0d04,
        roughness: 0.1,
        metalness: 0.2,
      });

      this.matTigerCrema = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0x451a03,
        roughness: 0.35,
        metalness: 0.15,
      });

      // 1. Dark Brushed Metal Base Countertop
      const tableGeo = new THREE.CylinderGeometry(3.6, 3.6, 0.15, 48);
      const table = new THREE.Mesh(tableGeo, this.matBrushedSteel);
      table.position.y = -1.45;
      table.receiveShadow = true;
      this.scene.add(table);

      // 2. Grinder Hopper & CNC Conical Burr
      this.grinderGroup = new THREE.Group();
      this.grinderGroup.position.set(0, 1.25, 0);

      // Glass Hopper
      const hopperGeo = new THREE.CylinderGeometry(
        0.75,
        0.25,
        1.1,
        32,
        1,
        true,
      );
      const hopperMesh = new THREE.Mesh(hopperGeo, this.matGlassHopper);
      this.grinderGroup.add(hopperMesh);

      // Hopper Chrome Lid
      const lidGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.08, 32);
      const lidMesh = new THREE.Mesh(lidGeo, this.matChrome);
      lidMesh.position.y = 0.56;
      this.grinderGroup.add(lidMesh);

      // Titanium Conical Burr (Precision Fluted Cutter)
      const burrGeo = new THREE.ConeGeometry(0.38, 0.5, 16);
      this.burrMesh = new THREE.Mesh(
        burrGeo,
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          metalness: 0.9,
          roughness: 0.2,
        }),
      );
      this.burrMesh.position.y = -0.55;
      this.grinderGroup.add(this.burrMesh);
      this.scene.add(this.grinderGroup);

      // 3. E61 Style Group Head Assembly
      this.groupHead = new THREE.Group();
      this.groupHead.position.set(0, 0.65, 0);

      const groupHeadGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.3, 36);
      const groupHeadMesh = new THREE.Mesh(groupHeadGeo, this.matChrome);
      groupHeadMesh.castShadow = true;
      this.groupHead.add(groupHeadMesh);

      // Shower Screen Mesh Plate
      const screenGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.04, 32);
      const screenMesh = new THREE.Mesh(screenGeo, this.matBrushedSteel);
      screenMesh.position.y = -0.15;
      this.groupHead.add(screenMesh);
      this.scene.add(this.groupHead);

      // 4. Naked Bottomless Portafilter & Walnut Ergonomic Handle
      this.portafilterGroup = new THREE.Group();
      this.portafilterGroup.position.set(0, 0.32, 0);

      const basketRingGeo = new THREE.CylinderGeometry(
        0.65,
        0.6,
        0.52,
        36,
        1,
        true,
      );
      const basketRing = new THREE.Mesh(basketRingGeo, this.matChrome);
      basketRing.castShadow = true;
      this.portafilterGroup.add(basketRing);

      // Portafilter Ears / Wings
      const earGeo = new THREE.BoxGeometry(1.5, 0.08, 0.3);
      const earMesh = new THREE.Mesh(earGeo, this.matChrome);
      earMesh.position.y = 0.2;
      this.portafilterGroup.add(earMesh);

      // Walnut Wood Handle
      const handleGeo = new THREE.CylinderGeometry(0.13, 0.16, 1.5, 20);
      const handleMesh = new THREE.Mesh(handleGeo, this.matWalnutWood);
      handleMesh.rotation.z = Math.PI / 2;
      handleMesh.position.set(1.15, 0.18, 0);
      handleMesh.castShadow = true;
      this.portafilterGroup.add(handleMesh);
      this.scene.add(this.portafilterGroup);

      // 5. Heavy Walnut & Steel Tamper
      this.tamperGroup = new THREE.Group();
      this.tamperGroup.position.set(0, 3.5, 0);

      const tamperBaseGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.16, 32);
      const tamperBase = new THREE.Mesh(tamperBaseGeo, this.matChrome);
      this.tamperGroup.add(tamperBase);

      const tamperHandleGeo = new THREE.CylinderGeometry(0.15, 0.24, 0.65, 20);
      const tamperHandle = new THREE.Mesh(tamperHandleGeo, this.matWalnutWood);
      tamperHandle.position.y = 0.4;
      this.tamperGroup.add(tamperHandle);
      this.scene.add(this.tamperGroup);

      // 6. Ceramic Espresso Cup & Saucer
      this.cupGroup = new THREE.Group();
      this.cupGroup.position.set(0, -0.75, 0);

      // Saucer (Plate)
      const saucerGeo = new THREE.CylinderGeometry(0.85, 0.55, 0.08, 32);
      const saucer = new THREE.Mesh(saucerGeo, this.matDarkMetal);
      saucer.position.y = -0.38;
      saucer.receiveShadow = true;
      this.cupGroup.add(saucer);

      // Cup Body
      const cupGeo = new THREE.CylinderGeometry(0.52, 0.36, 0.72, 32);
      const cup = new THREE.Mesh(cupGeo, this.matDarkMetal);
      cup.castShadow = true;
      this.cupGroup.add(cup);

      // Cup Handle
      const cupHandleGeo = new THREE.TorusGeometry(0.18, 0.04, 12, 24);
      const cupHandle = new THREE.Mesh(cupHandleGeo, this.matDarkMetal);
      cupHandle.position.set(0.52, 0.05, 0);
      this.cupGroup.add(cupHandle);

      // Rising Crema Disc
      const cremaGeo = new THREE.CircleGeometry(0.46, 32);
      this.cremaMesh = new THREE.Mesh(cremaGeo, this.matTigerCrema);
      this.cremaMesh.rotation.x = -Math.PI / 2;
      this.cremaMesh.position.y = -0.22;
      this.cupGroup.add(this.cremaMesh);
      this.scene.add(this.cupGroup);

      // 7. Organic CatmullRom Mousetail Fluid Stream
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.08, 0),
        new THREE.Vector3(0.01, -0.2, 0.01),
        new THREE.Vector3(-0.01, -0.5, -0.01),
        new THREE.Vector3(0, -0.75, 0),
      ]);
      const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.032, 12, false);
      this.streamMesh = new THREE.Mesh(tubeGeo, this.matTigerCrema);
      this.streamMesh.visible = false;
      this.scene.add(this.streamMesh);
    }

    initParticles() {
      // 1. Organic Coffee Beans (3D Oval with Center Cut Crevice)
      this.beans3D = [];
      const beanGeo = new THREE.SphereGeometry(0.13, 14, 10);
      beanGeo.scale(1.45, 0.9, 1.05);

      const matBean = new THREE.MeshStandardMaterial({
        color: 0x4a2713,
        roughness: 0.65,
        metalness: 0.05,
      });

      for (let i = 0; i < 22; i++) {
        const mesh = new THREE.Mesh(beanGeo, matBean);
        mesh.position.set(
          (Math.random() - 0.5) * 0.55,
          1.4 + i * 0.15,
          (Math.random() - 0.5) * 0.55,
        );
        mesh.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        );
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.beans3D.push({
          mesh,
          vy: -0.012 - Math.random() * 0.015,
          omega: new THREE.Vector3(
            (Math.random() - 0.5) * 0.08,
            (Math.random() - 0.5) * 0.08,
            (Math.random() - 0.5) * 0.08,
          ),
          active: true,
        });
      }

      // 2. 3D Coffee Powder Particles (400 Instanced Meshes)
      const maxGrounds = 450;
      const pGeo = new THREE.DodecahedronGeometry(0.03, 0);
      const matGrounds = new THREE.MeshStandardMaterial({
        color: 0x3b1e0d,
        roughness: 0.9,
        metalness: 0.0,
      });
      this.grounds3D = new THREE.InstancedMesh(pGeo, matGrounds, maxGrounds);
      this.grounds3D.castShadow = true;
      this.scene.add(this.grounds3D);

      this.groundsData = [];
      const dummy = new THREE.Object3D();
      for (let i = 0; i < maxGrounds; i++) {
        dummy.position.set(0, -100, 0);
        dummy.updateMatrix();
        this.grounds3D.setMatrixAt(i, dummy.matrix);
        this.groundsData.push({
          pos: new THREE.Vector3(0, -100, 0),
          vel: new THREE.Vector3(0, 0, 0),
          active: false,
        });
      }
      this.grounds3D.instanceMatrix.needsUpdate = true;

      // 3. 3D SPH Water Particles (250 Instanced Meshes)
      const maxWater = 280;
      const wGeo = new THREE.SphereGeometry(0.022, 8, 8);
      const matWater = new THREE.MeshStandardMaterial({
        color: 0x93c5fd,
        transparent: true,
        opacity: 0.75,
        roughness: 0.1,
      });
      this.waterParticles3D = new THREE.InstancedMesh(wGeo, matWater, maxWater);
      this.scene.add(this.waterParticles3D);

      this.waterData = [];
      for (let i = 0; i < maxWater; i++) {
        dummy.position.set(0, -100, 0);
        dummy.updateMatrix();
        this.waterParticles3D.setMatrixAt(i, dummy.matrix);
        this.waterData.push({
          pos: new THREE.Vector3(0, -100, 0),
          vel: new THREE.Vector3(0, 0, 0),
          active: false,
        });
      }
      this.waterParticles3D.instanceMatrix.needsUpdate = true;
    }

    start(duration = 28.0) {
      this.maxTime = duration;
      this.currentTime = 0;
      this.isRunning = true;
      this.resetEntities();
    }

    stop() {
      this.isRunning = false;
    }

    resetEntities() {
      this.beans3D.forEach((b, i) => {
        b.mesh.position.set(
          (Math.random() - 0.5) * 0.55,
          1.4 + i * 0.15,
          (Math.random() - 0.5) * 0.55,
        );
        b.mesh.visible = true;
        b.active = true;
      });

      const dummy = new THREE.Object3D();
      this.groundsData.forEach((g, i) => {
        g.active = false;
        g.pos.set(0, -100, 0);
        dummy.position.copy(g.pos);
        dummy.updateMatrix();
        this.grounds3D.setMatrixAt(i, dummy.matrix);
      });
      this.grounds3D.instanceMatrix.needsUpdate = true;

      this.waterData.forEach((w, i) => {
        w.active = false;
        w.pos.set(0, -100, 0);
        dummy.position.copy(w.pos);
        dummy.updateMatrix();
        this.waterParticles3D.setMatrixAt(i, dummy.matrix);
      });
      this.waterParticles3D.instanceMatrix.needsUpdate = true;

      this.tamperGroup.position.y = 3.5;
      this.streamMesh.visible = false;
      this.cremaMesh.position.y = -0.22;
      this.grinderGroup.visible = true;
    }

    updateConfig(newConfig) {
      Object.assign(this.config, newConfig);
    }

    animateLoop() {
      requestAnimationFrame(() => this.animateLoop());

      if (this.controls) this.controls.update();

      if (document.hidden || this.container.closest("[hidden]")) return;
      this.renderer.render(this.scene, this.camera);
    }

    step3DPhysics(dt) {
      const timeSec = this.currentTime;
      const dummy = new THREE.Object3D();

      // --- 1. GRINDING PHASE (0 - 4.5s) ---
      if (timeSec < 4.5) {
        if (this.burrMesh)
          this.burrMesh.rotation.y += (this.config.rpm / 60) * Math.PI * 2 * dt;

        this.beans3D.forEach((b) => {
          if (b.active) {
            b.mesh.position.y += b.vy;
            b.mesh.position.x *= 0.985;
            b.mesh.position.z *= 0.985;
            b.mesh.rotation.x += b.omega.x;
            b.mesh.rotation.y += b.omega.y;

            if (b.mesh.position.y <= 0.72) {
              b.active = false;
              b.mesh.visible = false;

              // Explode into 3D Powder Particles
              for (let k = 0; k < 18; k++) {
                const freeG = this.groundsData.find((g) => !g.active);
                if (freeG) {
                  freeG.active = true;
                  freeG.pos.set(
                    (Math.random() - 0.5) * 0.22,
                    0.68,
                    (Math.random() - 0.5) * 0.22,
                  );
                  freeG.vel.set(
                    (Math.random() - 0.5) * 0.9,
                    -1.8 - Math.random() * 1.5,
                    (Math.random() - 0.5) * 0.9,
                  );
                }
              }
            }
          }
        });

        // Granular Falling & Packing in Basket
        this.groundsData.forEach((g, idx) => {
          if (g.active) {
            g.pos.addScaledVector(g.vel, dt);
            g.vel.y -= 9.8 * dt;

            // Basket Floor Collision & Heap
            if (g.pos.y <= 0.16) {
              g.pos.y = 0.16 + Math.random() * 0.18;
              g.vel.set(0, 0, 0);
            }

            dummy.position.copy(g.pos);
            dummy.updateMatrix();
            this.grounds3D.setMatrixAt(idx, dummy.matrix);
          }
        });
        this.grounds3D.instanceMatrix.needsUpdate = true;

        this.updateGauges(
          "GRINDING (3D PBR 剛体破砕・粉体ドージング)",
          0,
          0,
          0,
          timeSec,
        );

        // --- 2. MECHANICAL TAMPING (4.5s - 7.5s) ---
      } else if (timeSec < 7.5) {
        const tProg = (timeSec - 4.5) / 3.0;
        this.grinderGroup.visible = false;

        if (tProg < 0.5) {
          this.tamperGroup.position.y = 2.8 - (tProg / 0.5) * 2.45;
        } else {
          this.tamperGroup.position.y = 0.35 + ((tProg - 0.5) / 0.5) * 2.8;
        }

        this.updateGauges(
          `TAMPING (3D ${this.config.tampForce}kgf メカニカル圧密)`,
          0,
          0,
          0,
          timeSec,
        );

        // --- 3. 3D EXTRACTION & MO गिर FLOW (7.5s - 28.0s) ---
      } else {
        const extTime = timeSec - 7.5;
        this.tamperGroup.position.y = 4.5;

        const pressure = this.config.sample?.p || 0;

        // Inject 3D Water Particles
        if (Math.random() < 0.75) {
          const freeW = this.waterData.find((w) => !w.active);
          if (freeW) {
            freeW.active = true;
            freeW.pos.set(
              (Math.random() - 0.5) * 0.48,
              0.58,
              (Math.random() - 0.5) * 0.48,
            );
            freeW.vel.set(
              (Math.random() - 0.5) * 0.1,
              -1.2 - pressure * 0.22,
              (Math.random() - 0.5) * 0.1,
            );
          }
        }

        // Water Darcy Infiltration
        this.waterData.forEach((w, idx) => {
          if (w.active) {
            w.pos.addScaledVector(w.vel, dt);
            if (w.pos.y <= 0.08) {
              w.active = false;
              w.pos.set(0, -100, 0);
            }
            dummy.position.copy(w.pos);
            dummy.updateMatrix();
            this.waterParticles3D.setMatrixAt(idx, dummy.matrix);
          }
        });
        this.waterParticles3D.instanceMatrix.needsUpdate = true;

        // Mousetail Stream & Crema Rising
        if ((this.config.sample?.q || 0) > 0) {
          this.streamMesh.visible = true;
          this.streamMesh.rotation.y += dt * 5;
          this.cremaMesh.position.y =
            -0.22 +
            0.46 *
              Math.min(
                1,
                (this.config.sample?.yield || 0) / this.config.targetYield,
              );
        }

        const flow = this.config.sample?.q || 0;
        const yld = this.config.sample?.yield || 0;
        this.updateGauges(
          "EXTRACTING (3D 9-bar 多孔質浸透・流体抽出)",
          pressure,
          flow,
          Math.max(0, yld),
          timeSec,
        );
      }
    }

    // The journey updates accessible live values from the same shot as the report.
    updateGauges() {}

    onResize() {
      if (!this.renderer || !this.camera) return;
      const w = this.container.clientWidth || 650;
      const h = this.container.clientHeight || 290;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }
  }

  // =========================================================================
  // 3. CHART ENGINE (Multi-Curve, BCC, Flavor Radar, PSD)
  // =========================================================================
  class ChartEngine {
    constructor() {
      this.canvases = {};
      this.ctxs = {};
      this.dpr = window.devicePixelRatio || 1;
      this.activeTab = "graphFlow";
      this.pressureEditor = new PressureProfileEditor("canvasMultiGraph");
      this.timeSeries = [];
      this.hoverTime = null;
      this.currentTDS = 10.2;
      this.currentEY = 20.4;
      this.flavorScores = {
        acidity: 7.8,
        sweetness: 8.4,
        bitterness: 5.8,
        astringency: 2.6,
        body: 8.6,
      };
    }

    init() {
      this.setupCanvases();
      this.bindTabEvents();
      this.bindGraphHoverEvents();
      // Custom pressure is edited with touch/keyboard-friendly numeric inputs.
      this.pressureEditor.subscribe(() => {
        if (this.activeTab === "graphPressureEditor") this.renderActiveGraph();
      });
      window.addEventListener("resize", () => {
        this.setupCanvases();
        this.renderAll();
      });
    }

    setupCanvases() {
      [
        "canvasPSDPreview",
        "canvasMultiGraph",
        "canvasBCC",
        "canvasFlavorRadar",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.parentElement.getBoundingClientRect();
        const w = Math.floor(rect.width) || 300;
        const h =
          Math.floor(rect.height) ||
          parseInt(el.getAttribute("height"), 10) ||
          200;

        el.width = w * this.dpr;
        el.height = h * this.dpr;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;

        const ctx = el.getContext("2d");
        ctx.scale(this.dpr, this.dpr);
        this.canvases[id] = { el, w, h };
        this.ctxs[id] = ctx;
      });
    }

    bindTabEvents() {
      const tabBtns = document.querySelectorAll(".tab-btn");
      const legend = document.getElementById("graphLegend");

      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          tabBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.activeTab = btn.getAttribute("data-target");
          tabBtns.forEach((b) =>
            b.setAttribute("aria-pressed", String(b === btn)),
          );

          if (legend) {
            if (this.activeTab === "graphFlow") {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot dot-amber"></span>流量 (g/s)</span>
                <span class="legend-item"><span class="dot dot-cyan"></span>カップ濃度 (%)</span>
                <span class="legend-item"><span class="dot dot-green"></span>収率 EY (%)</span>
                <span class="legend-item"><span class="dot dot-purple"></span>圧力 (bar)</span>
              `;
            } else if (this.activeTab === "graphPorosity") {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot" style="background:#60a5fa"></span>上層空隙率 ε_top</span>
                <span class="legend-item"><span class="dot" style="background:#3b82f6"></span>中央空隙率 ε_mid</span>
                <span class="legend-item"><span class="dot" style="background:#1d4ed8"></span>下層空隙率 ε_bot</span>
              `;
            } else {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot dot-purple"></span>圧力プロファイル (bar)</span>
                <span class="legend-item" style="color:#9ca3af">✎ クリックして制御点をドラッグ</span>
              `;
            }
          }
          this.renderActiveGraph();
        });
      });
    }

    bindGraphHoverEvents() {
      const canvas = this.canvases["canvasMultiGraph"]?.el;
      if (!canvas) return;

      canvas.addEventListener("mousemove", (e) => {
        if (this.activeTab === "graphPressureEditor") return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const padL = 40;
        const plotW = rect.width - 80;
        if (mx >= padL && mx <= padL + plotW) {
          this.hoverTime =
            ((mx - padL) / plotW) * (this.timeSeries.at(-1)?.t || 35);
        } else {
          this.hoverTime = null;
        }
        this.renderActiveGraph();
      });

      canvas.addEventListener("mouseleave", () => {
        if (this.activeTab === "graphPressureEditor") return;
        this.hoverTime = null;
        this.renderActiveGraph();
      });
    }

    updateDataset(timeSeries, tds, ey, flavor, bccInfo) {
      this.timeSeries = timeSeries;
      this.currentTDS = tds;
      this.currentEY = ey;
      this.flavorScores = flavor;

      const bccTitle = document.getElementById("bccZoneTitle");
      const bccDesc = document.getElementById("bccZoneDesc");
      if (bccTitle && bccInfo) bccTitle.textContent = bccInfo.title;
      if (bccDesc && bccInfo) bccDesc.textContent = bccInfo.desc;

      this.renderAll();
    }

    renderAll() {
      this.renderPSDPreview();
      this.renderActiveGraph();
      this.renderBCC();
      this.renderFlavorRadar();
    }

    renderActiveGraph() {
      const info = this.canvases["canvasMultiGraph"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasMultiGraph"];
      ctx.clearRect(0, 0, w, h);

      if (this.activeTab === "graphPressureEditor") {
        this.pressureEditor.render(ctx);
      } else if (this.activeTab === "graphFlow") {
        this.renderFlowTdsGraph(ctx, w, h);
      } else if (this.activeTab === "graphPorosity") {
        this.renderPorosityGraph(ctx, w, h);
      }
    }

    renderFlowTdsGraph(ctx, w, h) {
      const padL = 40,
        padR = 40,
        padT = 20,
        padB = 30;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxTime = Math.ceil((this.timeSeries.at(-1)?.t || 35) / 5) * 5;
      const maxMetric = Math.max(
        25,
        Math.ceil(Math.max(...this.timeSeries.map((pt) => pt.tdsCup)) / 5) * 5,
      );

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";

      for (let t = 0; t <= maxTime; t += 5) {
        const x = padL + (t / maxTime) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, padT + plotH + 16);
      }

      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const y = padT + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }

      ctx.fillStyle = "hsl(38, 92%, 52%)";
      ctx.fillText("10 g/s", padL - 6, padT + 4);
      ctx.fillText("0.0", padL - 6, padT + plotH + 4);
      ctx.fillStyle = "hsl(190, 85%, 55%)";
      ctx.textAlign = "left";
      ctx.fillText(`${maxMetric}%`, padL + plotW + 6, padT + 4);
      ctx.fillText("0%", padL + plotW + 6, padT + plotH + 4);

      if (this.timeSeries.length === 0) return;

      const toX = (t) => padL + (t / maxTime) * plotW;
      const toYLeft = (flow) => padT + plotH - (flow / 10.0) * plotH;
      const toYRight = (pct) => padT + plotH - (pct / maxMetric) * plotH;

      ctx.beginPath();
      ctx.strokeStyle = "rgba(168, 85, 247, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = padT + plotH - (pt.p / 12.0) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 52%)";
      ctx.lineWidth = 2.5;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYLeft(pt.q);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "hsl(190, 85%, 55%)";
      ctx.lineWidth = 2.0;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYRight(pt.tdsCup);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "hsl(142, 65%, 50%)";
      ctx.lineWidth = 2.0;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYRight(pt.ey);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      if (this.hoverTime !== null) {
        const nearest = this.timeSeries.reduce((prev, curr) =>
          Math.abs(curr.t - this.hoverTime) < Math.abs(prev.t - this.hoverTime)
            ? curr
            : prev,
        );
        const hx = toX(nearest.t);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        const ttW = 140,
          ttH = 80;
        let ttX = hx + 10;
        if (ttX + ttW > w - padR) ttX = hx - ttW - 10;
        const ttY = padT + 10;

        ctx.fillStyle = "rgba(18, 22, 28, 0.92)";
        ctx.strokeStyle = "#4b5563";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(ttX, ttY, ttW, ttH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.fillText(`⏱️ t = ${nearest.t.toFixed(1)}s`, ttX + 8, ttY + 16);
        ctx.fillStyle = "hsl(38, 92%, 52%)";
        ctx.fillText(`Flow: ${nearest.q.toFixed(2)} g/s`, ttX + 8, ttY + 30);
        ctx.fillStyle = "hsl(190, 85%, 55%)";
        ctx.fillText(`TDS:  ${nearest.tdsCup.toFixed(1)}%`, ttX + 8, ttY + 44);
        ctx.fillStyle = "hsl(142, 65%, 50%)";
        ctx.fillText(`EY:   ${nearest.ey.toFixed(1)}%`, ttX + 8, ttY + 58);
        ctx.fillStyle = "hsl(270, 75%, 65%)";
        ctx.fillText(`Press:${nearest.p.toFixed(1)} bar`, ttX + 8, ttY + 72);
      }
    }

    renderPorosityGraph(ctx, w, h) {
      const padL = 40,
        padR = 40,
        padT = 20,
        padB = 30;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxTime = Math.ceil((this.timeSeries.at(-1)?.t || 35) / 5) * 5;
      const maxMetric = Math.max(
        25,
        Math.ceil(Math.max(...this.timeSeries.map((pt) => pt.tdsCup)) / 5) * 5,
      );

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";
      for (let t = 0; t <= maxTime; t += 5) {
        const x = padL + (t / maxTime) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, padT + plotH + 16);
      }

      if (this.timeSeries.length === 0) return;
      const toX = (t) => padL + (t / maxTime) * plotW;
      const toY = (eps) => padT + plotH - ((eps - 0.2) / 0.3) * plotH;

      ctx.beginPath();
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toY(pt.epsTop);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 2.5;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toY(pt.epsBot);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    renderBCC() {
      const info = this.canvases["canvasBCC"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasBCC"];
      ctx.clearRect(0, 0, w, h);

      const pad = 24;
      const plotW = w - pad * 2;
      const plotH = h - pad * 2;
      const eyMin = 14,
        eyMax = 26;
      const tdsMin = 6,
        tdsMax = 14;

      const toX = (ey) => pad + ((ey - eyMin) / (eyMax - eyMin)) * plotW;
      const toY = (tds) =>
        pad + plotH - ((tds - tdsMin) / (tdsMax - tdsMin)) * plotH;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeRect(pad, pad, plotW, plotH);

      const x1 = toX(18),
        x2 = toX(22);
      const y1 = toY(12),
        y2 = toY(8);
      ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = "hsl(38, 92%, 55%)";
      ctx.font = '9px "Inter", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("IDEAL ZONE", (x1 + x2) / 2, (y1 + y2) / 2 + 3);

      ctx.fillStyle = "#606c7e";
      ctx.font = '8px "Inter", sans-serif';
      ctx.fillText("酸味優位", toX(15.5), toY(13));
      ctx.fillText("過抽出 (苦味)", toX(24.5), toY(7));

      if (this.timeSeries.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        this.timeSeries
          .filter((pt) => pt.ey >= 13 && pt.tdsCup >= 5)
          .forEach((pt, idx) => {
            const x = toX(pt.ey);
            const y = toY(pt.tdsCup);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        ctx.stroke();
        ctx.setLineDash([]);

        const curX = Math.max(pad, Math.min(w - pad, toX(this.currentEY)));
        const curY = Math.max(pad, Math.min(h - pad, toY(this.currentTDS)));

        ctx.beginPath();
        ctx.arc(curX, curY, 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 158, 11, 0.35)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "hsl(38, 92%, 50%)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    renderFlavorRadar() {
      const info = this.canvases["canvasFlavorRadar"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasFlavorRadar"];
      ctx.clearRect(0, 0, w, h);

      const centerX = w / 2;
      const centerY = h / 2 + 8;
      const radius = Math.min(w, h) * 0.36;
      const attributes = [
        { name: "酸味", key: "acidity" },
        { name: "甘味", key: "sweetness" },
        { name: "苦味", key: "bitterness" },
        { name: "渋味", key: "astringency" },
        { name: "ボディ", key: "body" },
      ];
      const count = attributes.length;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let lvl = 1; lvl <= 4; lvl++) {
        const r = (radius / 4) * lvl;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const angle = ((Math.PI * 2) / count) * i - Math.PI / 2;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = "#94a3b8";
      ctx.font = '10px "Inter", sans-serif';
      ctx.textAlign = "center";
      for (let i = 0; i < count; i++) {
        const angle = ((Math.PI * 2) / count) * i - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillText(
          attributes[i].name,
          centerX + Math.cos(angle) * (radius + 16),
          centerY + Math.sin(angle) * (radius + 16) + 3,
        );
      }

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 52%)";
      ctx.lineWidth = 2;
      attributes.forEach((attr, idx) => {
        const angle = ((Math.PI * 2) / count) * idx - Math.PI / 2;
        const score = (this.flavorScores[attr.key] || 0) / 10;
        const r = radius * score;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
      ctx.fill();
    }

    renderPSDPreview(
      d50 = this.psdD50 || 380,
      finesRatio = this.psdFines || 0.18,
    ) {
      this.psdD50 = d50;
      this.psdFines = finesRatio;
      const info = this.canvases["canvasPSDPreview"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasPSDPreview"];
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 55%)";
      ctx.lineWidth = 2;

      for (let px = 0; px < w; px++) {
        const microns = Math.max(0.1, (px / w) * 900);
        const f1 =
          (finesRatio / (microns * 0.4 * Math.sqrt(2 * Math.PI))) *
          Math.exp(-Math.pow(Math.log(microns / 40), 2) / (2 * 0.4 * 0.4));
        const f2 =
          ((1 - finesRatio) / (microns * 0.28 * Math.sqrt(2 * Math.PI))) *
          Math.exp(-Math.pow(Math.log(microns / d50), 2) / (2 * 0.28 * 0.28));
        const val = (f1 + f2) * 12000;
        const py = h - 6 - Math.min(val, h - 12);
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(245, 158, 11, 0.25)");
      grad.addColorStop(1, "rgba(245, 158, 11, 0.0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // Presentation is optional: the guided journey and model work without WebGL.
  window.EspressoVisuals = {
    ChartEngine,
    PhysicsScene: UE5Style3DPhysicsEngine,
  };
})();
