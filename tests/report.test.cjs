const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/brew-model.js");
const R = require("../js/brew-report.js");

test("report evidence comes from the same shot and its suggestion changes exactly one setting", () => {
  for (const params of Object.values(M.presets)) {
    const shot = M.simulate(params),
      original = structuredClone(shot);
    const report = R.describe(shot);
    assert.equal(report.hasDrink, true);
    assert.ok(
      report.evidence.some((e) => e.value === shot.ey.toFixed(1) + " %"),
    );
    assert.ok(
      report.evidence.some((e) => e.value === shot.tds.toFixed(1) + " %"),
    );
    const next = M.normalize({
      ...shot.params,
      [report.next.key]: report.next.value,
    });
    assert.deepEqual(
      Object.keys(next).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(shot.params[k]),
      ),
      [report.next.key],
    );
    assert.match(report.next.change, /→/);
    assert.deepEqual(shot, original);
  }
});

test("zero output explains the lack of pressure instead of inventing a taste", () => {
  const shot = M.simulate({
    ...M.defaults,
    pressureProfile: "custom",
    customPoints: [
      { t: 0, p: 0 },
      { t: 120, p: 0 },
    ],
  });
  const report = R.describe(shot);
  assert.equal(report.hasDrink, false);
  assert.match(report.title, /届きません/);
  assert.ok(report.evidence.some((e) => e.value === "0.0 bar"));
  assert.ok(
    report.evidence.every((e) => !/口当たり|甘味|酸味/.test(e.explanation)),
  );
  assert.equal(report.next.key, "pressureProfile");
  assert.equal(report.next.value, "preinfusion");
});

test("early GPU results retain their actual time and recommend repeating the same recipe", () => {
  for (const output of [0, 6]) {
    const shot = M.fromMeasurements(M.defaults, [
      { t: 0, p: 0, q: 0, yield: 0, solute: 0 },
      { t: 8, p: 9, q: 1, yield: output, solute: output * 0.1 },
    ]);
    shot.stopReason = "ユーザー操作で終了";
    const report = R.describe(shot);
    assert.equal(report.next.kind, "repeat");
    assert.equal(report.stopped, true);
    assert.doesNotMatch(JSON.stringify(report), /120秒|ゆっくりすぎる/);
    assert.match(report.evidence[0].value, new RegExp(output.toFixed(1)));
    assert.equal(shot.duration, 8);
  }
});

test("limit settings and no-op suggestions always produce a bounded, real single change", () => {
  for (const grindSize of [180, 750])
    for (const waterTemp of [80, 98])
      for (const maxPressure of [3, 12]) {
        const shot = M.simulate({
          ...M.defaults,
          grindSize,
          waterTemp,
          maxPressure,
        });
        shot.next = {
          key: "grindSize",
          value: grindSize,
          label: "変化しない提案",
          reason: "",
        };
        const report = R.describe(shot),
          next = M.normalize({
            ...shot.params,
            [report.next.key]: report.next.value,
          });
        assert.deepEqual(
          Object.keys(next).filter(
            (key) =>
              JSON.stringify(next[key]) !== JSON.stringify(shot.params[key]),
          ),
          [report.next.key],
        );
        assert.equal(next[report.next.key], report.next.value);
      }
});
