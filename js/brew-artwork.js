/* Generated product photographs composed as live SVG layers, without WebGL. */
(function () {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
  const base = new URL("../assets/generated/", document.currentScript.src);
  const files = Object.fromEntries(
    [
      ["tools", "barista-tools.webp"],
      ["materials", "coffee-materials.webp"],
      ["backdrop", "atelier.webp"],
      ["hands", "barista-hands.webp"],
    ].map(([key, file]) => [key, new URL(file + "?v=4.4.1", base).href]),
  );
  const create = (tag, attrs, parent) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value);
    parent.append(node);
    return node;
  };
  // SVG viewports select regions of the intact, shared source images.
  function crop(parent, source, dimensions, region, target) {
    const [x, y, width, height] = target;
    const viewport = create(
      "svg",
      {
        x,
        y,
        width,
        height,
        viewBox: region.join(" "),
        preserveAspectRatio: "none",
        overflow: "hidden",
        "data-art-bounds": target.join(" "),
      },
      parent,
    );
    create(
      "image",
      { href: source, width: dimensions[0], height: dimensions[1] },
      viewport,
    );
    return viewport;
  }
  class BrewArtwork {
    constructor(root, nodes, onReady, mode = "photo") {
      Object.assign(this, {
        root,
        nodes,
        onReady,
        mode: mode === "diagram" ? "diagram" : "photo",
        loaded: false,
        failed: false,
      });
      this.sync();
      if (this.mode === "photo") this.load();
    }
    get active() {
      return this.loaded && this.mode === "photo";
    }
    load() {
      if (this.ready && !this.failed) return this.ready;
      this.failed = false;
      this.sync();
      this.ready = Promise.all(
        Object.values(files).map(
          (src) =>
            new Promise((resolve, reject) => {
              const image = new Image();
              image.decoding = "async";
              image.onload = () =>
                (image.decode ? image.decode() : Promise.resolve()).then(
                  resolve,
                  reject,
                );
              image.onerror = reject;
              image.src = src;
            }),
        ),
      )
        .then(() => {
          this.install();
          this.loaded = true;
          this.sync();
          this.onReady();
        })
        .catch((error) => {
          this.failed = true;
          this.sync();
          console.warn(
            "Generated artwork is unavailable; using the diagram.",
            error,
          );
        });
      return this.ready;
    }
    setStyle(mode) {
      this.mode = mode === "diagram" ? "diagram" : "photo";
      this.sync();
      if (this.mode === "photo" && !this.loaded) this.load();
    }
    sync() {
      this.root.classList.toggle("art-rich", this.active);
      this.root.dataset.artwork = this.active
        ? "photo"
        : this.mode === "diagram"
          ? "diagram"
          : this.failed
            ? "unavailable"
            : "loading";
    }
    vectorize(id, keep = []) {
      for (const node of this.nodes[id].children)
        if (!keep.includes(node.id)) node.classList.add("art-vector");
    }
    sprite(parent, region, target, attrs = {}) {
      const group = create("g", { class: "generated-layer", ...attrs }, parent);
      crop(group, files.tools, [1774, 887], region, target);
      return group;
    }
    heldTool(parent, region, target, attrs = {}, sleeve = "") {
      const group = create("g", { class: "generated-layer", ...attrs }, parent);
      // The forearm enters from the frame edge; its cutout must not end midair.
      if (sleeve)
        create(
          "path",
          {
            d: sleeve,
            fill: "url(#richSleeveTexture)",
            class: "sleeve-extension",
          },
          group,
        );
      crop(group, files.hands, [1536, 1024], region, target);
      return group;
    }
    install() {
      this.defs = this.root.querySelector("defs");
      const sleeve = create(
        "pattern",
        {
          id: "richSleeveTexture",
          patternUnits: "userSpaceOnUse",
          width: 20,
          height: 62,
        },
        this.defs,
      );
      crop(
        sleeve,
        files.hands,
        [1536, 1024],
        [669, 650, 55, 170],
        [0, 0, 20, 62],
      );
      const shadow = create(
        "filter",
        {
          id: "richShadow",
          x: "-25%",
          y: "-25%",
          width: "150%",
          height: "160%",
          "color-interpolation-filters": "sRGB",
        },
        this.defs,
      );
      create(
        "feDropShadow",
        {
          dx: 0,
          dy: 1,
          stdDeviation: 1.2,
          "flood-color": "#070904",
          "flood-opacity": 0.38,
        },
        shadow,
      );
      const steam = create(
        "filter",
        {
          id: "richSteam",
          x: "-60%",
          y: "-35%",
          width: "220%",
          height: "170%",
        },
        this.defs,
      );
      create("feGaussianBlur", { stdDeviation: 1.3 }, steam);
      this.installBackdrop();
      this.installEquipment();
      this.installMaterials();
      this.installDial();
      this.streamGlint = create(
        "path",
        {
          id: "richStreamGlint",
          class: "generated-layer",
          fill: "none",
          stroke: "#f9d3a0",
          "stroke-width": 0.65,
          opacity: 0,
          "stroke-linecap": "round",
        },
        this.nodes.artScene,
      );
      this.nodes.artScene.insertBefore(this.streamGlint, this.nodes.artCup);
    }
    installBackdrop() {
      // The worktop and every contact shadow share the equipment's coordinates.
      // An HTML cover background moves its horizon on narrow/landscape viewports.
      this.backdrop = create(
        "g",
        { id: "richBackdrop", class: "generated-layer", "aria-hidden": "true" },
        this.root,
      );
      const wall = crop(
        this.backdrop,
        files.backdrop,
        [1536, 1024],
        [0, 0, 1536, 720],
        [100, 0, 440, 280],
      );
      const table = crop(
        this.backdrop,
        files.backdrop,
        [1536, 1024],
        [0, 720, 1536, 304],
        [100, 280, 440, 120],
      );
      this.root.insertBefore(this.backdrop, this.nodes.artScene);
      const fit = () => {
        const rect = this.root.getBoundingClientRect(),
          matrix = this.root.getScreenCTM();
        if (!rect.width || !rect.height || !matrix) return;
        const inverse = matrix.inverse();
        const first = new DOMPoint(rect.left, rect.top).matrixTransform(
          inverse,
        );
        const last = new DOMPoint(rect.right, rect.bottom).matrixTransform(
          inverse,
        );
        const targets = [
          [wall, first.y, 280 - first.y],
          [table, 280, last.y - 280],
        ];
        for (const [node, y, height] of targets) {
          for (const [key, value] of Object.entries({
            x: first.x,
            y,
            width: last.x - first.x,
            height,
          }))
            node.setAttribute(key, value);
        }
      };
      this.backdropObserver = new ResizeObserver(fit);
      this.backdropObserver.observe(this.root);
      fit();
    }
    mask(id, bounds, opening) {
      const [x, y, width, height] = bounds;
      const mask = create(
        "mask",
        { id, maskUnits: "userSpaceOnUse", x, y, width, height },
        this.defs,
      );
      create("rect", { x, y, width, height, fill: "white" }, mask);
      create("path", { d: opening, fill: "black" }, mask);
    }
    installEquipment() {
      const n = this.nodes;
      this.vectorize("artWeigh", [
        "artWeighContact",
        "artWeighReadout",
        "artWeighBeans",
        "artBeanScoop",
        "artWeighDrops",
      ]);
      this.vectorize("artBeanScoop");
      this.vectorize("artGrinder", ["artBeans", "artGrinderContact"]);
      this.vectorize("artTamper");
      this.vectorize("artWdt");
      this.vectorize("artMachine", ["artMachineTemp"]);
      this.vectorize("artBasket", ["artBed", "artWetBed", "artGrounds"]);
      this.vectorize("artCup", ["artSteam", "artCupContact"]);
      n.artCupLiquid.parentElement.classList.remove("art-vector");
      const shadow = { filter: "url(#richShadow)" };
      n.artWeigh.prepend(
        this.sprite(
          n.artWeigh,
          [27, 113, 385, 299],
          [214, 185, 212, 165],
          shadow,
        ),
      );
      this.heldTool(
        n.artBeanScoop,
        [72, 95, 668, 408],
        [343.79, 74.85, 180.36, 110.16],
        {},
        "M519 76L1000 60V151L519 140Z",
      );
      n.artGrinder.prepend(
        this.sprite(
          n.artGrinder,
          [568, 7, 215, 416],
          [249, 40, 161.25, 312],
          shadow,
        ),
      );
      this.heldTool(
        n.artTamper,
        [131, 561, 611, 410],
        [264.53, -21.29, 262.73, 176.3],
        {},
        "M522 -15L1000 -20V116L522 109Z",
      );
      this.heldTool(
        n.artWdt,
        [836, 52, 636, 456],
        [288.5, 86.45, 222.6, 159.6],
        {},
        "M506 113L1000 105V211L506 202Z",
      );
      n.artMachine.prepend(
        this.sprite(
          n.artMachine,
          [451, 428, 460, 453],
          [170, 40, 330, 325],
          shadow,
        ),
      );
      const region = [884, 126, 585, 209],
        target = [259, 162, 245, 87.5];
      n.artBasket.prepend(this.sprite(n.artBasket, region, target, shadow));
      this.mask(
        "richBasketFrame",
        [250, 140, 265, 120],
        "M275 177Q320 159 367 178L367 235Q320 250 275 235Z",
      );
      this.sprite(n.artBasket, region, target, {
        mask: "url(#richBasketFrame)",
      });
      this.lockHand = this.heldTool(
        n.artBasket,
        [1120, 560, 385, 335],
        [390, 106.12, 138.6, 120.6],
        { id: "richLockHand" },
        "M523 108L1200 85V210L523 185Z",
      );
      n.artBasket.append(n.artGrounds);
      // The tamper presses in front of the rear wall, onto the powder surface.
      n.artBasket.after(n.artTamper);
      const cupRegion = [948, 509, 398, 322],
        cupTarget = [277, 288, 112, 90.6];
      n.artCup.prepend(this.sprite(n.artCup, cupRegion, cupTarget));
      this.mask(
        "richCupFrame",
        [270, 280, 130, 110],
        "M284 300Q320 288 355 300L350 362Q320 374 290 362Z",
      );
      this.sprite(n.artCup, cupRegion, cupTarget, {
        mask: "url(#richCupFrame)",
      });
      n.artCup.append(n.artSteam);
      // Contact shadows belong below their objects, never a fixed screen offset.
      n.artWeigh.prepend(n.artWeighContact);
      n.artCup.prepend(n.artCupContact);
      n.artGrinder.prepend(n.artGrinderContact);
      for (const x of [218, 433]) {
        const contact = create(
          "ellipse",
          {
            cx: x,
            cy: 362,
            rx: 25,
            ry: 3,
            fill: "#080c06",
            opacity: 0.75,
            class: "generated-layer",
          },
          n.artMachine,
        );
        n.artMachine.prepend(contact);
      }
    }
    material(id, region, width, height, dark = false) {
      const pattern = create(
        "pattern",
        { id, patternUnits: "userSpaceOnUse", width, height },
        this.defs,
      );
      crop(pattern, files.materials, [2172, 724], region, [
        0,
        0,
        width,
        height,
      ]);
      if (dark)
        create(
          "rect",
          { x: 0, y: 0, width, height, fill: "#120c08", opacity: 0.75 },
          pattern,
        );
      return pattern;
    }
    installMaterials() {
      const n = this.nodes;
      this.material("richPowder", [726, 2, 720, 720], 48, 48);
      this.material("richWetPowder", [726, 2, 720, 720], 48, 48, true);
      this.crema = this.material(
        "richCremaTexture",
        [1450, 2, 720, 720],
        78,
        48,
      );
      const depth = create(
        "linearGradient",
        { id: "richBedShade", x2: 0, y2: 1 },
        this.defs,
      );
      create(
        "stop",
        { "stop-color": "#160d06", "stop-opacity": 0, offset: 0 },
        depth,
      );
      create(
        "stop",
        { "stop-color": "#160d06", "stop-opacity": 0.55, offset: 1 },
        depth,
      );
      this.bedDepth = create(
        "path",
        { class: "generated-layer", fill: "url(#richBedShade)" },
        n.artBasket,
      );
      this.bedSurface = create(
        "ellipse",
        {
          class: "generated-layer",
          cx: 320,
          rx: 47,
          ry: 7,
          fill: "url(#richPowder)",
        },
        n.artBasket,
      );
      n.artWetBed.after(this.bedDepth, this.bedSurface);
      const bean = create(
        "symbol",
        {
          id: "richBean",
          viewBox: "80 140 575 430",
          preserveAspectRatio: "none",
        },
        this.defs,
      );
      create(
        "image",
        { href: files.materials, width: 2172, height: 724 },
        bean,
      );
      for (const group of this.root.querySelectorAll(".coffee-bean"))
        create(
          "use",
          {
            href: "#richBean",
            x: -6.5,
            y: -4.5,
            width: 13,
            height: 9,
            class: "generated-bean",
          },
          group,
        );
      this.scoopBeans = Array.from({ length: 8 }, (_, i) => {
        const group = create(
          "g",
          {
            class: "generated-layer",
            transform: `translate(${355 + (i % 4) * 4} ${166 + Math.floor(i / 4) * 3}) rotate(${i * 39})`,
          },
          n.artBeanScoop,
        );
        create(
          "use",
          { href: "#richBean", x: -3, y: -2, width: 6, height: 4 },
          group,
        );
        return group;
      });
    }
    installDial() {
      const dial = create(
        "g",
        { class: "generated-layer" },
        this.nodes.artMachine,
      );
      create(
        "circle",
        {
          cx: 237,
          cy: 123,
          r: 19,
          fill: "#e5d6b8",
          stroke: "#806139",
          "stroke-width": 0.6,
        },
        dial,
      );
      for (let i = 0; i <= 12; i++) {
        const a = ((140 + (i / 12) * 260) * Math.PI) / 180;
        create(
          "path",
          {
            d: `M${237 + Math.cos(a) * 16.8} ${123 + Math.sin(a) * 16.8}L${237 + Math.cos(a) * (i % 3 ? 15 : 13.7)} ${123 + Math.sin(a) * (i % 3 ? 15 : 13.7)}`,
            stroke: "#3e3628",
            "stroke-width": 0.6,
          },
          dial,
        );
        if (i % 6 === 0) {
          const text = create(
            "text",
            {
              x: 237 + Math.cos(a) * 10.8,
              y: 124.5 + Math.sin(a) * 10.8,
              "text-anchor": "middle",
              "font-family": "monospace",
              "font-size": 4.1,
              fill: "#3e3628",
            },
            dial,
          );
          text.textContent = i;
        }
      }
      this.pressureNeedle = create(
        "path",
        {
          id: "richPressureNeedle",
          d: "M237 123L224 132.5",
          stroke: "#75492a",
          "stroke-width": 1.1,
          "stroke-linecap": "round",
        },
        dial,
      );
      create("circle", { cx: 237, cy: 123, r: 1.8, fill: "#493b2a" }, dial);
    }
    update({
      elapsed,
      stage,
      reduced,
      q,
      level,
      pressure,
      top,
      heap,
      dose,
      collected,
    }) {
      if (!this.active) return;
      this.bedDepth.setAttribute("d", this.nodes.artBed.getAttribute("d"));
      this.bedSurface.setAttribute("cy", top + 2 - heap);
      this.bedSurface.setAttribute("ry", 7 + heap * 0.15);
      this.bedSurface.setAttribute("opacity", dose > 0.01 ? 1 : 0);
      this.bedSurface.setAttribute(
        "fill",
        stage.id === "extract" && stage.extractionTime > 0.2
          ? "url(#richWetPowder)"
          : "url(#richPowder)",
      );
      this.pressureNeedle.setAttribute(
        "transform",
        `rotate(${Math.min(1, Math.max(0, pressure / 12)) * 260} 237 123)`,
      );
      this.crema.setAttribute(
        "patternTransform",
        `translate(${reduced ? 0 : Math.sin(elapsed * 0.28) * 5} ${level}) rotate(${reduced ? 0 : Math.sin(elapsed * 0.18) * 4})`,
      );
      this.streamGlint.setAttribute(
        "d",
        this.nodes.artStreams.children[1].getAttribute("d") ?? "",
      );
      this.streamGlint.setAttribute(
        "opacity",
        stage.id === "extract" && q > 0.005 ? 0.45 : 0,
      );
      this.root.dataset.artPressure = pressure.toFixed(2);
      this.lockHand.setAttribute(
        "opacity",
        stage.id === "setup"
          ? 1 - Math.min(1, Math.max(0, (stage.progress - 0.65) / 0.3))
          : 0,
      );
      this.scoopBeans.forEach((bean, i) =>
        bean.setAttribute("opacity", (1 - collected) * 8 > i ? 1 : 0),
      );
    }
  }
  window.BrewArtwork = BrewArtwork;
})();
