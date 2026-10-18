const { test, expect } = require("@playwright/test");
async function setup(page) {
  await page.route("https://**/*", (r) => r.abort());
  await page.route("**/renderer.bundle.js*", (r) => r.abort());
  await page.goto("/");
  await page.locator(".physics-settings summary").click();
  await page.selectOption("#physicsBackend", "simple");
  await page.locator(".physics-settings summary").click();
}
async function finish(page) {
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await page.getByRole("button", { name: "アニメを省略して結果へ" }).click();
  await expect(page.locator("#resultScreen")).toBeVisible();
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}
test("first visit, pause/resume, finish, rate, and retry with one change", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await expect(page.locator("#setupTitle")).toBeVisible();
  await expect(page.locator(".advanced-only").first()).toBeHidden();
  await noOverflow(page);
  await expect(page.locator('[data-go="result"]')).toBeDisabled();
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await expect(page.locator("#brewScreen")).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "抽出を一時停止する" }).click();
  const stopped = await page.locator("#simTimerDisplay").innerText();
  await page.waitForTimeout(300);
  await expect(page.locator("#simTimerDisplay")).toHaveText(stopped);
  await page.getByRole("button", { name: "抽出を再開する" }).click();
  await page.getByRole("button", { name: "アニメを省略して結果へ" }).click();
  await expect(page.locator("#shotScore")).toHaveText("93");
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
  await expect(page.locator("#resultEY")).toHaveText("20.0 %");
  await expect(
    page.locator("#shotTimeline tr").last().locator("td").nth(2),
  ).toHaveText("36.0");
  await noOverflow(page);
  await page.getByRole("button", { name: "期待度4 / 5" }).click();
  await expect(page.locator("#ratingStatus")).toContainText("保存しました");
  await page.locator("#analyticsDetails summary").click();
  await expect(page.locator("#canvasMultiGraph")).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "この調整で、次の一杯へ" }).click();
  await expect(page.locator("#paramWaterTemp")).toHaveValue("94");
  await finish(page);
  await expect(page.locator("#lastComparison")).toContainText("前の一杯と比較");
  expect(errors).toEqual([]);
});
test("natural completion stops at the target output, without pressing skip", async ({
  page,
}) => {
  await setup(page);
  await page.clock.install();
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await page.clock.runFor(31500);
  await expect(page.locator("#resultScreen")).toBeVisible();
  await expect(page.locator("#resultYield")).toHaveText("36.0 g");
});
test("saved recipes survive reload, user labels are text, reset works", async ({
  page,
}) => {
  await setup(page);
  await page.locator('[data-preset="bright"]').click();
  await page.getByRole("button", { name: "保存したレシピを開く" }).click();
  await page.locator("#inputRecipeName").fill("<img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".saved-recipe strong")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator(".saved-recipe img")).toHaveCount(0);
  await page.getByRole("button", { name: "マイレシピを閉じる" }).click();
  await page.reload();
  await page.getByRole("button", { name: "保存したレシピを開く" }).click();
  await page
    .getByRole("button", { name: "<img src=x onerror=alert(1)>を使う" })
    .click();
  await expect(page.locator("#paramRoastLevel")).toHaveValue("85");
  await page.getByRole("button", { name: "おすすめに戻す" }).click();
  await expect(page.locator("#paramRoastLevel")).toHaveValue("65");
});
test("shared recipe restores all settings and malformed input recovers", async ({
  page,
}) => {
  await setup(page);
  const params = {
    roastLevel: 45,
    grindSize: 340,
    dose: 18,
    targetYield: 30,
    waterTemp: 91,
    maxPressure: 9,
    pressureProfile: "flat",
  };
  await page.goto("/#recipe=" + encodeURIComponent(JSON.stringify(params)));
  await page.reload();
  await expect(page.locator("#paramTargetYield")).toHaveValue("30");
  await finish(page);
  await expect(page.locator("#recipeSnapshot")).toContainText("中深煎り / 45");
  await page.goto("/#recipe=%broken");
  await page.reload();
  await expect(page.locator("#paramTargetYield")).toHaveValue("36");
  await expect(page.locator("#toast")).toContainText("読み込めなかった");
});
test("small mobile, landscape, and desktop fit every stage", async ({
  page,
}) => {
  await setup(page);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await noOverflow(page);
    await finish(page);
    await noOverflow(page);
    await page
      .getByRole("button", { name: "レシピを調整する", exact: true })
      .click();
  }
});
test("unavailable local storage does not break brewing or claim to save", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("storage denied");
    };
    Storage.prototype.getItem = () => {
      throw new Error("storage denied");
    };
  });
  await setup(page);
  await finish(page);
  await page.getByRole("button", { name: "期待度5 / 5" }).click();
  await expect(page.locator("#ratingStatus")).toContainText(
    "保存できませんでした",
  );
});
test("custom pressure is editable on touch and stalled shots have an honest report", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#paramProfilePreset").selectOption("custom");
  await page.locator("#customEditor summary").click();
  const pressures = page.locator('#customPointInputs input[aria-label$="bar"]');
  for (let i = 0; i < 4; i++) {
    await pressures.nth(i).fill("0");
    await pressures.nth(i).dispatchEvent("change");
  }
  await expect(page.locator("#estimateTime")).toHaveText("120 秒以上");
  await finish(page);
  await expect(page.locator("#completionTag")).toHaveText("120秒で抽出を終了");
  await expect(page.locator("#resultYield")).toHaveText("0.0 g");
  await expect(page.locator("#shotScore")).not.toHaveText("NaN");
});

test("all three stages, detailed settings, analytics, and recipe dialog pass accessibility checks", async ({
  page,
}) => {
  const { AxeBuilder } = require("@axe-core/playwright");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  const check = async () =>
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await check();
  await page.locator("#modeToggle").check();
  await check();
  await page.getByRole("button", { name: "保存したレシピを開く" }).click();
  await check();
  await page.getByRole("button", { name: "マイレシピを閉じる" }).click();
  await page.getByRole("button", { name: "このレシピで抽出する" }).click();
  await check();
  await page.getByRole("button", { name: "アニメを省略して結果へ" }).click();
  await check();
  await page.locator("#analyticsDetails summary").click();
  await check();
});
