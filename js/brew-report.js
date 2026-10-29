/* Explain one completed shot without changing its measurements or recipe. */
(function (root) {
  "use strict";
  const M =
    typeof module === "object" && module.exports
      ? require("./brew-model.js")
      : root.BrewModel;
  const format = (n) => n.toFixed(1);
  const fields = {
    grindSize: ["挽き目", "µm"],
    waterTemp: ["湯温", "℃"],
    maxPressure: ["最大設定圧力", "bar"],
    pressureProfile: ["圧力のかけ方", ""],
  };
  function describe(shot) {
    const p = shot.params;
    const hasDrink = shot.output > 0;
    const stopped = !shot.complete && shot.stopReason === "ユーザー操作で終了";
    let title = shot.title,
      description = shot.description;
    if (!hasDrink) {
      title = "カップに抽出液が届きませんでした";
      description =
        "抽出量は0.0 gです。味の予測を読む前に、お湯が流れる条件で目標量まで試しましょう。";
      if (stopped)
        description =
          "カップに液体が届く前に終了しました。味の予測はまだできません。同じ設定で目標量まで試しましょう。";
    } else if (!shot.complete) {
      title = stopped
        ? "途中までの抽出を振り返ろう"
        : "目標量に届かなかった一杯";
      description = `${format(shot.output)} g / 目標 ${format(p.targetYield)} gで終了しました。${stopped ? "途中の数値から、完成時の味は判断できません。" : "流れを確認してから、味を比べてみましょう。"}`;
    }
    const evidence = [];
    if (!shot.complete)
      evidence.push({
        label: "カップに届いた量",
        value: `${format(shot.output)} / ${format(p.targetYield)} g`,
        explanation: stopped
          ? "自分で終了した途中結果です。流れが遅すぎたとは限りません。"
          : `${format(shot.duration)}秒で目標量に届きませんでした。設定と流れの確認が先です。`,
      });
    if (!hasDrink) {
      const peak = shot.samples.reduce(
        (max, sample) => Math.max(max, sample.p),
        0,
      );
      evidence.push({
        label: "記録された最大圧力",
        value: `${format(peak)} bar`,
        explanation:
          peak === 0
            ? "この試行では圧力がかかっていません。圧力のかけ方と、終了したタイミングを確認しましょう。"
            : "圧力は記録されていますが、カップの抽出量はゼロです。味の評価はまだできません。",
      });
    }
    if (hasDrink) {
      evidence.push({
        label: "成分の取り出し・収率 EY",
        value: `${format(shot.ey)} %`,
        explanation: !shot.complete
          ? "ここまでに取り出した成分の割合です。目標量に届く前のため、完成時のバランスはまだ判断できません。"
          : shot.ey < 18
            ? "参考範囲18〜22%より少なめ。モデルでは酸味が先に立ち、甘味が控えめになる傾向です。"
            : shot.ey > 22
              ? "参考範囲18〜22%より多め。モデルでは苦味や渋味が強くなる傾向です。"
              : "参考範囲18〜22%内です。成分の取り出しはバランスの目安に入っています。",
      });
      evidence.push({
        label: "カップ全体の濃さ・濃度 TDS",
        value: `${format(shot.tds)} %`,
        explanation: !shot.complete
          ? "ここまでに届いた液体全体の濃さです。抽出を続けると変わるため、完成時の濃さとは異なります。"
          : `${shot.tds > 11 ? "濃厚" : shot.tds < 7 ? "すっきり" : "ほどよい厚み"}な口当たりの目安です。濃さと、取り出した成分の割合は別の指標です。`,
      });
      if (shot.risk > 35)
        evidence.push({
          label: "抽出ムラの目安",
          value: "偏りが出やすい条件",
          explanation:
            "モデルのムラ指標が高い状態です。実際のチャネリングを観測した数値ではありません。",
        });
    }
    let next = { ...shot.next };
    if (stopped)
      next = {
        kind: "repeat",
        label: "同じ設定で、目標量まで試す",
        reason:
          "途中終了の影響を確かめるため、設定を変えずにもう一度抽出します。",
        change: "設定はそのまま",
        button: "同じ設定で、次の一杯へ",
      };
    else {
      let candidate = M.normalize({ ...p, [next.key]: next.value });
      if (!fields[next.key] || candidate[next.key] === p[next.key]) {
        next = {
          key: "waterTemp",
          value: p.waterTemp >= 98 ? p.waterTemp - 1 : p.waterTemp + 1,
          label: "湯温だけ変えて比べる",
          reason:
            "提案された設定は調整範囲の端にあります。ほかの条件をそろえ、湯温による違いを確かめましょう。",
        };
        candidate = M.normalize({ ...p, [next.key]: next.value });
      }
      next.value = candidate[next.key];
      const [label, unit] = fields[next.key];
      const display = (value) =>
        next.key === "pressureProfile"
          ? M.profiles[value]
          : `${format(value)} ${unit}`;
      next.change = `${label} ${display(p[next.key])} → ${display(next.value)}`;
      next.kind = "change";
      next.button = "この調整で、次の一杯へ";
    }
    return { title, description, hasDrink, stopped, evidence, next };
  }
  if (typeof module === "object" && module.exports)
    module.exports = { describe };
  else root.BrewReport = { describe };
})(typeof window === "undefined" ? globalThis : window);
