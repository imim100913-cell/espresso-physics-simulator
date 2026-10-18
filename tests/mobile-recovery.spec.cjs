const { test, expect } = require("@playwright/test");
const pixelUA =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
async function chooseGpu(page) {
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "gpu");
  await page.locator(".physics-settings summary").click();
}
async function stalledAdapter(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: () => {
          window.adapterRequested = true;
          return new Promise((r) => (window.resolveAdapter = r));
        },
      },
      configurable: true,
    });
  });
  await page.goto("/");
  await chooseGpu(page);
}
for (const viewport of [
  { width: 412, height: 915 },
  { width: 915, height: 412 },
]) {
  test(`Pixel-size mobile auto starts without GPU while 3D is unavailable (${viewport.width}px)`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      userAgent: pixelUA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2.625,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.gpuCalls = 0;
      Object.defineProperty(navigator, "gpu", {
        value: {
          requestAdapter: () => {
            window.gpuCalls++;
            return new Promise(() => {});
          },
        },
        configurable: true,
      });
    });
    // A blocked renderer must not delay the mobile shot clock.
    await page.route("**/renderer.bundle.js*", (r) => r.abort());
    await page.goto("/");
    await page.clock.install();
    await page.locator("#btnPrimary").click();
    await page.clock.runFor(1000);
    await expect(page.locator("#backendStatus")).toContainText(
      "スマホ向けの軽量計算",
    );
    expect(await page.locator("#simTimerDisplay").innerText()).not.toBe(
      "0.0 s",
    );
    expect(await page.evaluate(() => gpuCalls)).toBe(0);
    await expect(page.locator("#renderQuality")).toHaveValue("low");
    await expect(page.locator("#btnSkipBrew")).toBeEnabled();
    await page.locator("#btnToggle3D").click();
    await expect(page.locator("#visualFallback")).toBeVisible();
    await page.clock.runFor(31500);
    await expect(page.locator("#resultScreen")).toBeVisible();
    await expect(page.locator("#resultYield")).toHaveText("36.0 g");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}
test("stalled GPU startup expires, ignores a late adapter, and completes a simple shot", async ({
  page,
}) => {
  await stalledAdapter(page);
  await page.clock.install();
  await page.locator("#btnPrimary").click();
  await expect
    .poll(() => page.evaluate(() => !!window.adapterRequested))
    .toBe(true);
  await expect(page.locator("#btnUseSimple")).toBeVisible();
  await page.clock.runFor(12500);
  await expect(page.locator("#backendStatus")).toContainText("軽量計算");
  await expect(page.locator("#btnSkipBrew")).toBeEnabled();
  await page.evaluate(() => {
    window.deviceRequested = false;
    resolveAdapter({
      requestDevice: () => {
        deviceRequested = true;
        throw new Error("must not run");
      },
    });
  });
  expect(await page.evaluate(() => deviceRequested)).toBe(false);
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultSource")).toContainText("簡易モデル");
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
test("user can leave a stalled GPU startup immediately and retry", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stalledAdapter(page);
  await page.locator("#btnPrimary").click();
  await expect
    .poll(() => page.evaluate(() => !!window.adapterRequested))
    .toBe(true);
  await page.locator("#btnUseSimple").click();
  await expect(page.locator("#backendStatus")).toContainText(
    "軽量計算で最初から",
  );
  await expect(page.locator("#btnPrimary")).toBeEnabled();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
  await expect(page.locator("#resultSource")).toContainText("簡易モデル");
  expect(errors).toEqual([]);
});
test("GPU failure during a shot restarts with an explicitly labelled simple result", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: {}, configurable: true }),
  );
  await page.goto("/");
  await chooseGpu(page);
  await page.evaluate(() => {
    GpuBrewSession.create = async ({ onError }) => ({
      paused: false,
      attachScene() {},
      start() {
        setTimeout(() => onError(new Error("device lost")), 20);
      },
      dispose() {
        window.failedGpuDisposed = true;
      },
    });
  });
  await page.locator("#btnPrimary").click();
  await expect(page.locator("#backendStatus")).toContainText(
    "GPU計算を続けられませんでした",
  );
  expect(await page.evaluate(() => failedGpuDisposed)).toBe(true);
  await expect(page.locator("#btnPrimary")).toBeEnabled();
  await expect(page.locator("#btnSkipBrew")).toBeEnabled();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
  await expect(page.locator("#resultSource")).toContainText("簡易モデル");
});
test("mobile WebGL context loss leaves extraction and result controls usable", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("#btnPrimary").click();
  await page.locator("#btnToggle3D").click();
  const canvas = page.locator('canvas[data-renderer="espresso-pbr"]');
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas[data-renderer="espresso-pbr"]',
    );
    canvas
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context")
      .loseContext();
  });
  await expect(page.locator("#visualFallback")).toBeVisible();
  await expect(page.locator("#btnToggle3D")).toHaveText("3Dを表示");
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
  expect(errors).toEqual([]);
});

test("a stalled GPU batch is destroyed by the watchdog and restores simple controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: {}, configurable: true }),
  );
  await page.route("**/renderer.bundle.js*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export async function createCoupledSolver(){return {latest:{preparationProgress:0,hydraulicSeconds:0},advance(){return new Promise(()=>{});},dispose(){window.stalledSolverDisposed=true;}};}",
    }),
  );
  await page.goto("/");
  await chooseGpu(page);
  await page.clock.install();
  await page.locator("#btnPrimary").click();
  await expect(page.locator("#gpuDiagnostics")).toBeVisible();
  await page.clock.runFor(8500);
  await expect(page.locator("#backendStatus")).toContainText(
    "GPUの応答が止まりました",
  );
  expect(await page.evaluate(() => stalledSolverDisposed)).toBe(true);
  await expect(page.locator("#btnSkipBrew")).toBeEnabled();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultSource")).toContainText("簡易モデル");
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
