/**
 * animation.js — Dual Stage Animation Engine
 * Visualizes the complete workflow:
 * Phase 1: Grinding (Hopper beans -> Rotating Burr teeth -> Powder ground into basket)
 * Phase 2: Tamping (Tamper descends & compresses fluffy bed)
 * Phase 3: Extraction (Portafilter locked -> Water injection -> Liquid stream & Crema cup filling)
 */

export class PuckAnimationEngine {
  constructor(canvasId = 'canvasPuckAnimation') {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.dpr = window.devicePixelRatio || 1;

    this.isRunning = false;
    this.rafId = null;
    this.currentTime = 0;
    this.maxTime = 28.0; // Total sequence duration

    // View Mode: 'full' | 'grinder' | 'extraction'
    this.viewMode = 'full';

    // Particle arrays
    this.beans = [];
    this.grounds = [];
    this.droplets = [];
    
    // Dynamic physical visual states
    this.grinderAngle = 0;
    this.tampProgress = 0; // 0 (up) to 1 (compressed)
    this.saturation = 0;
    this.compression = 0;
    this.flowRate = 0;
    this.pressure = 0;
    this.liquidYield = 0;
    this.cremaRatio = 0;
  }

  init() {
    this.resize();
    this.bindViewTabs();
    window.addEventListener('resize', () => this.resize());
    this.reset();
  }

