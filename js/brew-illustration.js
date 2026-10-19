/* GPU-independent barista scenes, driven only by the shared shot clock and cup samples. */
(function () {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
  const W = window.BrewWorkflow;
  const Layout = window.BrewSceneLayout;
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
    const group = element("g", { class: "coffee-bean" }, parent);
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
    constructor(root, { style = "photo" } = {}) {
      this.root = root;
      this.nodes = {};
      root
        .querySelectorAll("[id]")
        .forEach((node) => (this.nodes[node.id] = node));
      this.nodes.artGrinderContact = element(
        "ellipse",
        {
          id: "artGrinderContact",
          cx: 327,
          cy: 350,
          rx: 78,
          ry: 4,
          fill: "#080c06",
          opacity: 0.65,
        },
        this.nodes.artGrinder,
      );
      // A simple outlined hand also explains the grip when photographs are off.
      for (const [id, path] of [
        [
          "artTamper",
          "M320 78Q321 59 343 59L389 74L466 78V111L386 105Q350 113 336 99L329 87Q321 94 315 86Z",
        ],
        [
          "artWdt",
          "M312 110Q308 91 328 89Q349 86 370 101L454 104V135L365 130Q342 139 327 127L322 114Q317 128 310 121Z",
        ],
        [
          "artBeanScoop",
          "M450 114Q453 95 470 95L505 111V144L473 136Q455 144 444 131L440 121Z",
        ],
      ])
        element(
          "path",
          {
            d: path,
            fill: "#aa8868",
            stroke: "#d2b494",
            "stroke-width": 1.5,
            class: "barista-hand",
          },
          this.nodes[id],
        );
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
      this.artwork = window.BrewArtwork
        ? new window.BrewArtwork(
            root,
            this.nodes,
            () => {
              if (this.lastFrame) this.update(this.lastFrame);
            },
            style,
          )
        : { active: false, setStyle() {} };
    }
    setStyle(style) {
      this.artwork.setStyle(style);
      if (this.lastFrame) this.update(this.lastFrame);
    }
    update({ elapsed = 0, sample = {}, params = {} }) {
      this.lastFrame = { elapsed, sample, params };
      const n = this.nodes,
        t = Math.max(0, elapsed),
        stage = W.at(t);
      const { id: phase, progress: p, extractionTime: extract } = stage;
      const reduced = this.reduced.matches;
      const photo = this.artwork.active;
      const layout = Layout.scene(photo, phase);
      this.root.dataset.phase = phase;
      this.root.setAttribute(
        "aria-label",
        `${stage.index + 1} / ${W.stages.length}：${stage.label}。${stage.description}`,
      );
      // A scene cut removes every irrelevant prop, including its supports and shadows.
      show(n.artWeigh, phase === "weigh");
      show(n.artGrinder, phase === "grind");
      show(n.artPrepMat, phase === "distribute" || phase === "tamp");
      show(n.artTampingStand, phase === "distribute" || phase === "tamp");
      show(n.artBasket, phase !== "weigh");
      show(n.artWdt, phase === "distribute");
      show(n.artTamper, phase === "tamp");
      show(n.artMachine, phase === "setup" || phase === "extract");
      show(n.artCup, phase === "setup" || phase === "extract");
      show(n.artShotScale, phase === "setup" || phase === "extract");
      // Fixed framing preserves every support/contact at scene cuts and on rotation.
      set(n.artScene, {
        opacity: 1,
        transform: "translate(0 0)",
      });
      show(n.artFloorShadow, false);
      set(n.artPrepMat, { transform: "translate(0 42)" });
      set(n.artGrinder, { transform: layout.grinder });
      set(
        n.artGrinderContact,
        photo ? { cx: 327, cy: 350, rx: 78 } : { cx: 288, cy: 328, rx: 83 },
      );
      set(n.artWeighContact, {
        cx: 320,
        cy: 349,
        rx: photo ? 106 : 116,
        ry: 3,
      });
      set(n.artCupContact, { cy: photo ? 377.5 : 377, rx: photo ? 29 : 48 });
      const collected = smooth(0.12, 0.78, p);
      n.artWeighReadout.textContent = `${((params.dose ?? 18) * collected).toFixed(1)} g`;
      const scoopAngle = reduced ? 0 : 5 - 9 * smooth(0.08, 0.4, p);
      const pivot = photo ? { x: 445, y: 125 } : { x: 450, y: 118 };
      const mouth = photo ? { x: 350, y: 168 } : { x: 371, y: 139 };
      const a = (scoopAngle * Math.PI) / 180;
      const pour = {
        x:
          pivot.x +
          (mouth.x - pivot.x) * Math.cos(a) -
          (mouth.y - pivot.y) * Math.sin(a),
        y:
          pivot.y +
          (mouth.x - pivot.x) * Math.sin(a) +
          (mouth.y - pivot.y) * Math.cos(a),
      };
      set(n.artBeanScoop, {
        transform: `rotate(${scoopAngle} ${pivot.x} ${pivot.y})`,
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
          transform: `translate(${pour.x + (320 + Math.sin(i * 3) * 18 - pour.x) * f} ${pour.y + (226 - pour.y) * f * f}) rotate(${i * 51 + f * 240})`,
          opacity:
            phase === "weigh" && p > 0.12 && p < 0.78 && !reduced ? 1 : 0,
        });
      });
      const dose =
        phase === "weigh" ? 0 : phase === "grind" ? smooth(0.06, 0.97, p) : 1;
      const distributed =
        stage.index > 2 ? 1 : phase === "distribute" ? smooth(0, 0.9, p) : 0;
      const compaction =
        stage.index > 3 ? 1 : phase === "tamp" ? smooth(0.28, 0.76, p) : 0;
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
      set(n.artBasket, {
        transform: layout.basket.transform,
      });
      const powderY = top + 2 - heap;
      const wdtTip = 220 + 66 * smooth(0, 0.2, p) - 66 * smooth(0.8, 1, p);
      set(n.artWdt, {
        transform: `translate(${reduced ? 0 : Math.sin(p * Math.PI * 6) * 8} ${wdtTip - 245})`,
      });
      const reach = smooth(0.06, 0.28, p),
        retract = smooth(0.84, 1, p);
      const surface = layout.basket.point(320, powderY).y;
      const tamperTip =
        220 + (surface - 220) * reach - (surface - 220) * retract;
      set(n.artTamper, {
        transform: `translate(0 ${tamperTip - (photo ? 153 : 157.5)})`,
      });
      set(n.artBurr, {
        transform: `rotate(${reduced ? 0 : stage.localTime * (params.grinderRPM ?? 400)} 320 101)`,
      });
      set(n.artShower, {
        opacity: phase === "extract" ? smooth(0, 0.8, extract) * 0.6 : 0,
      });
      this.beans.forEach((node, i) =>
        set(node, {
          transform: `translate(${294 + ((i * 17) % 51)} ${(photo ? 75 : 52) + ((i * 11) % 22) - dose * (i % 3) * 3}) rotate(${i * 41 + (reduced ? 0 : Math.sin(t * 3 + i) * 6)})`,
          opacity: 1 - dose,
        }),
      );
      this.grounds.forEach((grain, i) => {
        const f = (stage.localTime * 1.8 + i * 0.137) % 1;
        const chute = layout.basket.inverse(layout.chute.x, layout.chute.y);
        set(grain, {
          cx: chute.x + Math.sin(i * 2.4) * (1 + f * 21),
          cy: chute.y + f * f * (powderY - chute.y),
          opacity:
            phase === "grind" && p > 0.06 && p < 0.97 && !reduced ? 0.8 : 0,
        });
      });
      const output = Math.max(0, sample.yield ?? 0),
        fill = clamp(output / Math.max(1, params.targetYield ?? 36));
      this.root.dataset.fill = fill.toFixed(4);
      const level = 371 - fill * 51;
      set(n.artCup, { transform: layout.cup.transform });
      set(n.artShotScale, { transform: layout.scale.transform });
      n.artShotWeight.textContent = `${output.toFixed(1)} g`;
      n.artMachineTemp.textContent = `${params.waterTemp ?? 93}°C`;
      set(
        n.artMachineTemp,
        photo
          ? { x: 397, y: 113, "font-size": 10 }
          : { x: 213, y: 160, "font-size": 9 },
      );
      set(n.artShotWeight, { x: 320, y: 292.5, "font-size": 7.5 });
      set(n.artCupClip.firstElementChild, {
        d: photo
          ? "M284 300Q320 288 355 300L350 362Q320 374 290 362Z"
          : "M258 307 Q263 369 320 371 Q377 369 382 307Z",
      });
      set(n.artPressureNeedle, {
        transform: `rotate(${phase === "extract" ? clamp((sample.p ?? 0) / 12) * 220 : 0} 210 102)`,
      });
      set(n.artCupLiquid, { y: level });
      set(n.artCrema, {
        cy: level,
        rx: photo ? 35 : 61,
        opacity: output > 0 ? 0.94 : 0,
      });
      set(n.artCremaSwirl, {
        d: photo
          ? `M293 ${level}Q316 ${level - 4} 347 ${level}Q325 ${level + 4} 306 ${level}`
          : `M281 ${level}Q311 ${level - 6} 354 ${level}Q325 ${level + 5} 306 ${level}`,
        opacity: output > 0 ? (photo ? 0.25 : 0.65) : 0,
      });
      const q = Math.max(0, sample.q ?? 0),
        active = phase === "extract" && q > 0.005;
      const outlet = layout.outlet.y;
      const liquid = layout.cup.point(320, level);
      const fall = Math.max(1, liquid.y - outlet);
      const merge = smooth(0.2, 2.1, q) * smooth(0.2, 2.6, extract);
      set(n.artStreams, { opacity: active ? smooth(0.05, 0.9, extract) : 0 });
      [...n.artStreams.children].forEach((stream, i) => {
        const origin = 320 + (i - 1) * 27 * layout.basket.scale * (1 - merge),
          sway = reduced ? 0 : Math.sin(t * 6 + i) * 1.7;
        set(stream, {
          d: `M${origin} ${outlet}C${origin + sway} ${outlet + fall * 0.3} ${liquid.x + sway} ${liquid.y - fall * 0.2} ${liquid.x + sway} ${liquid.y}`,
          "stroke-width":
            clamp(Math.sqrt(q) * 1.7 * layout.basket.scale, 0.7, 3) *
            (i === 1 ? 1 : (1 - merge) * 0.65),
          opacity: i === 1 ? 1 : 1 - merge,
        });
      });
      [...n.artDrops.children].forEach((drop, i) => {
        const f = (extract * 2.3 + i * 0.31) % 1;
        set(drop, {
          cx: 320 + (i - 1) * 23 * layout.basket.scale * (1 - merge),
          cy: outlet + f * f * fall,
          rx: 1.1,
          ry: 1.8 + f,
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
      this.artwork.update?.({
        elapsed: t,
        stage,
        reduced,
        q,
        level,
        pressure: sample.p ?? 0,
        top,
        heap,
        dose,
        collected,
      });
    }
  }
  window.BrewIllustration = BrewIllustration;
})();
