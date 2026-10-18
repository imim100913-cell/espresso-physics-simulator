import * as THREE from "three";

// Closed solids use a winding-count stencil, then a single opaque section cap.
// Each solid clears stencil after its own cap: unrelated parts cannot fill one another.
export function capSolid({
  parent,
  geometry,
  material,
  plane,
  capMaterial,
  capGeometry,
  order = 10,
  depthFactory,
}) {
  const group = new THREE.Group();
  parent.add(group);
  const surfaces = [];
  for (const [side, op] of [
    [THREE.BackSide, THREE.IncrementWrapStencilOp],
    [THREE.FrontSide, THREE.DecrementWrapStencilOp],
  ]) {
    const m = depthFactory ? depthFactory() : new THREE.MeshBasicMaterial();
    Object.assign(m, {
      side,
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: op,
      stencilZFail: op,
      stencilZPass: op,
      clippingPlanes: [plane],
    });
    const mesh = new THREE.Mesh(geometry, m);
    mesh.renderOrder = order;
    group.add(mesh);
    surfaces.push(mesh);
  }
  material.clippingPlanes = [plane];
  material.clipShadows = true;
  const skin = new THREE.Mesh(geometry, material);
  skin.castShadow = skin.receiveShadow = true;
  skin.renderOrder = order + 1;
  group.add(skin);
  const cap = new THREE.Mesh(capGeometry, capMaterial);
  Object.assign(capMaterial, {
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  cap.renderOrder = order + 2;
  cap.onAfterRender = (renderer) => renderer.clearStencil();
  group.add(cap);
  return {
    group,
    skin,
    cap,
    setEnabled(enabled) {
      surfaces.forEach((m) => (m.visible = enabled));
      cap.visible = enabled;
      material.clippingPlanes = enabled ? [plane] : [];
      material.needsUpdate = true;
    },
  };
}
