const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/brew-model.js");
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test("presets hit the requested output and conserve dissolved mass throughout the shot", () => {
  for (const params of Object.values(M.presets)) {
    const original = structuredClone(params),
      s = M.simulate(params);
    assert.deepEqual(params, original);
    assert.ok(s.complete);
    close(s.output, params.targetYield);
    close(s.samples.at(-1).t, s.duration);
    close(s.samples.at(-1).ey, s.ey);
    close(s.samples.at(-1).tdsCup, s.tds);
    for (let i = 1; i < s.samples.length; i++) {
      const a = s.samples[i - 1],
        b = s.samples[i];
      assert.ok(b.t > a.t);
      assert.ok(b.yield >= a.yield);
      assert.ok(b.ey >= a.ey - 1e-6);
      close(b.ey, (b.tdsCup * b.yield) / params.dose);
      assert.ok(b.p >= 0 && b.p <= 12);
    }
    assert.equal(
      s.score,
      s.breakdown.reduce((n, c) => n + c.value, 0),
    );
    close(M.sampleAt(s, s.duration + 10).yield, s.output);
    close(M.sampleAt(s, -10).yield, 0);
  }
});
test("coarser grind speeds up a shot and changes the flavor estimate", () => {
  const fine = M.simulate({ ...M.defaults, grindSize: 300 }),
    coarse = M.simulate({ ...M.defaults, grindSize: 500 });
  assert.ok(fine.duration > coarse.duration);
  assert.ok(fine.ey > coarse.ey);
  assert.notEqual(fine.flavor.acidity, coarse.flavor.acidity);
});
test("pressure profiles influence the same flow trace used for playback", () => {
  const flat = M.simulate({ ...M.defaults, pressureProfile: "flat" }),
    bloom = M.simulate({ ...M.defaults, pressureProfile: "blooming" });
  assert.ok(bloom.duration > flat.duration);
  assert.equal(M.sampleAt(bloom, 6).p, 0);
  assert.equal(M.sampleAt(bloom, 6).q, 0);
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const sample = M.sampleAt(bloom, bloom.duration * f);
    assert.ok(Number.isFinite(sample.tdsCup));
    assert.ok(sample.yield <= bloom.output);
  }
});
test("stalled and zero-pressure shots stop at 120 seconds without invented output or a high score", () => {
  for (const params of [
    {
      ...M.defaults,
      grindSize: 180,
      dose: 24,
      targetYield: 60,
      maxPressure: 3,
    },
    {
      ...M.defaults,
      pressureProfile: "custom",
      customPoints: [
        { t: 0, p: 0 },
        { t: 120, p: 0 },
      ],
    },
  ]) {
    const s = M.simulate(params);
    assert.equal(s.complete, false);
    assert.equal(s.duration, 120);
    assert.ok(s.score <= 40);
    assert.ok(s.output < params.targetYield);
    assert.ok(
      [s.output, s.ey, s.tds, s.score, ...Object.values(s.flavor)].every(
        Number.isFinite,
      ),
    );
  }
});
test("shared or persisted input is bounded, typed, and safe from unknown keys", () => {
  const p = M.normalize(
    JSON.parse(
      '{"dose":0,"waterTemp":999,"pressureProfile":"__proto__","roastLevel":"95","burrType":"oops","extra":"x"}',
    ),
  );
  assert.equal(p.dose, 8);
  assert.equal(p.waterTemp, 98);
  assert.equal(p.roastLevel, 65);
  assert.equal(p.pressureProfile, "preinfusion");
  assert.equal(p.extra, undefined);
  assert.equal(M.normalize({ waterTemp: NaN }).waterTemp, 93);
});
test("all input extremes return finite scores and valid next adjustments", () => {
  for (const grindSize of [180, 380, 750])
    for (const dose of [8, 24])
      for (const targetYield of [15, 60])
        for (const waterTemp of [80, 98])
          for (const maxPressure of [3, 12]) {
            const s = M.simulate({
              ...M.defaults,
              grindSize,
              dose,
              targetYield,
              waterTemp,
              maxPressure,
            });
            assert.ok(
              [s.ey, s.tds, s.score, s.duration, s.output].every(
                Number.isFinite,
              ),
            );
            assert.ok(s.score >= 0 && s.score <= 100);
            assert.ok(s.tds <= 25 + 1e-6);
            const next = M.normalize({
              ...s.params,
              [s.next.key]: s.next.value,
            });
            assert.notEqual(next[s.next.key], s.params[s.next.key]);
          }
});

test("invalid custom curves recover to an editable default", () => {
  for (const customPoints of [
    undefined,
    [
      { t: 0, p: 4 },
      { t: 0, p: 8 },
    ],
    [
      { t: NaN, p: 2 },
      { t: 2, p: 9 },
    ],
  ]) {
    const p = M.normalize({
      ...M.defaults,
      pressureProfile: "custom",
      customPoints,
    });
    assert.ok(p.customPoints.length >= 2);
    assert.ok(M.simulate(p).complete);
  }
});
