/**
 * charts.js — High-DPI Synchronized Multi-Curve Engine, SCA BCC, & Flavor Radar
 */

import { PressureProfileEditor } from './pressure-editor.js';

export class ChartEngine {
  constructor() {
    this.canvases = {};
    this.ctxs = {};
    this.dpr = window.devicePixelRatio || 1;
    this.activeTab = 'graphFlow';

    this.pressureEditor = new PressureProfileEditor('canvasMultiGraph');
    this.timeSeries = [];
    this.hoverTime = null;
    this.currentTDS = 10.2;
    this.currentEY = 20.4;
    this.flavorScores = { acidity: 7.8, sweetness: 8.4, bitterness: 5.8, astringency: 2.6, body: 8.6 };
  }

  init() {
    this.setupCanvases();
    this.bindTabEvents();
    this.bindGraphHoverEvents();
    this.pressureEditor.init();

    this.pressureEditor.subscribe(() => {
      if (this.activeTab === 'graphPressureEditor') {
        this.renderActiveGraph();
      }
    });

    window.addEventListener('resize', () => {
      this.setupCanvases();
      this.renderAll();
    });
  }

  setupCanvases() {
    const ids = [
      'canvasPSDPreview',
      'canvasMultiGraph',
      'canvasBCC',
      'canvasFlavorRadar'
    ];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const rect = el.parentElement.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height) || parseInt(el.getAttribute('height'), 10) || 200;

      el.width = w * this.dpr;
      el.height = h * this.dpr;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;

      const ctx = el.getContext('2d');
      ctx.scale(this.dpr, this.dpr);

