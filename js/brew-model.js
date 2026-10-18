/* Educational estimates, not a calibrated machine model or sensory measurement.
 * One immutable shot supplies playback, the timeline, and the final report. */
(function (root) {
  "use strict";
  const defaults = Object.freeze({
    roastLevel: 65,
    beanAge: 14,
    grindSize: 380,
    burrType: "flat_std",
    grinderRPM: 400,
    dose: 18,
    targetYield: 36,
    basketDiameter: 58,
    tampForce: 15,
    waterTemp: 93,
    maxPressure: 9,
    pressureProfile: "preinfusion",
    waterGH: 100,
  });
  const limits = {
    roastLevel: [35, 95, 1],
    beanAge: [1, 45, 1],
    grindSize: [180, 750, 5],
    grinderRPM: [30, 1400, 10],
    dose: [8, 24, 0.1],
    targetYield: [15, 60, 0.5],
    tampForce: [0, 25, 1],
    waterTemp: [80, 98, 0.5],
    maxPressure: [3, 12, 0.5],
    waterGH: [0, 250, 5],
  };
  const profiles = {
    flat: "一定圧",
    preinfusion: "蒸らしてから抽出",
    declining: "徐々に圧力を下げる",
    blooming: "蒸らしを長く",
    turbo: "ターボ抽出",
    custom: "カスタム",
  };
  const presets = {
    balanced: { ...defaults },
    bright: {
      ...defaults,
      roastLevel: 85,
      grindSize: 350,
      targetYield: 42,
      waterTemp: 94,
      maxPressure: 6,
      pressureProfile: "declining",
    },
    bold: {
      ...defaults,
      roastLevel: 45,
      grindSize: 340,
      targetYield: 30,
      waterTemp: 91,
      pressureProfile: "flat",
    },
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function normalize(input = {}) {
    const p = { ...defaults };
    for (const [key, [lo, hi, step]] of Object.entries(limits)) {
      if (typeof input[key] === "number" && Number.isFinite(input[key]))
        p[key] = +clamp(Math.round(input[key] / step) * step, lo, hi).toFixed(
          2,
        );
    }
    if (
      ["flat_high", "flat_std", "conical_std", "conical_trad"].includes(
        input.burrType,
      )
    )
      p.burrType = input.burrType;
    if ([51, 54, 58].includes(input.basketDiameter))
      p.basketDiameter = input.basketDiameter;
    if (Object.hasOwn(profiles, input.pressureProfile))
      p.pressureProfile = input.pressureProfile;
    if (
      Array.isArray(input.customPoints) &&
      input.customPoints.length >= 2 &&
      input.customPoints.length <= 20 &&
      input.customPoints.every(
        (pt) => pt && Number.isFinite(pt.t) && Number.isFinite(pt.p),
      )
    ) {
      p.customPoints = input.customPoints
        .map((pt) => ({
          t: clamp(pt.t, 0, 120),
          p: clamp(pt.p, 0, p.maxPressure),
        }))
        .sort((a, b) => a.t - b.t);
      p.customPoints = p.customPoints.filter(
        (pt, i, arr) => !i || pt.t > arr[i - 1].t,
      );
    }
    if (
      p.pressureProfile === "custom" &&
      (!p.customPoints || p.customPoints.length < 2)
    ) {
      p.customPoints = [
        { t: 0, p: 2 },
        { t: 4, p: 2 },
        { t: 6, p: p.maxPressure },
        { t: 35, p: p.maxPressure },
      ];
    }
    return p;
  }
  function pressureAt(t, p) {
    const max = p.maxPressure;
    if (p.pressureProfile === "custom" && p.customPoints?.length >= 2) {
      const pts = p.customPoints;
      if (t <= pts[0].t) return pts[0].p;
      for (let i = 1; i < pts.length; i++)
        if (t <= pts[i].t)
          return (
            pts[i - 1].p +
            ((pts[i].p - pts[i - 1].p) * (t - pts[i - 1].t)) /
              (pts[i].t - pts[i - 1].t)
          );
      return pts.at(-1).p;
    }
    if (p.pressureProfile === "flat") return max;
    if (p.pressureProfile === "turbo") return Math.min(max, 6);
    if (p.pressureProfile === "blooming") {
      if (t < 3) return Math.min(max, 3);
      if (t < 9) return 0;
      return Math.min(max, ((t - 9) * max) / 2);
    }
    if (t < 4) return Math.min(2, max);
    if (t < 6)
      return Math.min(2, max) + ((max - Math.min(2, max)) * (t - 4)) / 2;
    return p.pressureProfile === "declining"
      ? Math.max(max * 0.55, max - (t - 6) * max * 0.015)
      : max;
  }
  function simulate(input) {
    const p = normalize(input);
    const roast = (95 - p.roastLevel) / 60;
    const fines = clamp(
      (p.burrType.startsWith("flat") ? 0.12 : 0.22) *
        (1 + 0.5 * (0.3 + 0.7 * roast ** 1.5)) *
        (1 + (0.2 * (p.grinderRPM - 400)) / 400),
      0.05,
      0.45,
    );
    const eps = 0.5 - 0.12 * (1 - Math.exp(-p.tampForce / 5));
    // Relative resistance approximation, normalized to a typical 18 g basket.
    const flowAt9 = clamp(
      (2 *
        (p.grindSize / 380) ** 2 *
        (18 / p.dose) *
        (p.basketDiameter / 58) ** 4 *
        Math.exp((p.waterTemp - 93) * 0.025) *
        ((1 - fines) / (1 - 0.153)) ** 2 *
        (eps / 0.386) ** 3) /
        (1 + 0.18 * Math.exp(-p.beanAge / 7)),
      0.1,
      10,
    );
    const risk = clamp(
      5 +
        Math.max(0, 260 - p.grindSize) * 0.6 +
        Math.max(0, p.maxPressure - 9.5) * 12 +
        (fines > 0.25 ? 10 : 0),
      5,
      95,
    );
    const samples = [{ t: 0, p: pressureAt(0, p), q: 0, yield: 0 }];
    let output = 0;
    for (let i = 1; i <= 1200 && output < p.targetYield; i++) {
      const t = i / 10;
      const pressure = pressureAt(t, p);
      const q = flowAt9 * (pressure / 9) * clamp((t - 0.8) / 2, 0, 1);
      const amount = Math.min(q * 0.1, p.targetYield - output);
      const prev = samples.at(-1);
      const actualT = q > 0 && amount < q * 0.1 ? prev.t + amount / q : t;
      output += amount;
      samples.push({ t: actualT, p: pressureAt(actualT, p), q, yield: output });
    }
    const duration = samples.at(-1).t;
    const complete = output >= p.targetYield - 1e-6;
    const candidateEY =
      output === 0
        ? 0
        : clamp(
            14 +
              7.5 *
                (1 - Math.exp(-duration / 14)) *
                (1 + (p.waterTemp - 93) * 0.02) *
                (380 / p.grindSize) ** 0.45 *
                (1 + (p.waterGH - 100) * 0.0002) -
              Math.max(0, risk - 35) * 0.08,
            10,
            26,
          );
    // Avoid impossible concentrations when a shot is almost completely blocked.
    const ey = Math.min(candidateEY, (output * 25) / p.dose);
    const tds = output > 0 ? (ey * p.dose) / output : 0;
    for (const s of samples) {
      const fraction = output > 0 ? s.yield / output : 0;
      s.tdsCup = fraction > 0 ? tds * (1 + 0.8 * (1 - fraction)) : 0;
      s.ey = (s.tdsCup * s.yield) / p.dose;
      s.tdsInst = fraction > 0 ? Math.max(0, tds * (1.8 - 1.6 * fraction)) : 0;
      s.epsTop = eps - 0.03 * (s.p / 9);
      s.epsMid = eps - 0.05 * (s.p / 9);
      s.epsBot = eps - 0.08 * (s.p / 9);
    }
    return {
      params: p,
      samples,
      duration,
      output,
      complete,
      ey,
      tds,
      risk,
      fines,
      ...assess(p, { duration, complete, ey, tds, risk }),
    };
  }
  function assess(p, { duration, complete, ey, tds, risk }) {
    const roast = (95 - p.roastLevel) / 60;
    const flavor = {
      acidity: clamp(
        (10 - roast * 6) * (1 - Math.min(0.4, duration / 45)),
        1,
        10,
      ),
      sweetness: clamp(8.5 - Math.abs(ey - 20) * 0.7, 1, 10),
      bitterness: clamp(
        3 +
          roast * 4.5 +
          (p.waterTemp - 90) * 0.3 +
          Math.max(0, ey - 22) * 0.35,
        1,
        10,
      ),
      astringency: clamp(2 + risk * 0.05 + Math.max(0, ey - 22) * 0.35, 1, 10),
      body: clamp(
        (tds * 6.5 + roast * 20 + (p.maxPressure / 9) * 12) / 10,
        2,
        9.8,
      ),
    };
    const breakdown = [
      {
        label: "抽出のバランス",
        value: Math.round(clamp(40 - Math.abs(ey - 20) * 5, 0, 40)),
        max: 40,
      },
      {
        label: "甘味の引き出し",
        value: Math.round((flavor.sweetness / 10) * 25),
        max: 25,
      },
      {
        label: "均一さの目安",
        value: Math.round((1 - risk / 100) * 20),
        max: 20,
      },
      {
        label: "濃度のバランス",
        value: Math.round(clamp(15 - Math.abs(tds - 9) * 2, 0, 15)),
        max: 15,
      },
    ];
    const rawScore = breakdown.reduce((n, s) => n + s.value, 0);
    const score = complete ? rawScore : Math.min(40, rawScore);
    let title, description, next;
    if (!complete) {
      title = "ゆっくりすぎる一杯";
      description =
        "120秒で目標量に届きませんでした。流れが遅く、味の偏りが出る可能性があります。";
      next =
        p.pressureProfile === "custom"
          ? {
              key: "pressureProfile",
              value: "preinfusion",
              label: "おすすめの圧力のかけ方に戻す",
              reason:
                "カスタム圧力の低すぎる区間をなくし、お湯が流れる設定から試しましょう。",
            }
          : {
              key: "grindSize",
              value: clamp(p.grindSize + 30, 180, 750),
              label: "挽き目を30 µm粗くする",
              reason:
                "粉の間を水が通りやすくし、目標量までの時間を短くします。",
            };
    } else if (risk > 35) {
      title = "抽出ムラが気になる一杯";
      description =
        "水が一部に集中し、酸味と苦渋味が同時に目立つ可能性があります。";
      next =
        p.maxPressure > 9.5
          ? {
              key: "maxPressure",
              value: 9,
              label: "圧力を9 barに下げる",
              reason: "強すぎる圧力による抽出ムラを抑える方向で試します。",
            }
          : {
              key: "grindSize",
              value: p.grindSize + 20,
              label: "挽き目を20 µm粗くする",
              reason: "細かすぎる粉による流れの偏りを抑える方向で試します。",
            };
    } else if (ey < 18) {
      title = "軽やかで酸味のある一杯";
      description =
        "成分の取り出しが少なめ。酸味が先に立ち、甘味と厚みは控えめになりそうです。";
      next = {
        key: "grindSize",
        value: Math.max(180, p.grindSize - 20),
        label: "挽き目を20 µm細かくする",
        reason: "水と粉が触れる時間を増やし、甘味を引き出す方向で試します。",
      };
    } else if (ey > 22) {
      title = "苦味と余韻の強い一杯";
      description =
        "成分を多く取り出した状態。しっかりした苦味と、渋みの残る後味になりそうです。";
      next = {
        key: "waterTemp",
        value: Math.max(80, p.waterTemp - 1),
        label: "湯温を1 ℃下げる",
        reason: "成分の溶け出しを穏やかにし、苦渋味を抑える方向で試します。",
      };
    } else {
      title =
        flavor.acidity > flavor.bitterness
          ? "果実味を楽しむ一杯"
          : flavor.bitterness > 6.5
            ? "コクと甘味のある一杯"
            : "甘味と酸味が調和する一杯";
      description = `収率はバランスの目安（18〜22%）に入りました。${tds > 11 ? "濃厚な口当たり" : tds < 7 ? "すっきりした口当たり" : "ほどよい厚み"}と、${flavor.acidity > flavor.bitterness ? "明るい酸味" : "やわらかな甘味と焙煎の苦味"}が感じられそうです。`;
      next = {
        key: "waterTemp",
        value: p.waterTemp >= 98 ? p.waterTemp - 1 : p.waterTemp + 1,
        label:
          p.waterTemp >= 98 ? "湯温を1 ℃下げて比べる" : "湯温を1 ℃上げて比べる",
        reason:
          "挽き目や粉量を揃えたまま、温度による味の違いを比べてみましょう。",
      };
    }
    return { flavor, score, breakdown, title, description, next };
  }
  function fromMeasurements(
    input,
    records,
    { risk = 5, diagnostics = null } = {},
  ) {
    const p = normalize(input);
    if (!Array.isArray(records) || records.length < 2)
      throw new Error("GPU samples are missing");
    let previous = -1,
      previousOutput = 0;
    const samples = records.map((s) => {
      if (
        !["t", "p", "q", "yield", "solute"].every((k) =>
          Number.isFinite(s[k]),
        ) ||
        s.t <= previous ||
        s.yield < previousOutput - 1e-6 ||
        s.solute < 0 ||
        s.solute > s.yield + 1e-6
      )
        throw new Error("Invalid physical sample");
      previous = s.t;
      previousOutput = s.yield;
      return {
        ...s,
        tdsCup: s.yield > 0 ? (s.solute / s.yield) * 100 : 0,
        ey: (s.solute / p.dose) * 100,
        tdsInst: s.yield > 0 ? (s.solute / s.yield) * 100 : 0,
        epsTop: s.porosity ?? 0.4,
        epsMid: s.porosity ?? 0.4,
        epsBot: s.porosity ?? 0.4,
      };
    });
    const last = samples.at(-1),
      duration = last.t,
      output = last.yield,
      ey = last.ey,
      tds = last.tdsCup,
      complete = output >= p.targetYield - 0.001;
    risk = clamp(risk, 0, 95);
    return {
      params: p,
      samples,
      duration,
      output,
      complete,
      ey,
      tds,
      risk,
      fines: 0,
      source: "gpu",
      diagnostics,
      ...assess(p, { duration, complete, ey, tds, risk }),
    };
  }
  function sampleAt(shot, time) {
    const t = clamp(time, 0, shot.duration);
    let lo = 0,
      hi = shot.samples.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (shot.samples[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const b = shot.samples[lo],
      a = shot.samples[Math.max(0, lo - 1)];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t),
      result = { t };
    for (const key of ["p", "q", "yield", "tdsCup", "ey"])
      result[key] = a[key] + (b[key] - a[key]) * f;
    return result;
  }
  const api = {
    defaults,
    limits,
    profiles,
    presets,
    normalize,
    simulate,
    sampleAt,
    pressureAt,
    fromMeasurements,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.BrewModel = api;
})(typeof window === "undefined" ? globalThis : window);
