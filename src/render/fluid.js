import * as THREE from "three";
import { cremaMaterial, steamVertex, steamFragment } from "./shaders.js";
const clamp = THREE.MathUtils.clamp;
export const smooth = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);
// Analytic surface representation. It is driven by the shot, not advertised as CFD.
export class LiquidSurface {
  constructor(scene, { top = 1.3, bottom = 0.2, mobile = false } = {}) {
    this.top = top;
    this.bottom = bottom;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x5c230a,
      metalness: 0,
      roughness: 0.16,
      transmission: mobile ? 0.18 : 0.45,
      thickness: 0.05,
      attenuationColor: new THREE.Color(0.25, 0.065, 0.012),
      attenuationDistance: 0.22,
      ior: 1.34,
      clearcoat: 0.55,
      clearcoatRoughness: 0.09,
    });
    this.strands = [];
    for (let i = 0; i < 5; i++) {
      const n = 28,
        rings = 10,
        g = new THREE.BufferGeometry(),
        pos = new Float32Array((n + 1) * rings * 3),
        uv = new Float32Array((n + 1) * rings * 2),
        idx = [];
      for (let j = 0; j <= n; j++)
        for (let k = 0; k < rings; k++) {
          const v = j * rings + k;
          uv[v * 2] = k / rings;
          uv[v * 2 + 1] = j / n;
          if (j < n) {
            const b = j * rings + k,
              c = j * rings + ((k + 1) % rings);
            idx.push(b, b + rings, c, c, b + rings, c + rings);
          }
        }
      g.setAttribute(
        "position",
        new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage),
      );
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.strands.push({ mesh, n, rings });
    }
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 10),
      this.material,
      18,
    );
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    this.group.add(this.drops);
    this.dummy = new THREE.Object3D();
    const foam = cremaMaterial();
    this.cremaUniforms = foam.uniforms;
    this.crema = new THREE.Mesh(
      new THREE.CircleGeometry(0.342, 96),
      foam.material,
    );
    this.crema.rotation.x = -Math.PI / 2;
    this.crema.position.y = bottom;
    this.crema.visible = false;
    this.crema.receiveShadow = true;
    this.group.add(this.crema);
    // A small meniscus rises with actual modeled cup mass.
    this.pool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.3, 1, 64),
      this.material,
    );
    this.pool.visible = false;
    this.group.add(this.pool);
    const count = mobile ? 32 : 72,
      position = new Float32Array(count * 3),
      seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        r = Math.sqrt((i + 0.5) / count) * 0.29;
      position.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      seed[i] = (i * 0.618034) % 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(position, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.steamMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
      vertexShader: steamVertex,
      fragmentShader: steamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.steam = new THREE.Points(g, this.steamMaterial);
    this.steam.frustumCulled = false;
    this.group.add(this.steam);
  }
  update({ t, q, pressure, tds, output, target, waterTemp = 93 }) {
    const active = q > 0.01,
      merged = smooth(0.8, 2.5, q) * smooth(1, 6, pressure),
      blond = 1 - smooth(4, 15, tds),
      level = this.bottom + clamp(output / 45, 0, 1) * 0.27;
    this.material.color.setRGB(
      0.1 + blond * 0.25,
      0.022 + blond * 0.1,
      0.004 + blond * 0.025,
    );
    // Three's physical transmission implements exp(-sigma_a * pathLength).
    // attenuationDistance is in scene units; see the optics section in the design.
    const concentration = clamp(tds / 10, 0.05, 3);
    this.material.attenuationDistance = 0.28 / concentration;
    this.material.thickness = 0.025 + 0.035 * Math.sqrt(Math.max(0, q));
    for (let i = 0; i < this.strands.length; i++) {
      const { mesh, n, rings } = this.strands[i];
      const side = i !== 0;
      mesh.visible = active && (side ? merged < 0.98 : merged > 0.02);
      if (!mesh.visible) continue;
      const a = i * 2.39996,
        originRadius = side ? 0.27 : 0;
      const fraction = side ? (1 - merged) / 4 : merged;
      // Q=A v, v(y)=sqrt(v0²+2 g deltaY), dimensions are a visual scale.
      const massFlux = q * 0.00055 * fraction;
      const attr = mesh.geometry.attributes.position;
      for (let j = 0; j <= n; j++) {
        const f = j / n,
          fall = (this.top - level) * f;
        const velocity = Math.sqrt(0.15 * 0.15 + 2 * 9.81 * 0.05 * fall);
        const radius = clamp(
          Math.sqrt(massFlux / (Math.PI * Math.max(0.1, velocity))),
          0.0012,
          0.055,
        );
        const converge = Math.exp(-f * (2 + merged * 12));
        const sway = Math.sin(t * 5 - f * 5 + i) * 0.009 * f * (0.3 + q * 0.15);
        const cx = Math.cos(a) * originRadius * converge + sway,
          cz =
            Math.sin(a) * originRadius * converge +
            Math.cos(t * 4 - f * 7) * 0.006 * f;
        for (let k = 0; k < rings; k++) {
          const theta = (k * 2 * Math.PI) / rings;
          attr.setXYZ(
            j * rings + k,
            cx + Math.cos(theta) * radius,
            this.top - f * (this.top - level),
            cz + Math.sin(theta) * radius,
          );
        }
      }
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
    const dropletAmount = active ? 1 - merged : 0;
    for (let i = 0; i < 18; i++) {
      const phase = (t * (0.6 + q * 0.12) + i * 0.618034) % 1;
      const a = i * 2.39996,
        r = 0.12 + (i % 3) * 0.07;
      const size =
        dropletAmount > 0.03 ? 0.008 + Math.sqrt(Math.max(0, q)) * 0.007 : 0;
      this.dummy.position.set(
        Math.cos(a) * r * (1 - phase * 0.7),
        this.top - (this.top - level) * phase * phase,
        Math.sin(a) * r * (1 - phase * 0.7),
      );
      this.dummy.scale.set(size, size * (1 + phase * 1.8), size);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.crema.visible = this.pool.visible = output > 0.05;
    this.crema.position.y = level + 0.0015;
    // The liquid volume grows from the inside floor, rather than a floating disc.
    this.pool.scale.y = Math.max(0.00001, level - this.bottom);
    this.pool.position.y = this.bottom + this.pool.scale.y / 2;
    this.cremaUniforms.uTime.value = t;
    this.cremaUniforms.uTDS.value = tds;
    this.cremaUniforms.uLevel.value = output / Math.max(target, 1);
    this.steam.position.y = level + 0.03;
    this.steamMaterial.uniforms.uTime.value = t;
    this.steamMaterial.uniforms.uAmount.value =
      output > 1 ? clamp((waterTemp - 75) / 25, 0, 1) : 0;
  }
}
