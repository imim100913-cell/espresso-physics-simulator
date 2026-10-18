/* One presentation timeline for the guide, SVG scenes, and GPU progress. */
(function (root) {
  "use strict";
  const definitions = [
    [
      "weigh",
      "計量",
      "豆を量る",
      3,
      "まずは、一杯分の豆から。",
      "計量皿をスケールに載せてゼロにし、レシピで決めた重さの豆を量ります。",
    ],
    [
      "grind",
      "粉砕",
      "豆を挽く",
      4.5,
      "量った豆を、グラインダーへ。",
      "豆を細かく挽いて、ポルタフィルターのバスケットに受けます。挽き目は、お湯の通りやすさに関わります。",
    ],
    [
      "distribute",
      "ほぐす",
      "粉をほぐす",
      2.5,
      "針でほぐして、粉を均一に。",
      "細い針を使うWDTで粉の塊をほぐし、バスケットの隅まで均等に広げます。お湯が一部に偏るのを防ぐ準備です。",
    ],
    [
      "tamp",
      "圧密",
      "水平にタンピング",
      3,
      "水平な面を、ひと押しで。",
      "タンピングマットで支え、タンパーを水平に押し下げます。ふんわりした粉が、密なパックになります。",
    ],
    [
      "setup",
      "セット",
      "マシンにセット",
      2,
      "ここで、マシンの出番。",
      "準備したポルタフィルターを回して固定。下にカップとスケールを置き、カップの重さをゼロにします。",
    ],
    [
      "extract",
      "抽出",
      "お湯を通す",
      Infinity,
      "ポンプを動かして、抽出開始。",
      "粉にお湯が浸透し、滴が一本の流れにまとまります。目標量で止まり、味の予測と数値をまとめたレポートが開きます。",
    ],
  ];
  let start = 0;
  const stages = Object.freeze(
    definitions.map(
      ([id, shortLabel, label, duration, title, description], index) => {
        const stage = Object.freeze({
          id,
          shortLabel,
          label,
          duration,
          title,
          description,
          index,
          start,
        });
        start += duration;
        return stage;
      },
    ),
  );
  const preparationSeconds = stages.at(-1).start;
  const workflow = Object.freeze({
    stages,
    preparationSeconds,
    at(elapsed = 0) {
      const t = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
      const stage =
        stages.find((s) => t < s.start + s.duration) ?? stages.at(-1);
      const localTime = t - stage.start;
      return {
        ...stage,
        localTime,
        progress: Math.min(1, localTime / stage.duration),
        extractionTime: Math.max(0, t - preparationSeconds),
        next: stages[stage.index + 1]?.label ?? "できあがり・一杯のレポート",
      };
    },
    // The optional 3D renderer is used for extraction, after its original preparation interval.
    sceneTime(elapsed) {
      return 7.5 + Math.max(0, elapsed - preparationSeconds);
    },
  });
  if (typeof module === "object" && module.exports) module.exports = workflow;
  else root.BrewWorkflow = workflow;
})(typeof window === "object" ? window : globalThis);
