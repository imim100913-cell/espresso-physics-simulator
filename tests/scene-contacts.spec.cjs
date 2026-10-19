const { test, expect } = require("@playwright/test");

// Use the production SVG and renderer, isolated from playback, to inspect exact
// instants on both sides of a scene cut and every supported dose/viewport.
async function fixture(page, style) {
  const html = await (await page.request.get("/")).text();
  const svg = html.match(/<svg\s+id="brewIllustration"[\s\S]*?<\/svg>/)?.[0];
  expect(svg).toBeTruthy();
  await page.route("**/scene-contact-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/index.css"></head><body style="margin:0;padding:0"><div class="viewport" id="viewport3DContainer"><div class="visual-fallback">${svg}</div></div>${["brew-model", "brew-workflow", "brew-layout", "brew-artwork", "brew-illustration"].map((name) => `<script src="/js/${name}.js"></script>`).join("")}<script>window.art = new BrewIllustration(document.getElementById('brewIllustration'), {style:'${style}'});art.update({elapsed:0,params:BrewModel.defaults});</script></body></html>`,
    }),
  );
  await page.goto("/scene-contact-fixture");
  await expect(page.locator("#brewIllustration")).toHaveAttribute(
    "data-artwork",
    style,
  );
}

for (const style of ["photo", "diagram"]) {
  test(`${style}: tools stay inside the frame and cup, supports, powder and liquid keep physical contacts`, async ({
    page,
  }, info) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page, style);
    const failures = [];
    for (const [width, height] of [
      [320, 740],
      [412, 915],
      [915, 412],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      // Allow the background's ResizeObserver to fit the visible SVG coordinates.
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const result = await page.evaluate(
        ({ style }) => {
          const failures = [],
            root = document.getElementById("brewIllustration");
          const viewport = document
            .getElementById("viewport3DContainer")
            .getBoundingClientRect();
          const point = (node, x, y) =>
            new DOMPoint(x, y).matrixTransform(node.getScreenCTM());
          const node = (id) => document.getElementById(id);
          const visible = (element) => {
            for (let p = element; p && p !== root; p = p.parentElement) {
              const css = getComputedStyle(p);
              if (css.display === "none" || +css.opacity === 0) return false;
            }
            return true;
          };
          const times = [
            0, 0.02, 0.6, 1.6, 2.999, 3, 3.02, 6.6, 7.499, 7.5, 7.52, 8.7,
            9.999, 10, 10.6, 10.9, 11.5, 12.2, 12.999, 13, 13.02, 14.999, 15,
            15.02, 16, 24, 39, 100,
          ];
          for (const dose of [8, 18, 24]) {
            const shot = BrewModel.simulate({ ...BrewModel.defaults, dose });
            for (const elapsed of times) {
              art.update({
                elapsed,
                params: shot.params,
                sample: BrewModel.sampleAt(shot, Math.max(0, elapsed - 15)),
              });
              const phase = root.dataset.phase;
              const check = (condition, message) => {
                if (!condition)
                  failures.push({ dose, elapsed, phase, message });
              };
              const inside = (p, label) =>
                check(
                  p.x >= viewport.left - 0.5 &&
                    p.x <= viewport.right + 0.5 &&
                    p.y >= viewport.top - 0.5 &&
                    p.y <= viewport.bottom + 0.5,
                  `${label} outside viewport: ${p.x}, ${p.y}`,
                );
              if (style === "photo") {
                for (const svg of root.querySelectorAll(
                  "#artScene svg[data-art-bounds]",
                )) {
                  if (!visible(svg)) continue;
                  const x = +svg.getAttribute("x"),
                    y = +svg.getAttribute("y"),
                    w = +svg.getAttribute("width"),
                    h = +svg.getAttribute("height");
                  for (const [px, py] of [
                    [x, y],
                    [x + w, y],
                    [x, y + h],
                    [x + w, y + h],
                  ])
                    inside(
                      point(svg.parentElement, px, py),
                      svg.parentElement.parentElement.id,
                    );
                }
              }
              const geometry =
                style === "diagram"
                  ? "#artWeigh,#artGrinder,#artBasket,#artWdt,#artTamper,#artPrepMat,#artTampingStand,#artShotScale,#artCup > path,#artCup > ellipse,#artSteam"
                  : "#artBed,#artWetBed,#artTampingStand,#artPrepMat,#artShotScale,#artWeighReadout,#artMachineTemp,#artSteam";
              for (const shape of root.querySelectorAll(geometry)) {
                if (!visible(shape)) continue;
                const b = shape.getBBox();
                for (const [x, y] of [
                  [b.x, b.y],
                  [b.x + b.width, b.y + b.height],
                ])
                  inside(point(shape, x, y), shape.id || shape.tagName);
              }
              if (["distribute", "tamp"].includes(phase)) {
                const foot = point(node("artBasket"), 320, 248),
                  cradle = node("artTampingStand").querySelector(
                    "ellipse:nth-child(3)",
                  );
                const center = point(cradle, 320, +cradle.getAttribute("cy"));
                check(
                  Math.abs(foot.y - center.y) < 5,
                  "portafilter misses the tamping cradle",
                );
              }
              if (phase === "grind") {
                const foot = point(node("artBasket"), 320, 248);
                const platform =
                  style === "photo"
                    ? point(root, 320, 316)
                    : point(node("artGrinder"), 320, 246);
                check(
                  Math.abs(foot.y - platform.y) < 0.2,
                  "portafilter misses the grinder support",
                );
                const chute =
                  style === "photo"
                    ? point(root, 316.5, 237.25)
                    : point(node("artGrinder"), 320, 148);
                for (const grain of node("artGrounds").children)
                  if (visible(grain)) {
                    const p = point(
                      grain,
                      +grain.getAttribute("cx"),
                      +grain.getAttribute("cy"),
                    );
                    check(
                      p.y >= chute.y - 0.5 && p.y < foot.y,
                      "grounds escape the chute-to-basket path",
                    );
                  }
              }
              if (phase === "tamp" && elapsed >= 10.9 && elapsed <= 12.2) {
                const bed = node("artBed"),
                  bounds = bed.getBBox();
                const top = bed.getPointAtLength(
                  (bed.getTotalLength() - bounds.width) / 2,
                );
                const powder = point(bed, top.x, top.y),
                  tip = point(
                    node("artTamper"),
                    320,
                    style === "photo" ? 153 : 157.5,
                  );
                check(
                  Math.abs(tip.y - powder.y) < 0.25,
                  "tamper compresses before touching powder or penetrates it",
                );
              }
              if (["setup", "extract"].includes(phase)) {
                const cupFoot = point(
                  node("artCup"),
                  320,
                  style === "photo" ? 377.5 : 377,
                );
                const plate = point(node("artShotScale"), 320, 281);
                check(
                  Math.abs(cupFoot.y - plate.y) < 0.1,
                  "cup floats above scale",
                );
                const scaleBase = point(node("artShotScale"), 320, 295);
                if (style === "photo") {
                  const image = node("artMachine").querySelector("svg");
                  // The actual machine atlas: tray deck spans source y=741..789.
                  const back = point(image, 660, 741),
                    front = point(image, 660, 789);
                  check(
                    scaleBase.y > back.y && scaleBase.y < front.y,
                    "scale is outside the machine's real drip tray",
                  );
                  const flange = point(image, 660, 630),
                    mount = point(node("artBasket"), 320, 178);
                  check(
                    Math.abs(flange.y - mount.y) < 0.25,
                    "portafilter disconnects from group head",
                  );
                } else {
                  const tray = point(node("artDripTray"), 320, 356);
                  check(
                    Math.abs(scaleBase.y - tray.y) < 0.1,
                    "scale misses drip tray",
                  );
                }
                if (+node("artStreams").getAttribute("opacity") > 0) {
                  const stream = node("artStreams").children[1];
                  const first = stream.getPointAtLength(0),
                    last = stream.getPointAtLength(stream.getTotalLength());
                  const start = point(stream, first.x, first.y),
                    end = point(stream, last.x, last.y);
                  const basket = point(
                    node("artBasket"),
                    320,
                    style === "photo" ? 248 : 245,
                  );
                  const surface = point(
                    node("artCupLiquid"),
                    320,
                    +node("artCupLiquid").getAttribute("y"),
                  );
                  check(
                    Math.abs(start.y - basket.y) < 0.1,
                    "espresso starts in midair",
                  );
                  check(
                    Math.abs(end.y - surface.y) < 0.1,
                    "espresso misses liquid surface",
                  );
                  check(end.y > start.y, "espresso flows upward");
                }
              }
            }
          }
          return failures;
        },
        { style },
      );
      failures.push(...result.map((r) => ({ width, height, ...r })));
      await page.evaluate(() =>
        art.update({
          elapsed: 24,
          params: BrewModel.defaults,
          sample: { p: 9, q: 1.8, yield: 18 },
        }),
      );
      await page
        .locator("#viewport3DContainer")
        .screenshot({ path: info.outputPath(`${style}-${width}.png`) });
    }
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  });
}
