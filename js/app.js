/** Canvas charts and optional Three.js presentation. Shot state lives in journey.js. */

(function () {
  "use strict";

  // =========================================================================
  // 1. PRESSURE PROFILE EDITOR (2D Canvas)
  // =========================================================================
  class PressureProfileEditor {
    constructor(canvasId = "canvasMultiGraph") {
      this.canvas = document.getElementById(canvasId);
      this.dpr = window.devicePixelRatio || 1;
      this.points = [
        { t: 0, p: 2.0 },
        { t: 4, p: 2.0 },
        { t: 6, p: 9.0 },
        { t: 25, p: 8.5 },
        { t: 35, p: 6.0 },
      ];
      this.activePointIndex = -1;
      this.isDragging = false;
      this.hoverPointIndex = -1;
      this.padL = 40;
      this.padR = 40;
      this.padT = 20;
      this.padB = 30;
      this.maxTime = 35.0;
      this.maxPressure = 12.0;
      this.listeners = [];
    }

    init() {
      if (!this.canvas) return;
      this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
      window.addEventListener("mousemove", (e) => this.onMouseMove(e));
      window.addEventListener("mouseup", () => this.onMouseUp());
      this.canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    }

    setPreset(presetName, maxP = 9.0, piDuration = 4.0) {
      switch (presetName) {
        case "flat":
          this.points = [
            { t: 0, p: maxP },
            { t: this.maxTime, p: maxP },
          ];
          break;
        case "preinfusion":
          this.points = [
            { t: 0, p: 2.0 },
            { t: piDuration, p: 2.0 },
            { t: Math.min(piDuration + 2.0, this.maxTime), p: maxP },
            { t: this.maxTime, p: maxP },
          ];
          break;
        case "declining":
          this.points = [
            { t: 0, p: 2.0 },
            { t: piDuration, p: 2.0 },
            { t: piDuration + 1.5, p: maxP },
            { t: 18, p: maxP * 0.8 },
            { t: this.maxTime, p: maxP * 0.55 },
          ];
          break;
        case "blooming":
          this.points = [
            { t: 0, p: 3.0 },
            { t: 3.0, p: 3.0 },
            { t: 4.0, p: 0.0 },
            { t: 9.0, p: 0.0 },
            { t: 11.0, p: maxP },
            { t: this.maxTime, p: maxP * 0.85 },
          ];
          break;
        case "turbo":
          this.points = [
            { t: 0, p: 6.0 },
            { t: 15, p: 6.0 },
            { t: this.maxTime, p: 5.5 },
          ];
          break;
        default:
          break;
      }
      this.notifyChange();
    }

    getPlotBounds() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const plotW = w - this.padL - this.padR;
      const plotH = h - this.padT - this.padB;
      return { w, h, plotW, plotH, rect };
    }

    valToPx(t, p) {
      const { plotW, plotH } = this.getPlotBounds();
      const x = this.padL + (t / this.maxTime) * plotW;
      const y = this.padT + plotH - (p / this.maxPressure) * plotH;
      return { x, y };
    }

    pxToVal(px, py) {
      const { plotW, plotH } = this.getPlotBounds();
      const t = Math.max(
        0,
        Math.min(this.maxTime, ((px - this.padL) / plotW) * this.maxTime),
      );
      const p = Math.max(
        0,
        Math.min(
          this.maxPressure,
          ((plotH - (py - this.padT)) / plotH) * this.maxPressure,
        ),
      );
      return { t: Math.round(t * 10) / 10, p: Math.round(p * 10) / 10 };
    }

    onMouseDown(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          this.activePointIndex = i;
          this.isDragging = true;
          return;
        }
      }
    }

    onMouseMove(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging && this.activePointIndex >= 0) {
        const { t, p } = this.pxToVal(mx, my);
        if (this.activePointIndex === 0) {
          this.points[0].p = p;
        } else if (this.activePointIndex === this.points.length - 1) {
          this.points[this.points.length - 1].p = p;
        } else {
          this.points[this.activePointIndex].t = t;
          this.points[this.activePointIndex].p = p;
          this.points.sort((a, b) => a.t - b.t);
          this.activePointIndex = this.points.findIndex(
            (pt) => pt.t === t && pt.p === p,
          );
        }
        this.notifyChange();
        return;
      }

      let found = -1;
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          found = i;
          break;
        }
      }
      this.hoverPointIndex = found;
      this.canvas.style.cursor = found >= 0 ? "grab" : "crosshair";
    }

    onMouseUp() {
      this.isDragging = false;
      this.activePointIndex = -1;
    }

    onDoubleClick(e) {
      const { rect } = this.getPlotBounds();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { t, p } = this.pxToVal(mx, my);

      for (let i = 1; i < this.points.length - 1; i++) {
        const pt = this.points[i];
        const { x, y } = this.valToPx(pt.t, pt.p);
        if (Math.hypot(mx - x, my - y) <= 12) {
          this.points.splice(i, 1);
          this.notifyChange();
          return;
        }
      }

      this.points.push({ t, p });
      this.points.sort((a, b) => a.t - b.t);
      this.notifyChange();
    }

    getP(t) {
      if (this.points.length === 0) return 9.0;
      if (t <= this.points[0].t) return this.points[0].p;
      if (t >= this.points[this.points.length - 1].t)
        return this.points[this.points.length - 1].p;

      for (let i = 0; i < this.points.length - 1; i++) {
        const p0 = this.points[i];
        const p1 = this.points[i + 1];
        if (t >= p0.t && t <= p1.t) {
          const ratio = (t - p0.t) / (p1.t - p0.t);
          return p0.p + ratio * (p1.p - p0.p);
        }
      }
      return 9.0;
    }

    render(ctx) {
      if (!ctx) return;
      const { plotW, plotH } = this.getPlotBounds();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;

      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";
      for (let t = 0; t <= this.maxTime; t += 5) {
        const { x } = this.valToPx(t, 0);
        ctx.beginPath();
        ctx.moveTo(x, this.padT);
        ctx.lineTo(x, this.padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, this.padT + plotH + 16);
      }

      ctx.textAlign = "right";
      for (let p = 0; p <= this.maxPressure; p += 3) {
        const { y } = this.valToPx(0, p);
        ctx.beginPath();
        ctx.moveTo(this.padL, y);
        ctx.lineTo(this.padL + plotW, y);
        ctx.stroke();
        ctx.fillStyle = "hsl(270, 75%, 65%)";
        ctx.fillText(`${p} bar`, this.padL - 6, y + 4);
      }

      ctx.beginPath();
      ctx.strokeStyle = "hsl(270, 85%, 68%)";
      ctx.lineWidth = 3;

      for (let px = 0; px <= plotW; px += 2) {
        const t = (px / plotW) * this.maxTime;
        const p = this.getP(t);
        const { x, y } = this.valToPx(t, p);
        if (px === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      this.points.forEach((pt, idx) => {
        const { x, y } = this.valToPx(pt.t, pt.p);
        const isHover = idx === this.hoverPointIndex;
        const isActive = idx === this.activePointIndex;

        ctx.beginPath();
        ctx.arc(x, y, isActive ? 8 : isHover ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? "#fff" : "#c084fc";
        ctx.fill();
        ctx.strokeStyle = "#581c87";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (isHover || isActive) {
          ctx.fillStyle = "rgba(20, 24, 30, 0.9)";
          ctx.fillRect(x - 28, y - 24, 56, 16);
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 28, y - 24, 56, 16);

          ctx.fillStyle = "#f3e8ff";
          ctx.font = '9px "JetBrains Mono"';
          ctx.textAlign = "center";
          ctx.fillText(`${pt.p}b / ${pt.t}s`, x, y - 12);
        }
      });
    }

    subscribe(callback) {
      this.listeners.push(callback);
    }
    notifyChange() {
      this.listeners.forEach((cb) => cb(this.points));
    }
  }

  // Canvas charts, independent of the lazy-loaded PBR scene.
  class ChartEngine {
    constructor() {
      this.canvases = {};
      this.ctxs = {};
      this.dpr = window.devicePixelRatio || 1;
      this.activeTab = "graphFlow";
      this.pressureEditor = new PressureProfileEditor("canvasMultiGraph");
      this.timeSeries = [];
      this.hoverTime = null;
      this.currentTDS = 10.2;
      this.currentEY = 20.4;
      this.flavorScores = {
        acidity: 7.8,
        sweetness: 8.4,
        bitterness: 5.8,
        astringency: 2.6,
        body: 8.6,
      };
    }

    init() {
      this.setupCanvases();
      this.bindTabEvents();
      this.bindGraphHoverEvents();
      // Custom pressure is edited with touch/keyboard-friendly numeric inputs.
      this.pressureEditor.subscribe(() => {
        if (this.activeTab === "graphPressureEditor") this.renderActiveGraph();
      });
      window.addEventListener("resize", () => {
        this.setupCanvases();
        this.renderAll();
      });
    }

    setupCanvases() {
      [
        "canvasPSDPreview",
        "canvasMultiGraph",
        "canvasBCC",
        "canvasFlavorRadar",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.parentElement.getBoundingClientRect();
        const w = Math.floor(rect.width) || 300;
        const h =
          Math.floor(rect.height) ||
          parseInt(el.getAttribute("height"), 10) ||
          200;

        el.width = w * this.dpr;
        el.height = h * this.dpr;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;

        const ctx = el.getContext("2d");
        ctx.scale(this.dpr, this.dpr);
        this.canvases[id] = { el, w, h };
        this.ctxs[id] = ctx;
      });
    }

    bindTabEvents() {
      const tabBtns = document.querySelectorAll(".tab-btn");
      const legend = document.getElementById("graphLegend");

      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          tabBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          this.activeTab = btn.getAttribute("data-target");
          tabBtns.forEach((b) =>
            b.setAttribute("aria-pressed", String(b === btn)),
          );

          if (legend) {
            if (this.activeTab === "graphFlow") {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot dot-amber"></span>流量 (g/s)</span>
                <span class="legend-item"><span class="dot dot-cyan"></span>カップ濃度 (%)</span>
                <span class="legend-item"><span class="dot dot-green"></span>収率 EY (%)</span>
                <span class="legend-item"><span class="dot dot-purple"></span>圧力 (bar)</span>
              `;
            } else if (this.activeTab === "graphPorosity") {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot" style="background:#60a5fa"></span>上層空隙率 ε_top</span>
                <span class="legend-item"><span class="dot" style="background:#3b82f6"></span>中央空隙率 ε_mid</span>
                <span class="legend-item"><span class="dot" style="background:#1d4ed8"></span>下層空隙率 ε_bot</span>
              `;
            } else {
              legend.innerHTML = `
                <span class="legend-item"><span class="dot dot-purple"></span>圧力プロファイル (bar)</span>
                <span class="legend-item" style="color:#9ca3af">✎ クリックして制御点をドラッグ</span>
              `;
            }
          }
          this.renderActiveGraph();
        });
      });
    }

    bindGraphHoverEvents() {
      const canvas = this.canvases["canvasMultiGraph"]?.el;
      if (!canvas) return;

      canvas.addEventListener("mousemove", (e) => {
        if (this.activeTab === "graphPressureEditor") return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const padL = 40;
        const plotW = rect.width - 80;
        if (mx >= padL && mx <= padL + plotW) {
          this.hoverTime =
            ((mx - padL) / plotW) * (this.timeSeries.at(-1)?.t || 35);
        } else {
          this.hoverTime = null;
        }
        this.renderActiveGraph();
      });

      canvas.addEventListener("mouseleave", () => {
        if (this.activeTab === "graphPressureEditor") return;
        this.hoverTime = null;
        this.renderActiveGraph();
      });
    }

    updateDataset(timeSeries, tds, ey, flavor, bccInfo) {
      this.timeSeries = timeSeries;
      this.currentTDS = tds;
      this.currentEY = ey;
      this.flavorScores = flavor;

      const bccTitle = document.getElementById("bccZoneTitle");
      const bccDesc = document.getElementById("bccZoneDesc");
      if (bccTitle && bccInfo) bccTitle.textContent = bccInfo.title;
      if (bccDesc && bccInfo) bccDesc.textContent = bccInfo.desc;

      this.renderAll();
    }

    renderAll() {
      this.renderPSDPreview();
      this.renderActiveGraph();
      this.renderBCC();
      this.renderFlavorRadar();
    }

    renderActiveGraph() {
      const info = this.canvases["canvasMultiGraph"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasMultiGraph"];
      ctx.clearRect(0, 0, w, h);

      if (this.activeTab === "graphPressureEditor") {
        this.pressureEditor.render(ctx);
      } else if (this.activeTab === "graphFlow") {
        this.renderFlowTdsGraph(ctx, w, h);
      } else if (this.activeTab === "graphPorosity") {
        this.renderPorosityGraph(ctx, w, h);
      }
    }

    renderFlowTdsGraph(ctx, w, h) {
      const padL = 40,
        padR = 40,
        padT = 20,
        padB = 30;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxTime = Math.ceil((this.timeSeries.at(-1)?.t || 35) / 5) * 5;
      const maxMetric = Math.max(
        25,
        Math.ceil(Math.max(...this.timeSeries.map((pt) => pt.tdsCup)) / 5) * 5,
      );

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";

      for (let t = 0; t <= maxTime; t += 5) {
        const x = padL + (t / maxTime) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, padT + plotH + 16);
      }

      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const y = padT + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }

      ctx.fillStyle = "hsl(38, 92%, 52%)";
      ctx.fillText("10 g/s", padL - 6, padT + 4);
      ctx.fillText("0.0", padL - 6, padT + plotH + 4);
      ctx.fillStyle = "hsl(190, 85%, 55%)";
      ctx.textAlign = "left";
      ctx.fillText(`${maxMetric}%`, padL + plotW + 6, padT + 4);
      ctx.fillText("0%", padL + plotW + 6, padT + plotH + 4);

      if (this.timeSeries.length === 0) return;

      const toX = (t) => padL + (t / maxTime) * plotW;
      const toYLeft = (flow) => padT + plotH - (flow / 10.0) * plotH;
      const toYRight = (pct) => padT + plotH - (pct / maxMetric) * plotH;

      ctx.beginPath();
      ctx.strokeStyle = "rgba(168, 85, 247, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = padT + plotH - (pt.p / 12.0) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 52%)";
      ctx.lineWidth = 2.5;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYLeft(pt.q);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "hsl(190, 85%, 55%)";
      ctx.lineWidth = 2.0;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYRight(pt.tdsCup);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "hsl(142, 65%, 50%)";
      ctx.lineWidth = 2.0;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toYRight(pt.ey);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      if (this.hoverTime !== null) {
        const nearest = this.timeSeries.reduce((prev, curr) =>
          Math.abs(curr.t - this.hoverTime) < Math.abs(prev.t - this.hoverTime)
            ? curr
            : prev,
        );
        const hx = toX(nearest.t);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hx, padT);
        ctx.lineTo(hx, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        const ttW = 140,
          ttH = 80;
        let ttX = hx + 10;
        if (ttX + ttW > w - padR) ttX = hx - ttW - 10;
        const ttY = padT + 10;

        ctx.fillStyle = "rgba(18, 22, 28, 0.92)";
        ctx.strokeStyle = "#4b5563";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(ttX, ttY, ttW, ttH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.fillText(`⏱️ t = ${nearest.t.toFixed(1)}s`, ttX + 8, ttY + 16);
        ctx.fillStyle = "hsl(38, 92%, 52%)";
        ctx.fillText(`Flow: ${nearest.q.toFixed(2)} g/s`, ttX + 8, ttY + 30);
        ctx.fillStyle = "hsl(190, 85%, 55%)";
        ctx.fillText(`TDS:  ${nearest.tdsCup.toFixed(1)}%`, ttX + 8, ttY + 44);
        ctx.fillStyle = "hsl(142, 65%, 50%)";
        ctx.fillText(`EY:   ${nearest.ey.toFixed(1)}%`, ttX + 8, ttY + 58);
        ctx.fillStyle = "hsl(270, 75%, 65%)";
        ctx.fillText(`Press:${nearest.p.toFixed(1)} bar`, ttX + 8, ttY + 72);
      }
    }

    renderPorosityGraph(ctx, w, h) {
      const padL = 40,
        padR = 40,
        padT = 20,
        padB = 30;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const maxTime = Math.ceil((this.timeSeries.at(-1)?.t || 35) / 5) * 5;
      const maxMetric = Math.max(
        25,
        Math.ceil(Math.max(...this.timeSeries.map((pt) => pt.tdsCup)) / 5) * 5,
      );

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#606c7e";
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = "center";
      for (let t = 0; t <= maxTime; t += 5) {
        const x = padL + (t / maxTime) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillText(`${t}s`, x, padT + plotH + 16);
      }

      if (this.timeSeries.length === 0) return;
      const toX = (t) => padL + (t / maxTime) * plotW;
      const toY = (eps) => padT + plotH - ((eps - 0.2) / 0.3) * plotH;

      ctx.beginPath();
      ctx.strokeStyle = "#60a5fa";
      ctx.lineWidth = 2;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toY(pt.epsTop);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 2.5;
      this.timeSeries.forEach((pt, idx) => {
        const x = toX(pt.t);
        const y = toY(pt.epsBot);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    renderBCC() {
      const info = this.canvases["canvasBCC"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasBCC"];
      ctx.clearRect(0, 0, w, h);

      const pad = 24;
      const plotW = w - pad * 2;
      const plotH = h - pad * 2;
      const eyMin = 14,
        eyMax = 26;
      const tdsMin = 6,
        tdsMax = 14;

      const toX = (ey) => pad + ((ey - eyMin) / (eyMax - eyMin)) * plotW;
      const toY = (tds) =>
        pad + plotH - ((tds - tdsMin) / (tdsMax - tdsMin)) * plotH;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeRect(pad, pad, plotW, plotH);

      const x1 = toX(18),
        x2 = toX(22);
      const y1 = toY(12),
        y2 = toY(8);
      ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      ctx.fillStyle = "hsl(38, 92%, 55%)";
      ctx.font = '9px "Inter", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("IDEAL ZONE", (x1 + x2) / 2, (y1 + y2) / 2 + 3);

      ctx.fillStyle = "#606c7e";
      ctx.font = '8px "Inter", sans-serif';
      ctx.fillText("酸味優位", toX(15.5), toY(13));
      ctx.fillText("過抽出 (苦味)", toX(24.5), toY(7));

      if (this.timeSeries.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        this.timeSeries
          .filter((pt) => pt.ey >= 13 && pt.tdsCup >= 5)
          .forEach((pt, idx) => {
            const x = toX(pt.ey);
            const y = toY(pt.tdsCup);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        ctx.stroke();
        ctx.setLineDash([]);

        const curX = Math.max(pad, Math.min(w - pad, toX(this.currentEY)));
        const curY = Math.max(pad, Math.min(h - pad, toY(this.currentTDS)));

        ctx.beginPath();
        ctx.arc(curX, curY, 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 158, 11, 0.35)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "hsl(38, 92%, 50%)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    renderFlavorRadar() {
      const info = this.canvases["canvasFlavorRadar"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasFlavorRadar"];
      ctx.clearRect(0, 0, w, h);

      const centerX = w / 2;
      const centerY = h / 2 + 8;
      const radius = Math.min(w, h) * 0.36;
      const attributes = [
        { name: "酸味", key: "acidity" },
        { name: "甘味", key: "sweetness" },
        { name: "苦味", key: "bitterness" },
        { name: "渋味", key: "astringency" },
        { name: "ボディ", key: "body" },
      ];
      const count = attributes.length;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let lvl = 1; lvl <= 4; lvl++) {
        const r = (radius / 4) * lvl;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const angle = ((Math.PI * 2) / count) * i - Math.PI / 2;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = "#94a3b8";
      ctx.font = '10px "Inter", sans-serif';
      ctx.textAlign = "center";
      for (let i = 0; i < count; i++) {
        const angle = ((Math.PI * 2) / count) * i - Math.PI / 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillText(
          attributes[i].name,
          centerX + Math.cos(angle) * (radius + 16),
          centerY + Math.sin(angle) * (radius + 16) + 3,
        );
      }

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 52%)";
      ctx.lineWidth = 2;
      attributes.forEach((attr, idx) => {
        const angle = ((Math.PI * 2) / count) * idx - Math.PI / 2;
        const score = (this.flavorScores[attr.key] || 0) / 10;
        const r = radius * score;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
      ctx.fill();
    }

    renderPSDPreview(
      d50 = this.psdD50 || 380,
      finesRatio = this.psdFines || 0.18,
    ) {
      this.psdD50 = d50;
      this.psdFines = finesRatio;
      const info = this.canvases["canvasPSDPreview"];
      if (!info) return;
      const { w, h } = info;
      const ctx = this.ctxs["canvasPSDPreview"];
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath();
      ctx.strokeStyle = "hsl(38, 92%, 55%)";
      ctx.lineWidth = 2;

      for (let px = 0; px < w; px++) {
        const microns = Math.max(0.1, (px / w) * 900);
        const f1 =
          (finesRatio / (microns * 0.4 * Math.sqrt(2 * Math.PI))) *
          Math.exp(-Math.pow(Math.log(microns / 40), 2) / (2 * 0.4 * 0.4));
        const f2 =
          ((1 - finesRatio) / (microns * 0.28 * Math.sqrt(2 * Math.PI))) *
          Math.exp(-Math.pow(Math.log(microns / d50), 2) / (2 * 0.28 * 0.28));
        const val = (f1 + f2) * 12000;
        const py = h - 6 - Math.min(val, h - 12);
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(245, 158, 11, 0.25)");
      grad.addColorStop(1, "rgba(245, 158, 11, 0.0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // Presentation is optional: the guided journey and model work without WebGL.
  window.EspressoVisuals = {
    ChartEngine,
  };
})();
