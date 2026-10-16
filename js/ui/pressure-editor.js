/**
 * pressure-editor.js — Interactive Custom Pressure Profiling Editor
 * Allows drag-and-drop spline-based pressure curve sculpting (0-35s vs 0-12bar).
 */

export class PressureProfileEditor {
  constructor(canvasId = 'canvasMultiGraph') {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.dpr = window.devicePixelRatio || 1;

    // Control points: Array of { t: seconds (0-35), p: bar (0-12) }
    this.points = [
      { t: 0, p: 2.0 },
      { t: 4, p: 2.0 },
      { t: 6, p: 9.0 },
      { t: 25, p: 8.5 },
      { t: 35, p: 6.0 }
    ];

    this.activePointIndex = -1;
    this.isDragging = false;
    this.hoverPointIndex = -1;

    // View boundaries
    this.padL = 40;
    this.padR = 40;
    this.padT = 20;
    this.padB = 30;
    this.maxTime = 35.0;
    this.maxPressure = 12.0;

    this.listeners = [];
  }

  init() {
    this.bindEvents();
  }

  setPreset(presetName, maxP = 9.0, piDuration = 4.0) {
    switch (presetName) {
      case 'flat':
        this.points = [
          { t: 0, p: maxP },
          { t: this.maxTime, p: maxP }
        ];
        break;
      case 'preinfusion':
        this.points = [
          { t: 0, p: 2.0 },
          { t: piDuration, p: 2.0 },
          { t: Math.min(piDuration + 2.0, this.maxTime), p: maxP },
          { t: this.maxTime, p: maxP }
        ];
        break;
      case 'declining':
        this.points = [
          { t: 0, p: 2.0 },
          { t: piDuration, p: 2.0 },
          { t: piDuration + 1.5, p: maxP },
          { t: 18, p: maxP * 0.8 },
          { t: this.maxTime, p: maxP * 0.55 }
        ];
        break;
      case 'blooming':
        this.points = [
          { t: 0, p: 3.0 },
          { t: 3.0, p: 3.0 },
          { t: 4.0, p: 0.0 }, // Bloom rest
          { t: 9.0, p: 0.0 },
          { t: 11.0, p: maxP },
          { t: this.maxTime, p: maxP * 0.85 }
        ];
        break;
      case 'turbo':
        this.points = [
          { t: 0, p: 6.0 },
          { t: 15, p: 6.0 },
          { t: this.maxTime, p: 5.5 }
        ];
        break;
      default:
        break;
    }
    this.notifyChange();
  }

  bindEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
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
    const t = Math.max(0, Math.min(this.maxTime, ((px - this.padL) / plotW) * this.maxTime));
    const p = Math.max(0, Math.min(this.maxPressure, ((plotH - (py - this.padT)) / plotH) * this.maxPressure));
    return { t: Math.round(t * 10) / 10, p: Math.round(p * 10) / 10 };
  }

  onMouseDown(e) {
    const { rect } = this.getPlotBounds();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check hit on control points
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const { x, y } = this.valToPx(pt.t, pt.p);
      const dist = Math.hypot(mx - x, my - y);
      if (dist <= 10) {
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
      
      // Preserve fixed start point at t=0 and end point at maxTime
      if (this.activePointIndex === 0) {
        this.points[0].p = p;
      } else if (this.activePointIndex === this.points.length - 1) {
        this.points[this.points.length - 1].p = p;
      } else {
        this.points[this.activePointIndex].t = t;
        this.points[this.activePointIndex].p = p;
        // Sort points by time
        this.points.sort((a, b) => a.t - b.t);
        this.activePointIndex = this.points.findIndex(pt => pt.t === t && pt.p === p);
      }

      this.notifyChange();
      return;
    }

    // Hover check
    let found = -1;
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const { x, y } = this.valToPx(pt.t, pt.p);
      if (Math.hypot(mx - x, my - y) <= 10) {
        found = i;
        break;
      }
    }
    this.hoverPointIndex = found;
    this.canvas.style.cursor = found >= 0 ? 'grab' : 'crosshair';
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

    // If near existing point, delete it (except start and end)
    for (let i = 1; i < this.points.length - 1; i++) {
      const pt = this.points[i];
      const { x, y } = this.valToPx(pt.t, pt.p);
      if (Math.hypot(mx - x, my - y) <= 10) {
        this.points.splice(i, 1);
        this.notifyChange();
        return;
      }
    }

    // Otherwise add new point
    this.points.push({ t, p });
    this.points.sort((a, b) => a.t - b.t);
    this.notifyChange();
  }

  // Linear / Monotone interpolation to get Pressure at any time `t`
  getP(t) {
    if (this.points.length === 0) return 9.0;
    if (t <= this.points[0].t) return this.points[0].p;
    if (t >= this.points[this.points.length - 1].t) return this.points[this.points.length - 1].p;

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

    // Background Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    // Time Vertical Grid
    ctx.fillStyle = '#606c7e';
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'center';
    for (let t = 0; t <= this.maxTime; t += 5) {
      const { x } = this.valToPx(t, 0);
      ctx.beginPath();
      ctx.moveTo(x, this.padT);
      ctx.lineTo(x, this.padT + plotH);
      ctx.stroke();
      ctx.fillText(`${t}s`, x, this.padT + plotH + 16);
    }

    // Pressure Horizontal Grid (0 to 12 bar)
    ctx.textAlign = 'right';
    for (let p = 0; p <= this.maxPressure; p += 3) {
      const { y } = this.valToPx(0, p);
      ctx.beginPath();
      ctx.moveTo(this.padL, y);
      ctx.lineTo(this.padL + plotW, y);
      ctx.stroke();
      ctx.fillStyle = 'hsl(270, 75%, 65%)';
      ctx.fillText(`${p} bar`, this.padL - 6, y + 4);
    }

    // Draw Smooth Profile Curve
    ctx.beginPath();
    ctx.strokeStyle = 'hsl(270, 85%, 68%)';
    ctx.lineWidth = 3;

    for (let px = 0; px <= plotW; px += 2) {
      const t = (px / plotW) * this.maxTime;
      const p = this.getP(t);
      const { x, y } = this.valToPx(t, p);
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve
    const { x: endX, y: endY } = this.valToPx(this.maxTime, 0);
    const { x: startX, y: startY } = this.valToPx(0, 0);
    ctx.lineTo(endX, endY);
    ctx.lineTo(startX, startY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, this.padT, 0, this.padT + plotH);
    grad.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
    grad.addColorStop(1, 'rgba(168, 85, 247, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Render Editable Control Points
    this.points.forEach((pt, idx) => {
      const { x, y } = this.valToPx(pt.t, pt.p);
      const isHover = idx === this.hoverPointIndex;
      const isActive = idx === this.activePointIndex;

      // Glow circle
      ctx.beginPath();
      ctx.arc(x, y, isActive ? 8 : (isHover ? 7 : 5), 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#fff' : '#c084fc';
      ctx.fill();
      ctx.strokeStyle = '#581c87';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Point Value Tooltip Tag
      if (isHover || isActive) {
        ctx.fillStyle = 'rgba(20, 24, 30, 0.9)';
        ctx.fillRect(x - 28, y - 24, 56, 16);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 28, y - 24, 56, 16);

        ctx.fillStyle = '#f3e8ff';
        ctx.font = '9px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`${pt.p}b / ${pt.t}s`, x, y - 12);
      }
    });

    // Helper Hint Text at Top Right
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px "Inter", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('💡 ダブルクリックで点追加 / 点削除', this.padL + plotW, this.padT - 6);
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  notifyChange() {
    this.listeners.forEach(cb => cb(this.points));
  }
}
