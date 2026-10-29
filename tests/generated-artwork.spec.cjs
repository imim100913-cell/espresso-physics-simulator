const { test, expect } = require("@playwright/test");
async function noGpu(page) {
  await page.addInitScript(() => {
    window.adapterCalls = 0;
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter() {
          adapterCalls++;
          throw new Error("No GPU");
        },
      },
    });
  });
}
async function start(page) {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator("#btnPrimary").click();
}
async function motion(page) {
  return page.evaluate(() => ({
    svg: document.getElementById("brewIllustration").innerHTML,
    backdrop: document.getElementById("richBackdrop")?.style.transform,
    elapsed: document.getElementById("simTimerDisplay").textContent,
    yield: document.getElementById("liveYield").textContent,
  }));
}
test("held tools and materials follow the shot and pause together without GPU", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await noGpu(page);
  const renderer = [];
  page.on("request", (r) => {
    if (r.url().includes("renderer.bundle")) renderer.push(r.url());
  });
  await page.goto("/");
  const art = page.locator("#brewIllustration");
  await expect(art).toHaveAttribute("data-artwork", "photo");
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/assets/generated/"))
      .map((r) => ({ name: r.name, bytes: r.transferSize })),
  );
  await start(page);
  await page.clock.runFor(10500);
  await expect(page.locator("#artTamper .generated-layer image")).toBeVisible();
  const before = await page.locator("#artTamper").getAttribute("transform");
  await page.clock.runFor(900);
  expect(await page.locator("#artTamper").getAttribute("transform")).not.toBe(
    before,
  );
  await page.clock.runFor(12000);
  await expect(page.locator("#richPressureNeedle")).toBeVisible();
  expect(parseFloat(await art.getAttribute("data-fill"))).toBeGreaterThan(0);
  const cup = parseFloat(await page.locator("#liveYield").innerText());
  expect(Number(await art.getAttribute("data-fill"))).toBeCloseTo(cup / 36, 2);
  const pattern = await page
    .locator("#richCremaTexture")
    .getAttribute("patternTransform");
  await page.clock.runFor(400);
  expect(
    await page.locator("#richCremaTexture").getAttribute("patternTransform"),
  ).not.toBe(pattern);
  await page.locator("#btnPrimary").click();
  const frozen = await motion(page);
  await page.clock.runFor(1800);
  expect(await motion(page)).toEqual(frozen);
  await page.locator("#btnPrimary").click();
  await page.clock.runFor(500);
  expect(await motion(page)).not.toEqual(frozen);
  expect(new Set(resources.map((r) => r.name)).size).toBe(4);
  expect(resources.reduce((sum, r) => sum + r.bytes, 0)).toBeLessThan(
    1_500_000,
  );
  expect(await page.evaluate(() => adapterCalls)).toBe(0);
  expect(renderer).toEqual([]);
  await page.locator("#viewport3DContainer").screenshot({
    path: info.outputPath("photographic-extraction.png"),
    style: ".action-dock {visibility:hidden}",
  });
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
for (const stalled of [false, true]) {
  test(`${stalled ? "stalled" : "failed"} generated images keep diagram animation, controls and results usable`, async ({
    page,
  }) => {
    await noGpu(page);
    const pending = [];
    await page.route("**/assets/generated/**", (r) =>
      stalled ? pending.push(r) : r.abort(),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await start(page);
    await page.clock.runFor(24000);
    await expect(page.locator("#brewIllustration")).not.toHaveClass(/art-rich/);
    await expect(page.locator("#brewIllustration")).toHaveAttribute(
      "data-phase",
      "extract",
    );
    expect(
      Number(await page.locator("#artCupLiquid").getAttribute("y")),
    ).toBeLessThan(370);
    await expect(page.locator("#btnPrimary")).toBeEnabled();
    await page.locator("#btnSkipBrew").click();
    await expect(page.locator("#resultYield")).toHaveText("36.0 g");
    for (const r of pending) await r.abort();
    expect(await page.evaluate(() => adapterCalls)).toBe(0);
  });
}
test("photo and diagram switches preserve the paused shot and saved diagram mode fetches no pictures", async ({
  page,
}) => {
  await noGpu(page);
  let images = [];
  page.on("request", (r) => {
    if (r.url().includes("/assets/generated/")) images.push(r.url());
  });
  await page.goto("/");
  const art = page.locator("#brewIllustration");
  await expect(art).toHaveAttribute("data-artwork", "photo");
  await start(page);
  await page.clock.runFor(22000);
  await page.locator("#btnPrimary").click();
  const paused = await motion(page);
  await page.locator("#viewSettings summary").click();
  await page.locator("#illustrationStyle").selectOption("diagram");
  await expect(art).toHaveAttribute("data-artwork", "diagram");
  await expect(page.locator("#richBackdrop")).toBeHidden();
  await expect(page.locator("#artHead")).toBeVisible();
  const diagram = await motion(page);
  expect(diagram.elapsed).toBe(paused.elapsed);
  expect(diagram.yield).toBe(paused.yield);
  await page.locator("#illustrationStyle").selectOption("photo");
  await expect(art).toHaveAttribute("data-artwork", "photo");
  expect((await motion(page)).elapsed).toBe(paused.elapsed);
  await page.locator("#illustrationStyle").selectOption("diagram");
  await page.locator("#btnSkipBrew").click();
  images = [];
  await page.reload();
  await expect(art).toHaveAttribute("data-artwork", "diagram");
  await start(page);
  await page.clock.runFor(500);
  expect(images).toEqual([]);
  await expect(page.locator("#artWeigh")).toBeVisible();
});
test("data-saving mode uses the diagram until photographic art is explicitly selected", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    }),
  );
  await noGpu(page);
  const images = [];
  page.on("request", (r) => {
    if (r.url().includes("/assets/generated/")) images.push(r.url());
  });
  await page.goto("/");
  const art = page.locator("#brewIllustration");
  await expect(art).toHaveAttribute("data-artwork", "diagram");
  expect(images).toEqual([]);
  await page.locator("#btnPrimary").click();
  await page.locator("#viewSettings summary").click();
  await page.locator("#illustrationStyle").selectOption("photo");
  await expect(art).toHaveAttribute("data-artwork", "photo");
  expect(images.length).toBeGreaterThan(0);
  await expect(
    page.locator("#artWeigh .generated-layer").first(),
  ).toBeVisible();
});