  bindViewTabs() {
    const tabFull = document.getElementById('tabViewFull');
    const tabGrind = document.getElementById('tabViewGrinder');
    const tabExt = document.getElementById('tabViewExtraction');

    const setTab = (btn, mode) => {
      [tabFull, tabGrind, tabExt].forEach(b => b && b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      this.viewMode = mode;
      this.renderFrame(this.currentTime);
    };

    if (tabFull) tabFull.addEventListener('click', () => setTab(tabFull, 'full'));
    if (tabGrind) tabGrind.addEventListener('click', () => setTab(tabGrind, 'grinder'));
    if (tabExt) tabExt.addEventListener('click', () => setTab(tabExt, 'extraction'));
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height) || 230;

    this.w = w;
    this.h = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);
    this.renderFrame(this.currentTime);
  }

  start(duration = 28.0) {
    this.maxTime = duration;
    this.currentTime = 0;
    this.isRunning = true;
    this.lastTimestamp = performance.now();
    this.initParticles();
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  reset() {
    this.stop();
    this.currentTime = 0;
    this.saturation = 0;
    this.compression = 0;
    this.flowRate = 0;
    this.pressure = 0;
    this.liquidYield = 0;
    this.cremaRatio = 0;
    this.tampProgress = 0;
    this.initParticles();
    this.updateGauges('STANDBY', 0, 0, 0, 0);
    this.renderFrame(0);
  }

  initParticles() {
    this.beans = [];
    this.grounds = [];
    this.droplets = [];

    // Pre-generate hopper beans
    for (let i = 0; i < 24; i++) {
      this.beans.push({
        x: (Math.random() - 0.5) * 80,
        y: -15 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 1 + Math.random() * 1.5,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.1,
        color: '#452b18'
      });
    }
  }

  updateGauges(phaseName, p, flow, yld, timeSec) {
    const elPhase = document.getElementById('livePhaseLabel');
    const elP = document.getElementById('livePressure');
    const elF = document.getElementById('liveFlowRate');
    const elY = document.getElementById('liveYield');
    const elTimer = document.getElementById('simTimerDisplay');

    if (elPhase) elPhase.textContent = phaseName;
    if (elP) elP.innerHTML = `${p.toFixed(1)} <span class="g-unit">bar</span>`;
    if (elF) elF.innerHTML = `${flow.toFixed(2)} <span class="g-unit">mL/s</span>`;
    if (elY) elY.innerHTML = `${yld.toFixed(1)} <span class="g-unit">g</span>`;
    
    if (elTimer) {
      const m = Math.floor(timeSec / 60);
      const s = (timeSec % 60).toFixed(1);
      elTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(4, '0')}`;
    }
  }

  loop() {
    if (!this.isRunning) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTimestamp) / 1000);
    this.lastTimestamp = now;

    this.currentTime += dt;

    this.updateTimeline(this.currentTime, dt);
    this.renderFrame(this.currentTime);

    if (this.currentTime >= this.maxTime) {
      this.stop();
      window.dispatchEvent(new CustomEvent('simulationComplete'));
      return;
    }

    this.rafId = requestAnimationFrame(() => this.loop());
  }

  updateTimeline(timeSec, dt) {
    // Stage 1: Grinding (0.0s -> 3.5s)
    // Stage 2: Tamping (3.5s -> 5.5s)
    // Stage 3: Extraction (5.5s -> 28.0s)

    if (timeSec < 3.5) {
      // --- GRINDING PHASE ---
      this.grinderAngle += dt * 15;
      
      // Emit falling coffee grounds into basket
      if (Math.random() < 0.8) {
        this.grounds.push({
          x: (Math.random() - 0.5) * 120,
          y: 40,
          vy: 3 + Math.random() * 4,
          vx: (Math.random() - 0.5) * 1.5,
          size: 1 + Math.random() * 1.5,
          color: Math.random() < 0.2 ? '#2b1a0d' : '#5a381e'
        });
      }

      this.updateGauges('GRINDING (豆粉砕)', 0, 0, 0, timeSec);

    } else if (timeSec < 5.5) {
      // --- TAMPING PHASE ---
      const prog = (timeSec - 3.5) / 2.0;
      this.tampProgress = Math.sin(prog * Math.PI); // tamper down and up
      this.updateGauges('TAMPING (圧密)', 0, 0, 0, timeSec);

    } else {
      // --- EXTRACTION PHASE ---
      const extTime = timeSec - 5.5;

      // Pressure Ramp
      if (extTime < 3.0) {
        this.pressure = 2.0; // Pre-infusion
      } else if (extTime < 5.0) {
        this.pressure = 2.0 + (extTime - 3.0) * 3.5; // Ramp to 9 bar
      } else {
        this.pressure = Math.max(6.0, 9.0 - (extTime - 5.0) * 0.12);
      }

      // Water Infiltration Front (Saturation)
      this.saturation = Math.min(1.0, extTime / 3.2);

      // Hydraulic Compression
      this.compression = Math.min(1.0, (this.pressure / 9.0) * 0.9);

      // Flow Rate
      if (extTime < 2.5) {
        this.flowRate = 0;
      } else if (extTime < 6.0) {
        this.flowRate = ((extTime - 2.5) / 3.5) * 2.1;
      } else {
        this.flowRate = Math.max(1.1, 2.1 - (extTime - 6.0) * 0.03);
      }

      // Cup Liquid Accumulation
      if (extTime >= 2.5) {
        this.liquidYield += (this.flowRate * dt);
        this.liquidYield = Math.min(36.0, this.liquidYield);
        this.cremaRatio = Math.min(1.0, this.liquidYield / 16.0);
      }

      this.updateGauges('EXTRACTING (加圧抽出)', this.pressure, this.flowRate, this.liquidYield, timeSec);
    }
  }

  renderFrame(timeSec) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    ctx.clearRect(0, 0, w, h);

    if (this.viewMode === 'grinder' || (this.viewMode === 'full' && timeSec < 3.5)) {
      this.renderGrinderStage(ctx, w, h, timeSec);
    } else if (this.viewMode === 'full' && timeSec < 5.5) {
      this.renderTampingStage(ctx, w, h, timeSec);
    } else {
      this.renderExtractionStage(ctx, w, h, timeSec);
    }
  }

  // =========================================================================
  // VIEW 1: GRINDER STAGE (Hopper, Burr Teeth, Ground Powder Flow)
  // =========================================================================
  renderGrinderStage(ctx, w, h, timeSec) {
    const cx = w / 2;
    const burrY = 95;

    // --- A. Hopper (Glass funnel with roasting beans) ---
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 70, 10);
    ctx.lineTo(cx - 24, burrY - 25);
    ctx.lineTo(cx + 24, burrY - 25);
    ctx.lineTo(cx + 70, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Roasted Beans inside hopper
    this.beans.forEach((b, idx) => {
      const bx = cx + b.x * (1 - (b.y + 15) / 100);
      const by = 20 + (b.y % 45);
      
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(b.rot + this.grinderAngle * 0.1);
      ctx.fillStyle = '#4a2f1b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Bean center crack
      ctx.strokeStyle = '#221208';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      ctx.restore();
    });

    // --- B. Burr Housing & Rotating Cutting Teeth ---
    const burrGrad = ctx.createLinearGradient(cx - 50, burrY, cx + 50, burrY);
    burrGrad.addColorStop(0, '#374151');
    burrGrad.addColorStop(0.5, '#6b7280');
    burrGrad.addColorStop(1, '#374151');
    ctx.fillStyle = burrGrad;
    ctx.fillRect(cx - 45, burrY - 25, 90, 30);

    // Rotating Burr Teeth Marks
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const offset = (this.grinderAngle + i * 20) % 70 - 35;
      ctx.beginPath();
      ctx.moveTo(cx + offset, burrY - 20);
      ctx.lineTo(cx + offset + 8, burrY);
      ctx.stroke();
    }

    // --- C. Falling Coffee Grounds & Portafilter Basket ---
    const basketTop = h - 65;
    const basketW = 140;

    // Falling ground particle stream
    ctx.fillStyle = '#b45309';
    for (let i = this.grounds.length - 1; i >= 0; i--) {
      const g = this.grounds[i];
      g.y += g.vy;
      g.x += g.vx;

      ctx.fillRect(cx + g.x, g.y, g.size, g.size);

      if (g.y > basketTop + 20) {
        this.grounds.splice(i, 1);
      }
    }

    // Portafilter Basket outline
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - basketW / 2, basketTop);
    ctx.lineTo(cx - basketW / 2, basketTop + 45);
    ctx.lineTo(cx + basketW / 2, basketTop + 45);
    ctx.lineTo(cx + basketW / 2, basketTop);
    ctx.stroke();

    // Fluffy Mound of Ground Coffee accumulating in basket
    const moundProgress = Math.min(1.0, timeSec / 3.5);
    const moundH = moundProgress * 32;

    ctx.fillStyle = '#54361e';
    ctx.beginPath();
    ctx.moveTo(cx - basketW / 2 + 4, basketTop + 43);
    ctx.quadraticCurveTo(cx, basketTop + 43 - moundH * 1.3, cx + basketW / 2 - 4, basketTop + 43);
    ctx.closePath();
    ctx.fill();

    // Stage Caption
    ctx.fillStyle = '#fbbf24';
    ctx.font = '11px "JetBrains Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('⚙️ GRINDING: 豆破砕 & バスケットドージング中...', cx, h - 8);
  }

  // =========================================================================
  // VIEW 2: TAMPING STAGE
  // =========================================================================
  renderTampingStage(ctx, w, h, timeSec) {
    const cx = w / 2;
    const basketTop = h - 80;
    const basketW = 140;
    const tampY = basketTop - 30 + this.tampProgress * 35;

    // Basket
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - basketW / 2, basketTop, basketW, 45);

    // Coffee Bed being compressed
    const bedH = 34 - this.tampProgress * 10;
    ctx.fillStyle = '#3d2413';
    ctx.fillRect(cx - basketW / 2 + 3, basketTop + 43 - bedH, basketW - 6, bedH);

    // Tamper Base & Handle descending
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx - basketW / 2 + 4, tampY, basketW - 8, 12);
    // Walnut wooden handle
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.roundRect(cx - 16, tampY - 45, 32, 45, 6);
    ctx.fill();

    ctx.fillStyle = '#38bdf8';
    ctx.font = '11px "JetBrains Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('📦 TAMPING: 15kgf 圧密 & 水平パック成形', cx, h - 8);
  }

  // =========================================================================
  // VIEW 3: EXTRACTION STAGE (Saturation, Spout stream, Crema)
  // =========================================================================
  renderExtractionStage(ctx, w, h, timeSec) {
    const centerX = w / 2;
    const basketW = Math.min(220, w * 0.52);
    const basketH = 75;
    const basketTop = 35;

    // Shower screen & water head
    ctx.fillStyle = '#2d333b';
    ctx.fillRect(centerX - basketW / 2 - 12, basketTop - 18, basketW + 24, 16);
    
    if (this.pressure > 0.5) {
      ctx.fillStyle = 'rgba(100, 180, 255, 0.45)';
      for (let x = centerX - basketW / 2 + 8; x <= centerX + basketW / 2 - 8; x += 12) {
        const offset = Math.sin(timeSec * 20 + x) * 2;
        ctx.beginPath();
        ctx.arc(x, basketTop - 4 + offset, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Basket Shell
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(centerX - basketW / 2, basketTop);
    ctx.lineTo(centerX - basketW / 2, basketTop + basketH);
    ctx.lineTo(centerX - basketW / 2 + 12, basketTop + basketH + 12);
    ctx.lineTo(centerX + basketW / 2 - 12, basketTop + basketH + 12);
    ctx.lineTo(centerX + basketW / 2, basketTop + basketH);
    ctx.lineTo(centerX + basketW / 2, basketTop);
    ctx.stroke();

    // Coffee Bed with Compaction
    const compPx = this.compression * 7;
    const bedTop = basketTop + 12 + compPx;
    const bedH = basketH - 14 - compPx;
    const bedL = centerX - basketW / 2 + 3;
    const bedW = basketW - 6;

    // Dry Layer
    ctx.fillStyle = '#452b18';
    ctx.fillRect(bedL, bedTop, bedW, bedH);

    // Wet Infiltration Layer
    if (this.saturation > 0) {
      const wetH = bedH * this.saturation;
      const wetGrad = ctx.createLinearGradient(0, bedTop, 0, bedTop + wetH);
      wetGrad.addColorStop(0, '#1a0d05');
      wetGrad.addColorStop(1, '#382010');
      ctx.fillStyle = wetGrad;
      ctx.fillRect(bedL, bedTop, bedW, wetH);
    }

    // Bottom Spout & Liquid Fluid
    const spoutY = basketTop + basketH + 12;
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.moveTo(centerX - 8, spoutY);
    ctx.lineTo(centerX + 8, spoutY);
    ctx.lineTo(centerX + 4, spoutY + 12);
    ctx.lineTo(centerX - 4, spoutY + 12);
    ctx.closePath();
    ctx.fill();

    const streamStart = spoutY + 12;
    const cupLevel = h - 28;

    if (this.flowRate > 0) {
      const streamW = Math.min(5, Math.max(2, this.flowRate * 1.8));
      const flowGrad = ctx.createLinearGradient(centerX - streamW, 0, centerX + streamW, 0);
      flowGrad.addColorStop(0, '#92400e');
      flowGrad.addColorStop(0.5, '#f59e0b');
      flowGrad.addColorStop(1, '#92400e');

      ctx.fillStyle = flowGrad;
      ctx.beginPath();
      ctx.moveTo(centerX - streamW / 2, streamStart);
      ctx.lineTo(centerX - streamW / 2, cupLevel);
      ctx.lineTo(centerX + streamW / 2, cupLevel);
      ctx.lineTo(centerX + streamW / 2, streamStart);
      ctx.fill();
    }

    // Cup & Crema
    const cupW = 54;
    const cupH = 30;
    const cupTop = h - cupH - 6;
    const cupL = centerX - cupW / 2;

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cupL, cupTop, cupW, cupH, [2, 2, 8, 8]);
    ctx.fill();
    ctx.stroke();

    if (this.liquidYield > 0) {
      const fillProgress = Math.min(1.0, this.liquidYield / 36.0);
      const fillH = fillProgress * (cupH - 6);
      const liqTop = cupTop + cupH - 3 - fillH;

      ctx.fillStyle = '#1e1008';
      ctx.fillRect(cupL + 3, liqTop, cupW - 6, fillH);

      if (this.cremaRatio > 0.1) {
        const cremaH = Math.min(7, 2 + this.cremaRatio * 5);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(cupL + 3, liqTop, cupW - 6, cremaH);
      }
    }
  }
}
