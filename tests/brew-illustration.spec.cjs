const { test, expect } = require("@playwright/test");
async function setup(page) {
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("renderer.bundle.js")) requests.push(r.url());
  });
  await page.addInitScript(() => {
    window.gpuCalls = 0;
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter() {
          gpuCalls++;
          throw new Error("GPU is unavailable");
        },
      },
      configurable: true,
    });
  });
  await page.goto("/");
  await page.clock.install();
  await page.locator("#btnPrimary").click();
  return requests;
}
async function stageShot(page, info, name) {
  await page
    .locator("#viewport3DContainer")
    .screenshot({ path: info.outputPath(name + ".png") });
}
test("mobile plays grinding, compaction, wetting and actual cup filling without loading GPU code", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = await setup(page);
  const art = page.locator("#brewIllustration");
  await expect(art).toBeVisible();
  await expect(page.locator("#btnToggle3D")).toHaveText("3Dを表示");
  const initialBed = await page.locator("#artBed").getAttribute("d");
  await page.clock.runFor(4000);
  const looseBed = await page.locator("#artBed").getAttribute("d");
  expect(looseBed).not.toBe(initialBed);
  const bounds = await page.locator("#artBed").evaluate((node) => ({
    height: node.getBBox().height,
    width: node.getBBox().width,
  }));
  expect(bounds.height).toBeGreaterThan(30);
  expect(bounds.height).toBeLessThan(70);
  expect(bounds.width).toBeCloseTo(98, 0);
  await expect(art).toHaveAttribute("data-phase", "grind");
  await stageShot(page, info, "grind");
  await page.clock.runFor(2400);
  const compact = await page.locator("#artBed").getAttribute("d");
  expect(compact).not.toBe(looseBed);
  await expect(art).toHaveAttribute("data-phase", "tamp");
  await stageShot(page, info, "tamp");
  await page.clock.runFor(9000);
  await expect(art).toHaveAttribute("data-phase", "extract");
  expect(
    Number(await page.locator("#artStreams").getAttribute("opacity")),
  ).toBeGreaterThan(0.5);
  expect(
    Number(await page.locator("#artWetFront").getAttribute("height")),
  ).toBeGreaterThan(20);
  expect(
    Number(await page.locator("#artCupLiquid").getAttribute("y")),
  ).toBeLessThan(370);
  const live = parseFloat(await page.locator("#liveYield").innerText());
  const fill = Number(await art.getAttribute("data-fill"));
  expect(fill).toBeCloseTo(live / 36, 2);
  await stageShot(page, info, "extract");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => gpuCalls)).toBe(0);
  expect(errors).toEqual([]);
});
test("pausing freezes the complete illustration and resuming follows the shot clock", async ({
  page,
}) => {
  await setup(page);
  await page.clock.runFor(12000);
  await page.locator("#btnPrimary").click();
  const frozen = await page.locator("#brewIllustration").innerHTML();
  await page.clock.runFor(2000);
  expect(await page.locator("#brewIllustration").innerHTML()).toBe(frozen);
  await page.locator("#btnPrimary").click();
  await page.clock.runFor(2000);
  expect(await page.locator("#brewIllustration").innerHTML()).not.toBe(frozen);
});
test("failed 3D initialization preserves a moving extraction illustration", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/renderer.bundle.js*", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: 'export class EspressoScene{constructor(){throw new Error("GPU initialization failed");}}',
    }),
  );
  await page.locator("#btnToggle3D").click();
  await expect(page.locator("#btnToggle3D")).toHaveText("3Dを表示");
  await expect(page.locator("#brewIllustration")).toBeVisible();
  await page.clock.runFor(15000);
  expect(
    Number(await page.locator("#artCupLiquid").getAttribute("y")),
  ).toBeLessThan(370);
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
test("reduced motion suppresses decorative particles while measured cup progress remains visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.clock.runFor(2000);
  expect(
    await page
      .locator("#artGrounds circle")
      .evaluateAll((nodes) =>
        nodes.every((n) => Number(n.getAttribute("opacity")) === 0),
      ),
  ).toBe(true);
  await page.clock.runFor(14000);
  await expect(page.locator("#brewIllustration")).toBeVisible();
  expect(
    Number(await page.locator("#artCupLiquid").getAttribute("y")),
  ).toBeLessThan(370);
  expect(Number(await page.locator("#artSteam").getAttribute("opacity"))).toBe(
    0,
  );
});
