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
async function advanceTo(page, seconds) {
  const elapsed = parseFloat(
    await page.locator("#simTimerDisplay").innerText(),
  );
  await page.clock.runFor(Math.max(0, seconds - elapsed) * 1000);
}
async function stageShot(page, info, name) {
  await page.locator("#viewport3DContainer").screenshot({
    path: info.outputPath(name + ".png"),
    style: ".action-dock { visibility: hidden; }",
  });
}
const props = [
  "Weigh",
  "Grinder",
  "Basket",
  "Wdt",
  "Tamper",
  "PrepMat",
  "Machine",
  "Cup",
  "ShotScale",
];
async function equipment(page, visible) {
  for (const prop of props) {
    if (visible.includes(prop))
      await expect(page.locator("#art" + prop)).toBeVisible();
    else await expect(page.locator("#art" + prop)).toBeHidden();
  }
}
test("barista scenes show only each step's tools, then wetting and measured cup filling without GPU", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = await setup(page);
  const art = page.locator("#brewIllustration");
  await expect(art).toBeVisible();
  await expect(art).toHaveAttribute("data-artwork", "photo");
  await expect(page.locator("#viewSettings")).not.toHaveAttribute("open");
  // No machine, grinder, portafilter or cup belongs in bean weighing.
  await advanceTo(page, 2.5);
  await expect(art).toHaveAttribute("data-phase", "weigh");
  await equipment(page, ["Weigh"]);
  await expect(page.locator("#artWeighReadout")).toHaveText("18.0 g");
  await expect(page.locator("#nextPhaseLabel")).toHaveText("豆を挽く");
  await expect(page.locator("#extractionReadings")).toBeHidden();
  await stageShot(page, info, "01-weigh");

  await advanceTo(page, 6.6);
  await expect(art).toHaveAttribute("data-phase", "grind");
  await equipment(page, ["Grinder", "Basket"]);
  const looseBed = await page.locator("#artBed").getAttribute("d");
  const bounds = await page.locator("#artBed").evaluate((node) => ({
    height: node.getBBox().height,
    width: node.getBBox().width,
  }));
  expect(bounds.height).toBeGreaterThan(30);
  expect(bounds.height).toBeLessThan(70);
  expect(bounds.width).toBeCloseTo(98, 0);
  await stageShot(page, info, "02-grind");

  await advanceTo(page, 8.7);
  await expect(art).toHaveAttribute("data-phase", "distribute");
  await equipment(page, ["Basket", "Wdt", "PrepMat"]);
  await expect(page.locator("#phaseDistribute")).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.locator("#nextPhaseLabel")).toHaveText("水平にタンピング");
  await stageShot(page, info, "03-wdt");

  await advanceTo(page, 11.9);
  await expect(art).toHaveAttribute("data-phase", "tamp");
  await equipment(page, ["Basket", "Tamper", "PrepMat"]);
  expect(await page.locator("#artBed").getAttribute("d")).not.toBe(looseBed);
  expect(
    await page.locator("#artBed").evaluate((n) => n.getBBox().height),
  ).toBeLessThan(bounds.height);
  await stageShot(page, info, "04-tamp");

  await advanceTo(page, 14.1);
  await expect(art).toHaveAttribute("data-phase", "setup");
  await equipment(page, ["Machine", "Basket", "Cup", "ShotScale"]);
  await expect(page.locator("#artShotWeight")).toHaveText("0.0 g");
  expect(
    Number(await page.locator("#artStreams").getAttribute("opacity")),
  ).toBe(0);
  expect(
    Number(await page.locator("#artWetFront").getAttribute("height")),
  ).toBe(0);
  await expect(page.locator("#liveShotTime")).toHaveText("0.0 s");
  await stageShot(page, info, "05-setup");

  await advanceTo(page, 24);
  await expect(art).toHaveAttribute("data-phase", "extract");
  await equipment(page, ["Machine", "Basket", "Cup", "ShotScale"]);
  await expect(page.locator("#preparationReading")).toBeHidden();
  await expect(page.locator("#extractionReadings")).toBeVisible();
  await expect(page.locator("#nextPhaseLabel")).toContainText("レポート");
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
  expect(Number(await art.getAttribute("data-fill"))).toBeCloseTo(live / 36, 2);
  const time = parseFloat(await page.locator("#liveShotTime").innerText());
  const elapsed = parseFloat(
    await page.locator("#simTimerDisplay").innerText(),
  );
  expect(elapsed - time).toBeCloseTo(15, 0);
  await stageShot(page, info, "06-extract");
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => gpuCalls)).toBe(0);
  expect(errors).toEqual([]);
});
test("pausing freezes tools and stage cuts; resuming follows the same clock", async ({
  page,
}) => {
  await setup(page);
  for (const t of [1.5, 8.5, 23]) {
    await advanceTo(page, t);
    await page.locator("#btnPrimary").click();
    const art = page.locator("#brewIllustration");
    const frozen = await art.innerHTML(),
      phase = await art.getAttribute("data-phase");
    await page.clock.runFor(2500);
    expect(await art.innerHTML()).toBe(frozen);
    await expect(art).toHaveAttribute("data-phase", phase);
    await page.locator("#btnPrimary").click();
    await page.clock.runFor(700);
    expect(await art.innerHTML()).not.toBe(frozen);
  }
});
test("3D is deferred to extraction and failed initialization preserves the moving illustration", async ({
  page,
}) => {
  const requests = await setup(page);
  await page.route("**/renderer.bundle.js*", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: 'export class EspressoScene{constructor(){throw new Error("GPU initialization failed");}}',
    }),
  );
  await page.locator("#viewSettings summary").click();
  await page.locator("#btnToggle3D").click();
  await expect(page.locator("#btnToggle3D")).toHaveText("3Dをオフ");
  await advanceTo(page, 5);
  expect(requests).toEqual([]);
  await expect(page.locator("#artMachine")).toBeHidden();
  await advanceTo(page, 24);
  await expect(page.locator("#btnToggle3D")).toHaveText("3Dを表示");
  await expect(page.locator("#brewIllustration")).toBeVisible();
  expect(
    Number(await page.locator("#artCupLiquid").getAttribute("y")),
  ).toBeLessThan(370);
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
test("recipe weight and temperature are reflected in the matching scenes; reduced motion keeps progress", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.locator("#btnCancelBrew").click();
  await page.locator("#paramDose").fill("20");
  await page.locator("#paramDose").dispatchEvent("input");
  await page.locator("#paramWaterTemp").fill("95");
  await page.locator("#paramWaterTemp").dispatchEvent("input");
  await page.locator("#btnPrimary").click();
  await advanceTo(page, 2.5);
  await expect(page.locator("#artWeighReadout")).toHaveText("20.0 g");
  await expect(page.locator("#prepMetricValue")).toHaveText("20.0 g");
  await advanceTo(page, 6);
  expect(
    await page
      .locator("#artGrounds circle")
      .evaluateAll((nodes) =>
        nodes.every((n) => Number(n.getAttribute("opacity")) === 0),
      ),
  ).toBe(true);
  await advanceTo(page, 24);
  await expect(page.locator("#brewIllustration")).toBeVisible();
  await expect(page.locator("#artMachineTemp")).toHaveText("95°C");
  expect(
    Number(await page.locator("#artCupLiquid").getAttribute("y")),
  ).toBeLessThan(370);
  expect(Number(await page.locator("#artSteam").getAttribute("opacity"))).toBe(
    0,
  );
});
