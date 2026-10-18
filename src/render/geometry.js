import * as THREE from "three";

// Continuous cross sections describe manufactured surfaces, including rounded rims.
export function turned(profile, segments = 96) {
  const geometry = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  geometry.computeVertexNormals();
  return geometry;
}
export function roundedProfile(radius, height, bevel = 0.025) {
  const b = Math.min(bevel, height / 3, radius / 3),
    points = [];
  points.push([0, -height / 2], [radius - b, -height / 2]);
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 10;
    points.push([
      radius - b + b * Math.cos(a),
      -height / 2 + b + b * Math.sin(a),
    ]);
  }
  points.push([radius, height / 2 - b]);
  for (let i = 0; i <= 5; i++) {
    const a = (i * Math.PI) / 10;
    points.push([
      radius - b + b * Math.cos(a),
      height / 2 - b + b * Math.sin(a),
    ]);
  }
  points.push([0, height / 2], [0, -height / 2]);
  return points;
}
export function beanGeometry(detail = 24) {
  const g = new THREE.SphereGeometry(1, detail, Math.round(detail * 0.75));
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i),
      y = a.getY(i),
      z = a.getZ(i);
    const center = 0.12 * Math.sin(y * 3.5);
    const groove =
      Math.exp(-(((x - center) / 0.13) ** 2)) * Math.max(0, z) * 0.24;
    a.setXYZ(i, x * 0.064, y * 0.097, (z - groove) * 0.047);
  }
  g.computeVertexNormals();
  return g;
}
export function spiralBurr(teeth = 32, inner = 0.11, outer = 0.32) {
  const positions = [],
    indices = [];
  // Each tooth has two flanks and a narrow crest; the path twists with radius.
  for (let k = 0; k < teeth; k++) {
    const base = positions.length / 3;
    for (let j = 0; j <= 14; j++) {
      const f = j / 14,
        r = inner + (outer - inner) * f,
        theta = (k * 2 * Math.PI) / teeth + f * 0.62;
      const width = (0.012 + 0.025 * f) / r,
        heights = [0, 0.018 + 0.024 * f, 0.018 + 0.024 * f, 0];
      for (let c = 0; c < 4; c++) {
        const angle = theta + [-0.5, -0.12, 0.12, 0.5][c] * width;
        positions.push(r * Math.cos(angle), heights[c], r * Math.sin(angle));
      }
      if (j)
        for (let c = 0; c < 3; c++) {
          const a = base + (j - 1) * 4 + c,
            b = a + 4;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // Anisotropic PBR derives its tangent frame from UV gradients.
  const uv = [];
  for (let i = 0; i < positions.length; i += 3)
    uv.push(
      positions[i] / (2 * outer) + 0.5,
      positions[i + 2] / (2 * outer) + 0.5,
    );
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function perforatedPlate(radius = 0.452, pitch = 0.058, hole = 0.012) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  for (let row = -8; row <= 8; row++)
    for (let col = -8; col <= 8; col++) {
      const x = col * pitch + ((row % 2) * pitch) / 2,
        z = row * pitch * 0.866;
      if (Math.hypot(x, z) < radius - hole * 2) {
        const path = new THREE.Path();
        path.absarc(x, z, hole, 0, Math.PI * 2, true);
        shape.holes.push(path);
      }
    }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.014,
    bevelEnabled: false,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.014, 0);
  return g;
}
export function woodTexture() {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const grain =
        Math.sin(
          x * 0.22 +
            Math.sin(y * 0.017) * 3 +
            Math.sin(x * 0.06 + y * 0.008) * 2,
        ) *
          0.5 +
        0.5;
      const pore = Math.sin(x * 2.1 + y * 0.04) * Math.sin(y * 0.6 + x * 0.09);
      const n = 0.7 + grain * 0.3 + pore * 0.06,
        i = (y * size + x) * 4;
      data[i] = 112 * n;
      data[i + 1] = 66 * n;
      data[i + 2] = 36 * n;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
