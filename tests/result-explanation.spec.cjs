const { test, expect } = require("@playwright/test");

async function setup(page) {
  await page.goto("/");
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "simple");
  await page.locator(".physics-settings summary").click();
}
async function finish(page) {
  await page.locator("#btnPrimary").click();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultScreen")).toBeVisible();
}
test("result explains taste, evidence and a concrete one-setting experiment before details", async ({
  page,
}, info) => {
  await setup(page);
  await finish(page);
  const order = await page.evaluate(() =>
    [
      "tasteTitle",
      "resultEvidenceTitle",
      "nextChangeTitle",
      "recipeSnapshot",
    ].map((id) => document.getElementById(id).getBoundingClientRect().top),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  await expect(page.locator("#resultEvidence")).toContainText(
    await page.locator("#resultEY").innerText(),
  );
  await expect(page.locator("#resultEvidence")).toContainText(
    await page.locator("#resultTDS").innerText(),
  );
  await expect(page.locator("#nextChangeValues")).toHaveText(
    "湯温 93.0 ℃ → 94.0 ℃",
  );
  await expect(page.locator("#shotScore")).toBeHidden();
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("taste-evidence-next.png"),
    fullPage: true,
  });
  await page.locator("#scoreDetails summary").click();
  await expect(page.locator("#shotScore")).toHaveText("93");
  const { AxeBuilder } = require("@axe-core/playwright");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator("#btnApplySuggestion").click();
  await expect(page.locator("#paramWaterTemp")).toHaveValue("94");
  await expect(page.locator("#paramDose")).toHaveValue("18");
  await expect(page.locator("#paramGrindSize")).toHaveValue("380");
  await finish(page);
  await expect(page.locator("#recipeSnapshot")).toContainText("94.0 ℃");
  await expect(page.locator("#lastComparison")).toBeVisible();
});
test("zero-output report withholds taste and applies only the explained pressure profile change", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#paramProfilePreset").selectOption("custom");
  await page.locator("#customEditor summary").click();
  const inputs = page.locator('#customPointInputs input[aria-label$="bar"]');
  for (let i = 0; i < (await inputs.count()); i++) {
    await inputs.nth(i).fill("0");
    await inputs.nth(i).dispatchEvent("change");
  }
  await finish(page);
  await expect(page.locator("#tasteTitle")).toContainText("届きません");
  await expect(page.locator("#tasteTags")).toBeHidden();
  await expect(page.locator("#scoreDetails")).toBeHidden();
  await page.locator("#analyticsDetails summary").click();
  await expect(page.locator("#resultFlavor")).toBeHidden();
  await expect(page.locator("#resultEvidence")).toContainText("0.0 bar");
  await expect(page.locator("#nextChangeValues")).toContainText(
    "カスタム → 蒸らしてから抽出",
  );
  await page.locator("#btnApplySuggestion").click();
  await expect(page.locator("#paramProfilePreset")).toHaveValue("preinfusion");
  await expect(page.locator("#paramWaterTemp")).toHaveValue("93");
  await finish(page);
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});

test("a manually stopped GPU report repeats the exact recipe without diagnosing slow extraction", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: {}, configurable: true }),
  );
  await page.goto("/");
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "gpu");
  await page.locator(".physics-settings summary").click();
  await page.evaluate(() => {
    GpuBrewSession.create = async ({ recipe, onComplete }) => ({
      start() {},
      attachScene() {},
      dispose() {},
      finishEarly() {
        const shot = BrewModel.fromMeasurements(
          recipe,
          [
            { t: 0, p: 0, q: 0, yield: 0, solute: 0 },
            { t: 8, p: 9, q: 1, yield: 6, solute: 0.6 },
          ],
          { diagnostics: { particleCount: 32768 } },
        );
        shot.stopReason = "ユーザー操作で終了";
        onComplete(shot);
      },
    });
  });
  await page.locator("#btnPrimary").click();
  await expect(page.locator("#btnSkipBrew")).toBeEnabled();
  await page.locator("#btnSkipBrew").click();
  await expect(page.locator("#resultYield")).toHaveText("6.0 g");
  await expect(page.locator("#resultTime")).toHaveText("8.0 s");
  await expect(page.locator("#tasteTags")).toBeHidden();
  await expect(page.locator("#scoreDetails")).toBeHidden();
  await page.locator("#analyticsDetails summary").click();
  await expect(page.locator("#resultFlavor")).toBeHidden();
  await expect(page.locator("#nextExperimentTitle")).toContainText("同じ設定");
  await expect(page.locator("#nextChangeValues")).toHaveText("設定はそのまま");
  await expect(page.locator("#resultEvidence")).not.toContainText("120秒");
  await expect(page.locator("#tasteDescription")).toContainText(
    "完成時の味は判断できません",
  );
  await page.getByRole("button", { name: "同じ設定で、次の一杯へ" }).click();
  await expect(page.locator("#paramWaterTemp")).toHaveValue("93");
  await expect(page.locator("#paramGrindSize")).toHaveValue("380");
  await expect(page.locator("#paramDose")).toHaveValue("18");
  await expect(page.locator("#paramTargetYield")).toHaveValue("36");
});