      this.canvases[id] = { el, w, h };
      this.ctxs[id] = ctx;
    });
  }

  bindTabEvents() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const legend = document.getElementById('graphLegend');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTab = btn.getAttribute('data-target');

        if (legend) {
          if (this.activeTab === 'graphFlow') {
            legend.innerHTML = `
              <span class="legend-item"><span class="dot dot-amber"></span>流量 (mL/s)</span>
              <span class="legend-item"><span class="dot dot-cyan"></span>TDS (%)</span>
              <span class="legend-item"><span class="dot dot-green"></span>収率 EY (%)</span>
              <span class="legend-item"><span class="dot dot-purple"></span>圧力 (bar)</span>
            `;
          } else if (this.activeTab === 'graphPorosity') {
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
    const canvas = this.canvases['canvasMultiGraph']?.el;
    if (!canvas) return;

    canvas.addEventListener('mousemove', (e) => {
      if (this.activeTab === 'graphPressureEditor') return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const padL = 40;
      const padR = 40;
      const plotW = rect.width - padL - padR;

      if (mx >= padL && mx <= padL + plotW) {
        const prog = (mx - padL) / plotW;
        this.hoverTime = prog * 35.0;
      } else {
        this.hoverTime = null;
      }
      this.renderActiveGraph();
    });

    canvas.addEventListener('mouseleave', () => {
      if (this.activeTab === 'graphPressureEditor') return;
      this.hoverTime = null;
      this.renderActiveGraph();
    });
  }

  // Update dynamic simulation dataset from live solver
  updateDataset(timeSeries, tds, ey, flavor, bccInfo) {
    this.timeSeries = timeSeries;
    this.currentTDS = tds;
    this.currentEY = ey;
    this.flavorScores = flavor;

    const bccTitle = document.getElementById('bccZoneTitle');
    const bccDesc = document.getElementById('bccZoneDesc');
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
    const info = this.canvases['canvasMultiGraph'];
    if (!info) return;
    const { w, h } = info;
    const ctx = this.ctxs['canvasMultiGraph'];

    ctx.clearRect(0, 0, w, h);

    if (this.activeTab === 'graphPressureEditor') {
      this.pressureEditor.render(ctx);
    } else if (this.activeTab === 'graphFlow') {
      this.renderFlowTdsGraph(ctx, w, h);
    } else if (this.activeTab === 'graphPorosity') {
      this.renderPorosityGraph(ctx, w, h);
    }
  }

  // --- 1. Multi-Curve: Flow, TDS, EY, Pressure ---
  renderFlowTdsGraph(ctx, w, h) {
    const padL = 40, padR = 40, padT = 20, padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxTime = 35.0;

    // Grid & Axis
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#606c7e';
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'center';

    for (let t = 0; t <= maxTime; t += 5) {
      const x = padL + (t / maxTime) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillText(`${t}s`, x, padT + plotH + 16);
    }

    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }

    // Y Axis Scale Labels
    ctx.fillStyle = 'hsl(38, 92%, 52%)';
    ctx.fillText('4.0', padL - 6, padT + 4);
    ctx.fillText('2.0', padL - 6, padT + plotH / 2 + 4);
    ctx.fillText('0.0', padL - 6, padT + plotH + 4);

    ctx.fillStyle = 'hsl(190, 85%, 55%)';
    ctx.textAlign = 'left';
    ctx.fillText('20%', padL + plotW + 6, padT + 4);
    ctx.fillText('10%', padL + plotW + 6, padT + plotH / 2 + 4);
    ctx.fillText('0%', padL + plotW + 6, padT + plotH + 4);

    if (this.timeSeries.length === 0) return;

    const toX = (t) => padL + (t / maxTime) * plotW;
    const toYLeft = (flow) => padT + plotH - (flow / 4.0) * plotH;
    const toYRight = (pct) => padT + plotH - (pct / 25.0) * plotH;

    // --- Pressure (Purple dashed) ---
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
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

    // --- Flow Rate Q(t) (Amber) ---
    ctx.beginPath();
    ctx.strokeStyle = 'hsl(38, 92%, 52%)';
    ctx.lineWidth = 2.5;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toYLeft(pt.q);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // --- Instant TDS (Cyan) ---
    ctx.beginPath();
    ctx.strokeStyle = 'hsl(190, 85%, 55%)';
    ctx.lineWidth = 2.0;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toYRight(pt.tdsInst);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // --- Cumulative EY (%) (Emerald) ---
    ctx.beginPath();
    ctx.strokeStyle = 'hsl(142, 65%, 50%)';
    ctx.lineWidth = 2.0;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toYRight(pt.ey);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // --- Hover Inspection Tooltip ---
    if (this.hoverTime !== null && this.timeSeries.length > 0) {
      const nearest = this.timeSeries.reduce((prev, curr) => 
        Math.abs(curr.t - this.hoverTime) < Math.abs(prev.t - this.hoverTime) ? curr : prev
      );

      const hx = toX(nearest.t);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hx, padT);
      ctx.lineTo(hx, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const ttW = 140;
      const ttH = 80;
      let ttX = hx + 10;
      if (ttX + ttW > w - padR) ttX = hx - ttW - 10;
      const ttY = padT + 10;

      ctx.fillStyle = 'rgba(18, 22, 28, 0.92)';
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(ttX, ttY, ttW, ttH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText(`⏱️ t = ${nearest.t.toFixed(1)}s`, ttX + 8, ttY + 16);

      ctx.fillStyle = 'hsl(38, 92%, 52%)';
      ctx.fillText(`Flow: ${nearest.q.toFixed(2)} mL/s`, ttX + 8, ttY + 30);

      ctx.fillStyle = 'hsl(190, 85%, 55%)';
      ctx.fillText(`TDS:  ${nearest.tdsInst.toFixed(1)}%`, ttX + 8, ttY + 44);

      ctx.fillStyle = 'hsl(142, 65%, 50%)';
      ctx.fillText(`EY:   ${nearest.ey.toFixed(1)}%`, ttX + 8, ttY + 58);

      ctx.fillStyle = 'hsl(270, 75%, 65%)';
      ctx.fillText(`Press:${nearest.p.toFixed(1)} bar`, ttX + 8, ttY + 72);
    }
  }

  // --- 2. Porosity Graph ---
  renderPorosityGraph(ctx, w, h) {
    const padL = 40, padR = 40, padT = 20, padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxTime = 35.0;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#606c7e';
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'center';

    for (let t = 0; t <= maxTime; t += 5) {
      const x = padL + (t / maxTime) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillText(`${t}s`, x, padT + plotH + 16);
    }

    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      const val = (0.50 - (i / 4) * 0.30).toFixed(2);
      ctx.fillText(val, padL - 6, y + 4);
    }

    if (this.timeSeries.length === 0) return;

    const toX = (t) => padL + (t / maxTime) * plotW;
    const toY = (eps) => padT + plotH - ((eps - 0.20) / 0.30) * plotH;

    // Top Layer
    ctx.beginPath();
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toY(pt.epsTop);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Mid Layer
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toY(pt.epsMid);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Bot Layer
    ctx.beginPath();
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2.5;
    this.timeSeries.forEach((pt, idx) => {
      const x = toX(pt.t);
      const y = toY(pt.epsBot);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // --- 3. SCA Brewing Control Chart ---
  renderBCC() {
    const info = this.canvases['canvasBCC'];
    if (!info) return;
    const { w, h } = info;
    const ctx = this.ctxs['canvasBCC'];

    ctx.clearRect(0, 0, w, h);

    const pad = 24;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const eyMin = 14, eyMax = 26;
    const tdsMin = 6, tdsMax = 14;

    const toX = (ey) => pad + ((ey - eyMin) / (eyMax - eyMin)) * plotW;
    const toY = (tds) => pad + plotH - ((tds - tdsMin) / (tdsMax - tdsMin)) * plotH;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, plotW, plotH);

    // Ideal Zone
    const x1 = toX(18), x2 = toX(22);
    const y1 = toY(12), y2 = toY(8);

    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    ctx.fillStyle = 'hsl(38, 92%, 55%)';
    ctx.font = '9px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IDEAL ZONE', (x1 + x2) / 2, (y1 + y2) / 2 + 3);

    ctx.fillStyle = '#606c7e';
    ctx.font = '8px "Inter", sans-serif';
    ctx.fillText('酸味優位', toX(15.5), toY(13));
    ctx.fillText('過抽出 (苦味)', toX(24.5), toY(7));
    ctx.fillText('Lungo (薄め)', toX(16), toY(6.8));

    ctx.font = '8px "JetBrains Mono"';
    ctx.fillText('14%', pad, h - 6);
    ctx.fillText('26% EY', w - pad, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText('14%', pad - 3, pad + 8);
    ctx.fillText('6%', pad - 3, h - pad);

    // Trajectory
    if (this.timeSeries.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);

      this.timeSeries.filter(pt => pt.ey >= 13 && pt.tdsCup >= 5).forEach((pt, idx) => {
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
      ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = 'hsl(38, 92%, 50%)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // --- 4. Flavor Radar Chart ---
  renderFlavorRadar() {
    const info = this.canvases['canvasFlavorRadar'];
    if (!info) return;
    const { w, h } = info;
    const ctx = this.ctxs['canvasFlavorRadar'];

    ctx.clearRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h / 2 + 8;
    const radius = Math.min(w, h) * 0.36;
    const attributes = [
      { name: '酸味', key: 'acidity' },
      { name: '甘味', key: 'sweetness' },
      { name: '苦味', key: 'bitterness' },
      { name: '渋味', key: 'astringency' },
      { name: 'ボディ', key: 'body' }
    ];
    const count = attributes.length;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let lvl = 1; lvl <= 4; lvl++) {
      const r = (radius / 4) * lvl;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "Inter", sans-serif';
    ctx.textAlign = 'center';

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();

      const labelX = centerX + Math.cos(angle) * (radius + 16);
      const labelY = centerY + Math.sin(angle) * (radius + 16) + 3;
      ctx.fillText(attributes[i].name, labelX, labelY);
    }

    ctx.beginPath();
    ctx.strokeStyle = 'hsl(38, 92%, 52%)';
    ctx.lineWidth = 2;

    attributes.forEach((attr, idx) => {
      const angle = (Math.PI * 2 / count) * idx - Math.PI / 2;
      const score = (this.flavorScores[attr.key] || 0) / 10;
      const r = radius * score;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.fill();
  }

  // --- 5. PSD Preview ---
  renderPSDPreview(d50 = 380, finesRatio = 0.18) {
    const info = this.canvases['canvasPSDPreview'];
    if (!info) return;
    const { w, h } = info;
    const ctx = this.ctxs['canvasPSDPreview'];

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.strokeStyle = 'hsl(38, 92%, 55%)';
    ctx.lineWidth = 2;

    const finesMean = 40;
    const coarseMean = d50;
    const maxMicrons = 900;

    for (let px = 0; px < w; px++) {
      const microns = (px / w) * maxMicrons;
      const f1 = (finesRatio / (microns * 0.4 * Math.sqrt(2 * Math.PI))) * 
                 Math.exp(-Math.pow(Math.log(microns / finesMean), 2) / (2 * 0.4 * 0.4));
      const f2 = ((1 - finesRatio) / (microns * 0.28 * Math.sqrt(2 * Math.PI))) * 
                 Math.exp(-Math.pow(Math.log(microns / coarseMean), 2) / (2 * 0.28 * 0.28));
      
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
    grad.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }
}
