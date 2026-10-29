const { test, expect } = require("@playwright/test");
const { requireGpu } = require("./require-gpu.cjs");
test.describe.configure({ mode: "serial" });
async function gpu(page) {
  await page.goto("/");
  await requireGpu(page);
}
function conserved(d, tolerance = 2e-7) {
  expect(d.nanCount).toBe(0);
  expect(d.validationErrors).toEqual([]);
  expect(d.minDetF).toBeGreaterThan(0);
  for (const key of ["waterErrorKg", "coffeeErrorKg", "liquidErrorKg"])
    expect(Math.abs(d[key]), key).toBeLessThan(tolerance);
}
test("MLS-MPM compacts; porous transport, dissolution, and XPBD conserve mass into the cup", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await gpu(page);
  const result = await page.evaluate(async () => {
    const { createCoupledSolver } = await import("/js/renderer.bundle.js");
    const s = await createCoupledSolver({
      particleCount: 2048,
      fluidCount: 512,
      gridDimension: 16,
      recipe: { targetYield: 1 },
    });
    try {
      const initial = s.latest;
      while (s.latest.preparationProgress < 1)
        await s.advance({ mechanicalSubsteps: 64, hydraulicSteps: 0 });
      const compacted = s.latest;
      const intermediate = [];
      let partial;
      for (let i = 0; i < 12 && s.latest.outletSolutionKg < 0.001 - 1e-7; i++) {
        intermediate.push(
          await s.advance({
            mechanicalSubsteps: 1,
            hydraulicSteps: 16,
            pressure: 900000,
          }),
        );
        if (i === 0) {
          for (
            let j = 0;
            j < 100 &&
            s.latest.fallingMassKg + s.latest.reservoirMassKg > 1e-10;
            j++
          )
            intermediate.push(await s.drain({ steps: 20 }));
          partial = s.latest;
        }
      }
      for (
        let i = 0;
        i < 100 && s.latest.fallingMassKg + s.latest.reservoirMassKg > 1e-7;
        i++
      )
        await s.drain({ steps: 20 });
      const final = s.latest,
        cells = await s.readCells();
      let minWater = Infinity,
        minSolute = Infinity,
        maxS = 0;
      for (let i = 0; i < cells.length; i += 24) {
        minWater = Math.min(minWater, cells[i]);
        minSolute = Math.min(minSolute, cells[i + 1]);
        maxS = Math.max(maxS, cells[i] / cells[i + 2]);
      }
      return {
        partial,
        initial,
        compacted,
        intermediate,
        final,
        minWater,
        minSolute,
        maxS,
      };
    } finally {
      s.dispose();
    }
  });
  for (const d of [
    result.initial,
    result.compacted,
    ...result.intermediate,
    result.final,
  ])
    conserved(d);
  expect(result.compacted.meanHeightMeters).toBeLessThan(
    result.initial.meanHeightMeters - 0.001,
  );
  expect(result.compacted.plasticStrain).toBeGreaterThan(0.001);
  expect(result.partial.cupMassKg).toBeGreaterThan(0);
  expect(result.partial.cupMassKg).toBeLessThan(0.001);
  expect(result.partial.reservoirMassKg).toBeLessThan(1e-10);
  expect(result.partial.fallingMassKg).toBeLessThan(1e-10);
  expect(result.partial.cupMassKg).toBeCloseTo(
    result.partial.outletSolutionKg,
    7,
  );
  expect(result.final.cupMassKg).toBeCloseTo(0.001, 6);
  expect(result.final.cupSoluteKg).toBeGreaterThan(0);
  expect(result.final.dryMassKg).toBeLessThan(result.initial.dryMassKg);
  expect(result.final.storedSoluteKg + result.final.outletSoluteKg).toBeCloseTo(
    result.final.dissolvedKg,
    7,
  );
  expect(result.final.complete).toBe(true);
  expect(result.minWater).toBeGreaterThanOrEqual(-1e-8);
  expect(result.minSolute).toBeGreaterThanOrEqual(-1e-8);
  await info.attach("conservation.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
});
test("100k and 500k actual particle buffers execute MPM, gravity, and reductions", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await gpu(page);
  const results = [];
  for (const count of [100000, 500000]) {
    const result = await page.evaluate(async (count) => {
      const { createCoupledSolver } = await import("/js/renderer.bundle.js");
      const s = await createCoupledSolver({
        particleCount: count,
        fluidCount: 32,
      });
      try {
        const before = Array.from(await s.readParticles(2));
        const d = await s.advance({ mechanicalSubsteps: 1, hydraulicSteps: 0 });
        return {
          d,
          before,
          after: Array.from(await s.readParticles(2)),
          bytes: s.buffers.particles.size,
        };
      } finally {
        s.dispose();
      }
    }, count);
    conserved(result.d);
    expect(result.d.particleCount).toBe(count);
    expect(result.bytes).toBe(count * 144);
    expect(result.after[1]).toBeLessThan(result.before[1]);
    expect(result.after[5]).toBeCloseTo(-9.81 * result.d.mechanicsSeconds, 7);
    expect(result.d.dryMassKg).toBeCloseTo(0.018, 7);
    results.push(result);
  }
  await info.attach("particle-scale-smoke.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
});
test("GPU storage renders powder with SSFR passes and matching scene occlusion", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await gpu(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(async () => {
    const { createCoupledSolver, EspressoScene, CoupledGpuView } =
      await import("/js/renderer.bundle.js");
    const root = document.createElement("div");
    root.id = "gpuRenderHarness";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      width: "320px",
      height: "260px",
      zIndex: 200,
    });
    document.body.append(root);
    window.solver = await createCoupledSolver({
      particleCount: 2048,
      fluidCount: 128,
      gridDimension: 16,
    });
    window.scene = new EspressoScene(root.id);
    cancelAnimationFrame(scene.raf);
    scene.setQuality("low");
    scene.start(120);
    scene.setView("section");
    window.view = await new CoupledGpuView(solver, scene).init();
    window.viewErrors = [];
    view.onError = (e) => viewErrors.push(e.message);
    scene.animate(performance.now() + 1100);
    cancelAnimationFrame(scene.raf);
  });
  await expect(page.locator(".gpu-particle-canvas")).toBeVisible();
  await page.waitForTimeout(1800);
  const result = await page.evaluate(async () => {
    const d = await solver.advance({
      mechanicalSubsteps: 1,
      hydraulicSteps: 0,
    });
    return {
      d,
      errors: viewErrors,
      enabled: view.enabled,
      visible: !scene.bed.group.visible && scene.gpuView === view,
      meshes: view.meshes.length,
      software: view.softwarePresentation,
    };
  });
  conserved(result.d);
  expect(result.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(result.enabled).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.meshes).toBeGreaterThan(10);
  await page.screenshot({
    path: info.outputPath("gpu-powder.png"),
    clip: { x: 0, y: 0, width: 320, height: 260 },
  });
  const flowing = await page.evaluate(async () => {
    view.enabled = false;
    while (solver.latest.preparationProgress < 1)
      await solver.advance({ mechanicalSubsteps: 64, hydraulicSteps: 0 });
    let d;
    for (let i = 0; i < 8; i++) {
      d = await solver.advance({
        mechanicalSubsteps: 1,
        hydraulicSteps: 16,
        pressure: 900000,
      });
      if (d.fallingMassKg > 0 && d.hydraulicSeconds >= 0.64) break;
    }
    scene.currentTime = 7.5 + d.liquidSeconds;
    scene.config.sample = {
      p: 9,
      q: 1,
      yield: d.cupMassKg * 1000,
      tdsCup: d.cupMassKg > 0 ? (d.cupSoluteKg / d.cupMassKg) * 100 : 0,
    };
    scene.step3DPhysics(0.02);
    scene.setView("stream");
    view.enabled = true;
    scene.lastFrame = 0;
    scene.animate(performance.now() + 1100);
    cancelAnimationFrame(scene.raf);
    return d;
  });
  conserved(flowing);
  expect(flowing.fallingMassKg).toBeGreaterThan(0);
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => viewErrors)).toEqual([]);
  const fluidPixels = await page.evaluate(async () => {
    const bytesPerRow = Math.ceil((view.width * 8) / 256) * 256;
    const staging = solver.device.createBuffer({
      size: bytesPerRow * view.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const command = solver.device.createCommandEncoder();
    command.copyTextureToBuffer(
      { texture: view.front },
      { buffer: staging, bytesPerRow },
      [view.width, view.height],
    );
    solver.device.queue.submit([command.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const pixels = new Uint16Array(staging.getMappedRange());
    let count = 0;
    for (let y = 0; y < view.height; y++)
      for (let x = 0; x < view.width; x++) {
        const depth = pixels[(y * bytesPerRow) / 2 + x * 4];
        if (depth > 0 && depth < 0x7c00) count++;
      }
    staging.unmap();
    staging.destroy();
    return count;
  });
  expect(fluidPixels).toBeGreaterThan(0);
  expect(
    await page.evaluate(() =>
      [
        scene.liquid.material.color.r,
        scene.liquid.material.color.g,
        scene.liquid.material.color.b,
      ].every(Number.isFinite),
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("gpu-liquid.png"),
    clip: { x: 0, y: 0, width: 320, height: 260 },
  });
  if (result.software) {
    const mean = await page.evaluate(() => {
      const c = view.canvas,
        px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return (
        px.reduce((s, v, i) => s + (i % 4 === 3 ? 0 : v), 0) /
        (c.width * c.height * 3)
      );
    });
    expect(mean).toBeGreaterThan(5);
    expect(mean).toBeLessThan(245);
  }
  await page.evaluate(() => {
    view.dispose();
    solver.dispose();
    scene.dispose();
  });
  await expect(page.locator("#gpuRenderHarness canvas")).toHaveCount(0);
});
test("mobile GPU journey pauses, finishes an actual partial result, and returns to simple mode", async ({
  page,
}) => {
  test.setTimeout(120000);
  await gpu(page);
  // Reduced motion keeps this integration test focused on the physical controller.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "gpu");
  await page.locator(".physics-settings summary").click();
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await expect(page.locator("#gpuDiagnostics")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#gpuParticleLabel")).toHaveText("32,768 粒子");
  await page.getByRole("button", { name: "抽出を一時停止する" }).click();
  // Let an already submitted batch settle, then require a stable simulation clock.
  await page.waitForTimeout(1000);
  const t = await page.locator("#simTimerDisplay").innerText();
  await page.waitForTimeout(400);
  await expect(page.locator("#simTimerDisplay")).toHaveText(t);
  await page.getByRole("button", { name: "抽出を再開する" }).click();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultScreen")).toBeVisible({ timeout: 30000 });
  await expect(page.locator("#resultSource")).toContainText("WebGPU");
  await expect(page.locator("#resultYield")).toHaveText("0.0 g");
  await expect(page.locator("#completionTag")).toHaveText("ユーザー操作で終了");
  await page
    .getByRole("button", { name: "レシピを調整する", exact: true })
    .click();
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "simple");
  await page.locator(".physics-settings summary").click();
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
  await expect(page.locator("#resultSource")).toContainText("簡易モデル");
});
