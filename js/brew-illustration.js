/* GPU-independent barista scenes, driven only by the shared shot clock and cup samples. */
(function () {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
  const W = window.BrewWorkflow;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, t) => {
    const f = clamp((t - a) / (b - a));
    return f * f * (3 - 2 * f);
  };
  const set = (node, attrs) => {
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(
        key,
        typeof value === "number" ? value.toFixed(3) : value,
      );
  };
  const show = (node, visible) =>
    node.setAttribute("display", visible ? "inline" : "none");
  function element(tag, attrs, parent) {
    const node = document.createElementNS(ns, tag);
    set(node, attrs);
    parent.append(node);
    return node;
  }
  function bean(parent, index) {
    const group = element("g", {}, parent);
    element(
      "ellipse",
      {
        rx: 5.5,
        ry: 3.4,
        fill: index % 2 ? "#79502c" : "#4b321f",
        stroke: "#b68049",
        "stroke-width": 0.6,
      },
      group,
    );
    element(
      "path",
      {
        d: "M-4 0Q0-2 4 0",
        fill: "none",
        stroke: "#231b13",
        "stroke-width": 1,
      },
      group,
    );
    return group;
  }
  class BrewIllustration {
    constructor(root) {
      this.root = root;
      this.nodes = {};
      root
        .querySelectorAll("[id]")
        .forEach((node) => (this.nodes[node.id] = node));
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.beans = Array.from({ length: 14 }, (_, i) =>
        bean(this.nodes.artBeans, i),
      );
      this.weighBeans = Array.from({ length: 40 }, (_, i) =>
        bean(this.nodes.artWeighBeans, i),
      );
      this.weighDrops = Array.from({ length: 5 }, (_, i) =>
        bean(this.nodes.artWeighDrops, i),
      );
      this.grounds = Array.from({ length: 30 }, (_, i) =>
        element(
          "circle",
          {
            r: 0.9 + (i % 3) * 0.3,
            fill: i % 2 ? "#b98750" : "#8a5832",
          },
          this.nodes.artGrounds,
        ),
      );
      for (let i = 0; i < 19; i++)
        element(
          "circle",
          {
            cx: 275 + i * 5,
            cy: 240 + 4 * Math.sin((i / 18) * Math.PI),
            r: 0.85,
            fill: "#15251a",
          },
          this.nodes.artFilterHoles,
        );
    }
    update({ elapsed = 0, sample = {}, params = {} }) {
      const n = this.nodes,
        t = Math.max(0, elapsed),
        stage = W.at(t);
      const { id: phase, progress: p, extractionTime: extract } = stage;
      const reduced = this.reduced.matches;
      this.root.dataset.phase = phase;
      this.root.setAttribute(
        "aria-label",
        `${stage.index + 1} / ${W.stages.length}：${stage.label}。${stage.description}`,
      );
      // A scene cut removes every irrelevant prop, including its supports and shadows.
      show(n.artWeigh, phase === "weigh");
      show(n.artGrinder, phase === "grind");
      show(n.artPrepMat, phase === "distribute" || phase === "tamp");
      show(n.artBasket, phase !== "weigh");
      show(n.artWdt, phase === "distribute");
      show(n.artTamper, phase === "tamp");
      show(n.artMachine, phase === "setup" || phase === "extract");
      show(n.artCup, phase === "setup" || phase === "extract");
      show(n.artShotScale, phase === "setup" || phase === "extract");
      const enter = reduced ? 1 : smooth(0, 0.22, stage.localTime);
      set(n.artScene, {
        opacity: 1,
        transform: `translate(0 ${8 * (1 - enter)})`,
      });
      const collected = smooth(0.12, 0.78, p);
      n.artWeighReadout.textContent = `${((params.dose ?? 18) * collected).toFixed(1)} g`;
      set(n.artBeanScoop, {
        transform: `translate(${-24 * smooth(0, 0.4, p)} ${-12 * smooth(0.8, 1, p)}) rotate(${-25 * smooth(0.08, 0.4, p)} 380 130)`,
        opacity: 1 - smooth(0.82, 1, p),
      });
      this.weighBeans.forEach((node, i) => {
        const row = Math.floor(i / 10);
        set(node, {
          transform: `translate(${264 + (i % 10) * 12 + (row % 2) * 4} ${233 - row * 5}) rotate(${i * 43})`,
          opacity: collected * 40 > i ? 1 : 0,
        });
      });
      this.weighDrops.forEach((node, i) => {
        const f = (stage.localTime * 2 + i * 0.19) % 1;
        set(node, {
          transform: `translate(${371 - f * 51 + Math.sin(i * 3) * 11} ${139 + f * 87}) rotate(${i * 51 + f * 240})`,
          opacity:
            phase === "weigh" && p > 0.12 && p < 0.78 && !reduced ? 1 : 0,
        });
      });
      const dose =
        phase === "weigh" ? 0 : phase === "grind" ? smooth(0.06, 0.97, p) : 1;
      const distributed =
        stage.index > 2 ? 1 : phase === "distribute" ? smooth(0, 0.9, p) : 0;
      const compaction =
        stage.index > 3 ? 1 : phase === "tamp" ? smooth(0.18, 0.7, p) : 0;
      const height =
        dose *
        (43 - 13 * compaction) *
        clamp((params.dose ?? 18) / 18, 0.75, 1.25);
      const top = 237 - height,
        heap = 12 * dose * (1 - compaction) * (1 - distributed * 0.85);
      const bed = `M271 237L271 ${top + 4}Q320 ${top - heap * 2} 369 ${top + 4}L369 237Z`;
      set(n.artBed, { d: bed });
      set(n.artWetBed, { d: bed });
      set(n.artWetFront, {
        y: top - heap * 2,
        height: (height + heap * 2 + 5) * smooth(0, 2.8, extract),
      });
      const preparing = phase === "distribute" || phase === "tamp";
      const lock = phase === "setup" ? smooth(0, 0.7, p) : 1;
      set(n.artBasket, {
        transform: preparing
          ? "translate(0 55)"
          : `translate(0 ${26 * (1 - lock)}) rotate(${-12 * (1 - lock)} 320 178)`,
      });
      set(n.artWdt, {
        transform: `translate(${reduced ? 0 : Math.sin(p * Math.PI * 6) * 22} ${-7 * smooth(0.8, 1, p)})`,
      });
      set(n.artTamper, {
        transform: `translate(0 ${55 + 54 * compaction - 50 * smooth(0.82, 1, p)})`,
      });
      set(n.artBurr, {
        transform: `rotate(${reduced ? 0 : stage.localTime * (params.grinderRPM ?? 400)} 320 101)`,
      });
      set(n.artShower, {
        opacity: phase === "extract" ? smooth(0, 0.8, extract) * 0.6 : 0,
      });
      this.beans.forEach((node, i) =>
        set(node, {
          transform: `translate(${294 + ((i * 17) % 51)} ${52 + ((i * 11) % 22) - dose * (i % 3) * 3}) rotate(${i * 41 + (reduced ? 0 : Math.sin(t * 3 + i) * 6)})`,
          opacity: 1 - dose,
        }),
      );
      this.grounds.forEach((grain, i) => {
        const f = (stage.localTime * 1.8 + i * 0.137) % 1;
        set(grain, {
          cx: 320 + Math.sin(i * 2.4) * (3 + f * 35),
          cy: 149 + f * (top - 145),
          opacity:
            phase === "grind" && p > 0.06 && p < 0.97 && !reduced ? 0.8 : 0,
        });
      });
      const output = Math.max(0, sample.yield ?? 0),
        fill = clamp(output / Math.max(1, params.targetYield ?? 36));
      this.root.dataset.fill = fill.toFixed(4);
      const level = 371 - fill * 51;
      n.artShotWeight.textContent = `${output.toFixed(1)} g`;
      n.artMachineTemp.textContent = `${params.waterTemp ?? 93}°C`;
      set(n.artPressureNeedle, {
        transform: `rotate(${phase === "extract" ? clamp((sample.p ?? 0) / 12) * 220 : 0} 210 102)`,
      });
      set(n.artCupLiquid, { y: level });
      set(n.artCrema, { cy: level, opacity: output > 0 ? 0.94 : 0 });
      set(n.artCremaSwirl, {
        d: `M281 ${level}Q311 ${level - 6} 354 ${level}Q325 ${level + 5} 306 ${level}`,
        opacity: output > 0 ? 0.65 : 0,
      });
      const q = Math.max(0, sample.q ?? 0),
        active = phase === "extract" && q > 0.005;
      const merge = smooth(0.2, 2.1, q) * smooth(0.2, 2.6, extract);
      set(n.artStreams, { opacity: active ? smooth(0.05, 0.9, extract) : 0 });
      [...n.artStreams.children].forEach((stream, i) => {
        const origin = 320 + (i - 1) * 27 * (1 - merge),
          sway = reduced ? 0 : Math.sin(t * 6 + i) * 1.7;
        set(stream, {
          d: `M${origin} 245C${origin + sway} 260 ${320 + sway} 272 ${320 + sway} ${Math.max(296, level - 14)}`,
          "stroke-width":
            clamp(Math.sqrt(q) * 1.7, 0.8, 4) *
            (i === 1 ? 1 : (1 - merge) * 0.65),
          opacity: i === 1 ? 1 : 1 - merge,
        });
      });
      [...n.artDrops.children].forEach((drop, i) => {
        const f = (extract * 2.3 + i * 0.31) % 1;
        set(drop, {
          cx: 320 + (i - 1) * 23 * (1 - merge),
          cy: 246 + f * (Math.max(296, level - 14) - 246),
          rx: 1.4,
          ry: 2.8,
          opacity: active && extract < 2 && !reduced ? 1 - f : 0,
        });
      });
      set(n.artSteam, { opacity: output > 1 && !reduced ? 0.23 : 0 });
      [...n.artSteam.children].forEach((path, i) => {
        const shift = (t * 0.35 + i * 0.3) % 1,
          x = 300 + i * 20,
          y = 300 - shift * 31;
        set(path, {
          d: `M${x} ${y}Q${x + 11} ${y - 11} ${x} ${y - 21}T${x + 3} ${y - 39}`,
          opacity: Math.sin(shift * Math.PI),
        });
      });
    }
  }
  window.BrewIllustration = BrewIllustration;
})();
