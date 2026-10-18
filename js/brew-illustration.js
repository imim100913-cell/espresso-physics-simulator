/* GPU-independent illustration, driven by the same shot clock and cup samples. */
(function () {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
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
  class BrewIllustration {
    constructor(root) {
      this.root = root;
      this.nodes = {};
      root
        .querySelectorAll("[id]")
        .forEach((node) => (this.nodes[node.id] = node));
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.beans = [];
      this.grounds = [];
      for (let i = 0; i < 14; i++) {
        const group = document.createElementNS(ns, "g");
        const bean = document.createElementNS(ns, "ellipse");
        set(bean, {
          rx: 5.5,
          ry: 3.4,
          fill: i % 2 ? "#79502c" : "#4b321f",
          stroke: "#b68049",
          "stroke-width": 0.6,
        });
        const groove = document.createElementNS(ns, "path");
        set(groove, {
          d: "M-4 0Q0-2 4 0",
          fill: "none",
          stroke: "#231b13",
          "stroke-width": 1,
        });
        group.append(bean, groove);
        this.nodes.artBeans.append(group);
        this.beans.push(group);
      }
      for (let i = 0; i < 30; i++) {
        const grain = document.createElementNS(ns, "circle");
        set(grain, {
          r: 0.9 + (i % 3) * 0.3,
          fill: i % 2 ? "#b98750" : "#8a5832",
        });
        this.nodes.artGrounds.append(grain);
        this.grounds.push(grain);
      }
      for (let i = 0; i < 19; i++) {
        const hole = document.createElementNS(ns, "circle");
        set(hole, {
          cx: 275 + i * 5,
          cy: 240 + 4 * Math.sin((i / 18) * Math.PI),
          r: 0.85,
          fill: "#15251a",
        });
        this.nodes.artFilterHoles.append(hole);
      }
    }
    update({ elapsed = 0, sample = {}, params = {} }) {
      const n = this.nodes,
        t = Math.max(0, elapsed),
        extract = Math.max(0, t - 7.5);
      const phase = t < 4.5 ? "grind" : t < 7.5 ? "tamp" : "extract";
      this.root.dataset.phase = phase;
      const dose = smooth(0.35, 4.4, t),
        compaction = smooth(4.8, 6.7, t);
      const height = dose * (43 - 13 * compaction),
        top = 237 - height,
        heap = 12 * dose * (1 - compaction);
      const bed = `M271 237L271 ${top + 4}Q320 ${top - heap * 2} 369 ${top + 4}L369 237Z`;
      set(n.artBed, { d: bed });
      set(n.artWetBed, { d: bed });
      const wet = smooth(0, 2.8, extract);
      set(n.artWetFront, {
        y: top - heap * 2,
        height: (height + heap * 2 + 5) * wet,
      });
      const move = smooth(4.3, 5.1, t);
      set(n.artGrinder, {
        transform: `translate(${-112 * move} ${-17 * move})`,
        opacity: 1 - 0.78 * move,
      });
      set(n.artBurr, {
        transform: `rotate(${this.reduced.matches ? 0 : t * 420} 320 101)`,
      });
      set(n.artTamper, {
        transform: `translate(0 ${54 * compaction - 54 * smooth(6.8, 7.4, t)})`,
        opacity: smooth(4.4, 4.8, t) * (1 - smooth(7, 7.5, t)),
      });
      set(n.artHead, {
        opacity: smooth(6.9, 7.6, t),
        transform: `translate(0 ${-20 * (1 - smooth(6.9, 7.6, t))})`,
      });
      this.beans.forEach((bean, i) => {
        const x = 294 + ((i * 17) % 51),
          y = 52 + ((i * 11) % 22) - dose * (i % 3) * 3;
        set(bean, {
          transform: `translate(${x} ${y}) rotate(${i * 41 + (this.reduced.matches ? 0 : Math.sin(t * 3 + i) * 6)})`,
          opacity: 1 - dose * 0.75,
        });
      });
      this.grounds.forEach((grain, i) => {
        const f = (t * 1.8 + i * 0.137) % 1;
        set(grain, {
          cx: 320 + Math.sin(i * 2.4) * (3 + f * 35),
          cy: 149 + f * (top - 145),
          opacity:
            phase === "grind" && t > 0.25 && !this.reduced.matches ? 0.8 : 0,
        });
      });
      const output = Math.max(0, sample.yield ?? 0),
        fill = clamp(output / Math.max(1, params.targetYield ?? 36));
      this.root.dataset.fill = fill.toFixed(4);
      const level = 371 - fill * 51;
      set(n.artCupLiquid, { y: level });
      set(n.artCrema, { cy: level, opacity: output > 0 ? 0.94 : 0 });
      set(n.artCremaSwirl, {
        d: `M281 ${level}Q311 ${level - 6}354 ${level}Q325 ${level + 5}306 ${level}`,
        opacity: output > 0 ? 0.65 : 0,
      });
      const q = Math.max(0, sample.q ?? 0),
        active = phase === "extract" && q > 0.005;
      const merge = smooth(0.2, 2.1, q) * smooth(0.2, 2.6, extract);
      set(n.artStreams, { opacity: active ? smooth(0.05, 0.9, extract) : 0 });
      [...n.artStreams.children].forEach((stream, i) => {
        const origin = 320 + (i - 1) * 27 * (1 - merge),
          sway = this.reduced.matches ? 0 : Math.sin(t * 6 + i) * 1.7;
        set(stream, {
          d: `M${origin} 245C${origin + sway} 260 ${320 + sway} 272 ${320 + sway} ${Math.max(310, level)}`,
          "stroke-width":
            clamp(Math.sqrt(q) * 1.7, 0.8, 4) *
            (i === 1 ? 1 : (1 - merge) * 0.65),
        });
        stream.setAttribute("opacity", i === 1 ? 1 : 1 - merge);
      });
      [...n.artDrops.children].forEach((drop, i) => {
        const f = (extract * 2.3 + i * 0.31) % 1;
        set(drop, {
          cx: 320 + (i - 1) * 23 * (1 - merge),
          cy: 246 + f * (Math.max(310, level) - 246),
          rx: 1.4,
          ry: 2.8,
          opacity: active && extract < 2 && !this.reduced.matches ? 1 - f : 0,
        });
      });
      set(n.artSteam, {
        opacity: output > 1 && !this.reduced.matches ? 0.23 : 0,
      });
      [...n.artSteam.children].forEach((path, i) => {
        const shift = (t * 0.35 + i * 0.3) % 1;
        const x = 300 + i * 20;
        const y = 300 - shift * 31;
        set(path, {
          d: `M${x} ${y}Q${x + 11} ${y - 11} ${x} ${y - 21}T${x + 3} ${y - 39}`,
          opacity: Math.sin(shift * Math.PI),
        });
      });
    }
  }
  window.BrewIllustration = BrewIllustration;
})();
