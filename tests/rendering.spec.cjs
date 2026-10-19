const { test, expect } = require("@playwright/test");
async function harness(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Shader|WebGL|VALIDATE_STATUS|compile/i.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const root = document.createElement("div");
    root.id = "renderHarness";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      width: "320px",
      height: "260px",
      zIndex: 200,
    });
    document.body.append(root);
    const module = await import("/js/renderer.bundle.js");
    window.renderModule = module;
    window.testScene = new module.EspressoScene("renderHarness");
    window.testShot = BrewModel.simulate(BrewModel.defaults);
    testScene.updateConfig(testShot.params);
    testScene.start(testShot.duration + 7.5);
  });
  return errors;
}
async function frame(page, t) {
  await page.evaluate((t) => {
    testScene.currentTime = t;
    testScene.config.sample = BrewModel.sampleAt(
      testShot,
      Math.max(0, t - 7.5),
    );
    testScene.step3DPhysics(1 / 30);
  }, t);
  await page.waitForTimeout(180);
}
test("real WebGL compiles the cutaway, powder, wetting, strands, and cinematic pipelines", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors = await harness(page);
  for (const [name, t] of [
    ["dosing", 2],
    ["tamping", 6],
    ["wetting", 10],
    ["flow", 21],
  ]) {
    await frame(page, t);
    await page.screenshot({
      path: info.outputPath(name + ".png"),
      clip: { x: 0, y: 0, width: 320, height: 260 },
    });
  }
  const values = await page.evaluate(() => ({
    compact: testScene.powder.uCompact.value,
    wet: testScene.powder.uWet.value,
    parts: testScene.sections.length,
    calls: testScene.renderer.info.render.calls,
    stream: testScene.liquid.strands.some((s) => s.mesh.visible),
    plateTriangles: testScene.plate.geometry.attributes.position.count / 3,
  }));
  expect(values.compact).toBe(1);
  expect(values.wet).toBeGreaterThan(0);
  expect(values.parts).toBe(3);
  expect(values.calls).toBeGreaterThan(20);
  expect(values.stream).toBeTruthy();
  expect(values.plateTriangles).toBeGreaterThan(1000);
  const contacts = await page.evaluate(() => {
    const s = testScene,
      { THREE } = renderModule;
    s.scene.updateMatrixWorld(true);
    const cup = new THREE.Box3().setFromObject(s.cupBody);
    const base = new THREE.Box3().setFromObject(s.machineBase);
    const p = s.saucer.geometry.attributes.position;
    let seat = -Infinity;
    for (let i = 0; i < p.count; i++)
      if (Math.hypot(p.getX(i), p.getZ(i)) < 0.25)
        seat = Math.max(seat, p.getY(i));
    const saucerSeat = s.saucer.localToWorld(new THREE.Vector3(0, seat, 0)).y;
    const poolBottom = () =>
      s.liquid.pool.position.y - s.liquid.pool.scale.y / 2;
    const result = {
      cup: cup.min.y,
      saucerSeat,
      machine: base.min.y,
      floor: s.floor.position.y,
      liquidBottom: poolBottom(),
      cupFloor: cup.min.y + 0.09,
    };
    s.setGpuView({ render() {}, dispose() {} });
    s.step3DPhysics(1 / 30);
    result.gpuLiquidBottom = poolBottom();
    s.setGpuView(null);
    result.restoredLiquidBottom = poolBottom();
    return result;
  });
  expect(contacts.cup).toBeCloseTo(contacts.saucerSeat, 5);
  expect(contacts.machine).toBeCloseTo(contacts.floor, 5);
  for (const bottom of [
    contacts.liquidBottom,
    contacts.gpuLiquidBottom,
    contacts.restoredLiquidBottom,
  ])
    expect(bottom).toBeCloseTo(contacts.cupFloor, 5);
  await page.evaluate(() => {
    testScene.setCutaway(false);
    testScene.setQuality("cinematic");
  });
  await frame(page, 23);
  const postStats = await page.evaluate(() => {
    const s = testScene,
      r = s.renderer,
      gl = r.getContext(),
      w = r.domElement.width,
      h = r.domElement.height;
    const stats = [];
    for (const enabled of [[], [1], [2], [3], [4], [1, 2, 3, 4]]) {
      s.composer.passes.forEach(
        (p, i) => (p.enabled = i === 0 || i === 5 || enabled.includes(i)),
      );
      s.composer.render();
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4)
        total += pixels[i] + pixels[i + 1] + pixels[i + 2];
      stats.push({
        enabled,
        mean: total / (w * h * 3),
        error: gl.getError(),
        target: !!r.getRenderTarget(),
        w,
        h,
      });
    }
    return stats;
  });
  for (const stat of postStats) {
    expect(stat.mean).toBeGreaterThan(5);
    expect(stat.error).toBe(0);
  }
  await page.screenshot({
    path: info.outputPath("cinematic.png"),
    clip: { x: 0, y: 0, width: 320, height: 260 },
  });
  await page.evaluate(() => {
    testScene.setCutaway(true);
    testScene.setQuality("low");
  });
  await frame(page, 12);
  expect(errors).toEqual([]);
  await page.evaluate(() => testScene.dispose());
  await expect(page.locator("#renderHarness canvas")).toHaveCount(0);
});
test("SSFR compiles depth, bilateral filtering, thickness and Beer-Lambert composition", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = await harness(page);
  const result = await page.evaluate(() => {
    const { THREE, ScreenSpaceFluid } = renderModule,
      s = testScene;
    const opaque = new THREE.WebGLRenderTarget(96, 96, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(96, 96),
      stencilBuffer: true,
    });
    s.renderer.setRenderTarget(opaque);
    s.renderer.render(s.scene, s.camera);
    s.renderer.setRenderTarget(null);
    const fluid = new ScreenSpaceFluid(96, 96);
    const positions = new Float32Array([0, 1, 0, 0.015, 1.01, 0, 0, 0.98, 0]);
    const previous = s.renderer.getRenderTarget();
    const texture = fluid.render(
      s.renderer,
      positions,
      3,
      opaque.texture,
      opaque.depthTexture,
      s.camera,
      10,
    );
    const ok = texture.isTexture && s.renderer.getRenderTarget() === previous;
    const pixels = new Uint16Array(96 * 96 * 4);
    s.renderer.readRenderTargetPixels(fluid.depth, 0, 0, 96, 96, pixels);
    const hasDepth = pixels.some(
      (value, i) => i % 4 === 0 && value > 0 && value < 0x7c00,
    );
    fluid.dispose();
    opaque.dispose();
    s.dispose();
    return ok && hasDepth;
  });
  expect(result).toBeTruthy();
  expect(errors).toEqual([]);
});
test("WebGPU wetting reference compiles and conserves source concentration", async ({
  page,
}) => {
  await page.goto("/");
  const available = await page.evaluate(
    async () => !!(navigator.gpu && (await navigator.gpu.requestAdapter())),
  );
  test.skip(!available, "WebGPU adapter not exposed by this test browser");
  const result = await page.evaluate(async () => {
    const { createWettingReference } =
      await import("/src/gpu/wetting-reference.js");
    const s = await createWettingReference({
      size: [4, 6, 4],
      inletConcentration: 2,
      drain: 0,
    });
    s.step(30);
    const cells = await s.read();
    let water = 0,
      solute = 0,
      min = 1,
      max = 0;
    for (let i = 0; i < cells.length; i += 4) {
      water += cells[i];
      solute += cells[i + 1];
      min = Math.min(min, cells[i]);
      max = Math.max(max, cells[i]);
    }
    s.dispose();
    return { water, solute, min, max };
  });
  expect(result.water).toBeGreaterThan(0);
  expect(result.water).toBeCloseTo(0.48, 5);
  expect(result.solute / result.water).toBeCloseTo(2, 5);
  expect(result.min).toBeGreaterThanOrEqual(-1e-6);
  expect(result.max).toBeLessThanOrEqual(0.400001);
});
