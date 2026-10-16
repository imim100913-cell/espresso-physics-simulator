/**
 * main.js — Main Application Coordinator & Live Physics Solver
 * Enables:
 * - Instant real-time simulation updates as user drags sliders
 * - Full multi-stage baristas workflow (Grind -> Tamp -> Extract) on start button click
 */

import { UIControls } from './ui/controls.js';
import { ChartEngine } from './ui/charts.js';
import { PuckAnimationEngine } from './ui/animation.js';

class EspressoApp {
  constructor() {
    this.controls = new UIControls();
    this.charts = new ChartEngine();
    this.animation = new PuckAnimationEngine('canvasPuckAnimation');
  }

  init() {
    console.log('[Espresso Physics] Initializing App & Live Physics Solver...');

    this.controls.init();
    this.charts.init();
    this.animation.init();

    this.bindAppEvents();

    // Run initial live calculation
    this.solveLivePhysics(this.controls.params);
  }

  bindAppEvents() {
    // 1. Live parameter update: re-solve instantly on any slider movement!
    this.controls.subscribe((key, val, allParams) => {
      this.solveLivePhysics(allParams);

      // Synchronize pressure profile preset if changed
      if (key === 'pressureProfile' || key === 'maxPressure' || key === 'piDuration') {
        this.charts.pressureEditor.setPreset(
          allParams.pressureProfile,
          allParams.maxPressure,
          allParams.piDuration
        );
        if (this.charts.activeTab === 'graphPressureEditor') {
          this.charts.renderActiveGraph();
        }
      }
    });

    // 2. Big Hero Start Button & Param Bottom Button
    const btnHero = document.getElementById('btnMainStart');
    const btnBottom = document.getElementById('btnStartSimulation');

    const toggleSim = () => {
      if (this.animation.isRunning) {
        this.stopSimulation();
      } else {
        this.startSimulation();
      }
    };

    if (btnHero) btnHero.addEventListener('click', toggleSim);
    if (btnBottom) btnBottom.addEventListener('click', toggleSim);

    // 3. Animation Completed Listener
    window.addEventListener('simulationComplete', () => {
      this.onSimulationFinished();
    });
  }

  // =========================================================================
  // LIVE PHYSICS SOLVER (Instant feedback as sliders move)
  // =========================================================================
  solveLivePhysics(p) {
    // --- A. Bean Physics (Roast & Density & Brittleness) ---
    const normRoast = (95 - p.roastLevel) / 60; // 0: Light -> 1: Dark
    const beanDensity = 1300 * (1 - 0.55 * normRoast); // kg/m3
    const intraPorosity = 0.30 + 0.35 * normRoast;
    const brittleness = 0.3 + 0.7 * Math.pow(normRoast, 1.5);
    const co2Gas = (6 + 12 * normRoast) * Math.exp(-p.beanAge / 10); // mg/g

    // --- B. Grinder Physics (Burr Type & RPM & PSD) ---
    const baseFines = p.burrType.startsWith('flat') ? (p.burrType === 'flat_high' ? 0.08 : 0.12) : 0.22;
    const rpmFactor = 1 + 0.20 * ((p.grinderRPM - 400) / 400);
    const finesRatio = Math.max(0.05, Math.min(0.45, baseFines * (1 + 0.5 * brittleness) * rpmFactor));
    const d32 = Math.round(p.grindSize * (1 - finesRatio * 0.62)); // Sauter mean diameter in microns

    // Update PSD Preview Canvas
    this.charts.renderPSDPreview(p.grindSize, finesRatio);
    const elFines = document.getElementById('metricFinesRatio');
    if (elFines) elFines.textContent = `${(finesRatio * 100).toFixed(1)}%`;
    const elD32 = document.getElementById('metricSauterD32');
    if (elD32) elD32.textContent = `d₃₂: ${d32} µm`;

    // --- C. Puck Geometry & Permeability (Kozeny-Carman) ---
    const diamM = (p.basketDiameter || 58) / 1000;
    const area = (Math.PI * Math.pow(diamM, 2)) / 4;
    const eps0 = 0.50 - 0.12 * (1 - Math.exp(-p.tampForce / 5)); // porosity
    const bedHeightMm = (p.dose * 1e-3 / (beanDensity * (1 - eps0) * area)) * 1000;
    const bedHeightM = bedHeightMm / 1000;

    // Kozeny-Carman Permeability (m2)
    const d32M = d32 * 1e-6;
    const kappa0 = (Math.pow(d32M, 2) * Math.pow(eps0, 3)) / (180 * Math.pow(1 - eps0, 2));

    // Water Viscosity (Pa*s) at temperature
    const tempC = p.waterTemp;
    const tempK = tempC + 273.15;
    const viscosity = 2.414e-5 * Math.pow(10, 247.8 / (tempK - 140));

    // Darcy / Ergun Flow Rate (mL/s)
    const pressPa = p.maxPressure * 1e5;
    const meshFactor = p.basketType === 'precision' ? 1.0 : 0.85;
    const baseFlowRate = Math.max(0.2, Math.min(4.5, ((kappa0 * area * pressPa) / (viscosity * bedHeightM)) * 1e6 * meshFactor));

    // Shot Time Estimate (seconds)
    const estShotTime = Math.max(8, Math.min(60, (p.targetYield / (baseFlowRate * 0.85)) + (p.piDuration || 3.0)));

    // --- D. Extraction Kinetics (TDS & EY) ---
    const brewRatio = p.targetYield / p.dose;
    
    // Ideal surface area contact & temperature extraction rate
    const tempFactor = 1 + (tempC - 93) * 0.02;
    const grindFactor = Math.pow(380 / p.grindSize, 0.45);
    const co2ResistFactor = 1 - Math.min(0.15, co2Gas * 0.02);

    // Extraction Yield (%)
    let ey = 14.0 + 7.5 * (1 - Math.exp(-estShotTime / 14)) * tempFactor * grindFactor * co2ResistFactor;
    
    // Channelling penalty if overly fine or uneven
    const channelingRiskScore = Math.min(95, Math.max(5, 
      (p.grindSize < 260 ? (260 - p.grindSize) * 0.6 : 0) + 
      (p.maxPressure > 9.5 ? (p.maxPressure - 9.5) * 12 : 0) +
      (100 - p.distributionQuality) * 0.4
    ));

    if (channelingRiskScore > 35) {
      ey -= (channelingRiskScore - 35) * 0.08; // Channelling reduces extraction yield & uniformity
    }
    ey = Math.max(12.0, Math.min(26.0, ey));

    // TDS (%) = (EY * Dose) / TargetYield
    const tds = Math.max(4.0, Math.min(16.0, (ey * p.dose) / p.targetYield));

    // --- E. Flavor Profile Breakdown ---
    const waterGHBonus = (p.waterGH - 100) * 0.01;
    const waterKHReduction = (p.waterKH - 50) * 0.015;

    const acidity = Math.max(1, Math.min(10, (10 - normRoast * 6) * (1 - Math.min(0.4, estShotTime / 45)) - waterKHReduction));
    const sweetness = Math.max(1, Math.min(10, 8.5 - Math.abs(ey - 20.0) * 0.7 + waterGHBonus));
    const bitterness = Math.max(1, Math.min(10, 3.0 + normRoast * 4.5 + (tempC - 90) * 0.3 + (estShotTime > 30 ? (estShotTime - 30) * 0.2 : 0)));
    const astringency = Math.max(1, Math.min(10, 2.0 + (channelingRiskScore / 100) * 5 + (ey > 22 ? (ey - 22) * 1.5 : 0)));
    const bodyScore = Math.max(20, Math.min(98, Math.round(tds * 6.5 + normRoast * 20 + (p.maxPressure / 9) * 12)));

    // --- F. SCA Brewing Control Chart Evaluation ---
    let bccTitle = 'IDEAL EXTRACTION (理想域)';
    let bccDesc = '酸味と甘味の調和が取れ、雑味や過度の渋みを抑えた理想的なエスプレッソです。';

    if (ey < 18.0) {
      if (tds > 11.5) {
        bccTitle = 'UNDER-EXTRACTED / STRONG (未抽出・濃厚)';
        bccDesc = '濃度は高いですが抽出不足のため、鋭い酸味や塩味が目立ちます。挽き目を細かくするか抽出量を増やしてください。';
      } else {
        bccTitle = 'UNDER-EXTRACTED (未抽出・酸味過多)';
        bccDesc = '抽出時間が短すぎるか粒度が粗く、甘味やボディが十分に引き出されていません。';
      }
    } else if (ey > 22.0) {
      bccTitle = 'OVER-EXTRACTED (過剰抽出・苦渋味)';
      bccDesc = '抽出が進みすぎて微粒子内部の渋味や不快な苦味成分が溶出しています。挽き目を少し粗くしてください。';
    } else if (tds < 8.0) {
      bccTitle = 'LUNGO / WEAK (抽出良好・薄め)';
      bccDesc = '収率は適正ですが抽出量が多いため軽やかなテイストです。アメリカーノやロングブラックに適しています。';
    }

    // --- G. Generate Synchronized Time-Series Array ---
    const timeSeries = [];
    const dt = 0.1;
    let yieldAcc = 0;
    let solutesAcc = 0;

    for (let t = 0; t <= Math.min(35, estShotTime + 2); t += dt) {
      let curP = p.maxPressure;
      if (t < (p.piDuration || 3)) {
        curP = 2.0;
      } else if (t < (p.piDuration || 3) + 2) {
        curP = 2.0 + (t - (p.piDuration || 3)) * (p.maxPressure - 2.0) / 2;
      }

      let curQ = 0;
      if (t > (p.piDuration || 3) * 0.8) {
        const rampT = t - (p.piDuration || 3) * 0.8;
        curQ = Math.min(baseFlowRate, (rampT / 3.0) * baseFlowRate);
      }

      let curTdsInst = curQ > 0 ? Math.max(1.5, 18.0 * Math.exp(-t / 8.0)) : 0;
      yieldAcc += curQ * dt;
      solutesAcc += curQ * dt * (curTdsInst / 100);

      const curTdsCup = yieldAcc > 0 ? (solutesAcc / yieldAcc) * 100 : 0;
      const curEy = (solutesAcc / p.dose) * 100;

      timeSeries.push({
        t: Math.round(t * 10) / 10,
        p: curP,
        q: curQ,
        tdsInst: curTdsInst,
        tdsCup: curTdsCup,
        ey: curEy,
        yieldAcc,
        epsTop: eps0 - 0.03 * (curP / 9),
        epsMid: eps0 - 0.05 * (curP / 9),
        epsBot: eps0 - 0.08 * (curP / 9)
      });
    }

    // Update Charts with Live Dataset
    this.charts.updateDataset(timeSeries, tds, ey, {
      acidity,
      sweetness,
      bitterness,
      astringency,
      body: bodyScore / 10
    }, {
      title: bccTitle,
      desc: bccDesc
    });

    // --- H. Update DOM Summary Metric Badges & Gauges ---
    const sumEY = document.getElementById('sumEY');
    const sumTDS = document.getElementById('sumTDS');
    const sumTime = document.getElementById('sumTime');
    const sumRatio = document.getElementById('sumRatio');
    const sumOutput = document.getElementById('sumOutputGrams');
    const badgeEY = document.getElementById('badgeEYStatus');
    const badgeTDS = document.getElementById('badgeTDSStatus');

    if (sumEY) sumEY.innerHTML = `${ey.toFixed(1)} <span class="tile-unit">%</span>`;
    if (sumTDS) sumTDS.innerHTML = `${tds.toFixed(1)} <span class="tile-unit">%</span>`;
    if (sumTime) sumTime.innerHTML = `${estShotTime.toFixed(1)} <span class="tile-unit">s</span>`;
    if (sumRatio) sumRatio.textContent = `1:${brewRatio.toFixed(1)}`;
    if (sumOutput) sumOutput.textContent = `${p.targetYield.toFixed(1)} g out`;
    
    if (badgeEY) {
      badgeEY.textContent = (ey >= 18 && ey <= 22) ? 'OPTIMAL (適正)' : (ey < 18 ? 'UNDER' : 'OVER');
      badgeEY.style.color = (ey >= 18 && ey <= 22) ? 'var(--risk-safe)' : 'var(--risk-alert)';
    }

    // Update Gauges
    const fillRisk = document.getElementById('fillChannelRisk');
    const valRisk = document.getElementById('valChannelRisk');
    const hintRisk = document.getElementById('hintChannelRisk');
    if (fillRisk) fillRisk.style.width = `${Math.round(channelingRiskScore)}%`;
    if (valRisk) valRisk.textContent = `${Math.round(channelingRiskScore)}%`;
    if (hintRisk) {
      hintRisk.textContent = channelingRiskScore < 25 ? '均一な浸透状態が予測されます' : (channelingRiskScore < 50 ? '微細な偏流に注意してください' : '⚠️ 局所チャネリングのリスクが高いです');
    }

    const fillBody = document.getElementById('fillBodyScore');
    const valBody = document.getElementById('valBodyScore');
    if (fillBody) fillBody.style.width = `${bodyScore}%`;
    if (valBody) valBody.textContent = `${bodyScore}/100`;

    // Flavor bars
    const barAcid = document.getElementById('barAcidity');
    const valAcid = document.getElementById('valAcidity');
    if (barAcid) barAcid.style.width = `${acidity * 10}%`;
    if (valAcid) valAcid.textContent = acidity.toFixed(1);

    const barSweet = document.getElementById('barSweetness');
    const valSweet = document.getElementById('valSweetness');
    if (barSweet) barSweet.style.width = `${sweetness * 10}%`;
    if (valSweet) valSweet.textContent = sweetness.toFixed(1);

    const barBitter = document.getElementById('barBitterness');
    const valBitter = document.getElementById('valBitterness');
    if (barBitter) barBitter.style.width = `${bitterness * 10}%`;
    if (valBitter) valBitter.textContent = bitterness.toFixed(1);

    const barAstring = document.getElementById('barAstringency');
    const valAstring = document.getElementById('valAstringency');
    if (barAstring) barAstring.style.width = `${astringency * 10}%`;
    if (valAstring) valAstring.textContent = astringency.toFixed(1);
  }

  // =========================================================================
  // ANIMATION PLAYBACK CONTROLS
  // =========================================================================
  startSimulation() {
    const btnHero = document.getElementById('btnMainStart');
    const btnBottom = document.getElementById('btnStartSimulation');
    const statusLight = document.getElementById('simStatusLight');

    [btnHero, btnBottom].forEach(b => {
      if (b) {
        b.classList.add('running');
        const txt = b.querySelector('.hero-text') || b.querySelector('.btn-text');
        if (txt) txt.textContent = 'シミュレーション停止 (中止)';
      }
    });

    if (statusLight) statusLight.className = 'status-indicator running';

    // Start 28-second visual animation sequence
    this.animation.start(28.0);
  }

  stopSimulation() {
    const btnHero = document.getElementById('btnMainStart');
    const btnBottom = document.getElementById('btnStartSimulation');
    const statusLight = document.getElementById('simStatusLight');

    [btnHero, btnBottom].forEach(b => {
      if (b) {
        b.classList.remove('running');
        const txt = b.querySelector('.hero-text') || b.querySelector('.btn-text');
        if (txt) txt.textContent = '豆粉砕 & 抽出シミュレーション開始';
      }
    });

    if (statusLight) statusLight.className = 'status-indicator ready';

    this.animation.stop();
  }

  onSimulationFinished() {
    const btnHero = document.getElementById('btnMainStart');
    const btnBottom = document.getElementById('btnStartSimulation');
    const statusLight = document.getElementById('simStatusLight');

    [btnHero, btnBottom].forEach(b => {
      if (b) {
        b.classList.remove('running');
        const txt = b.querySelector('.hero-text') || b.querySelector('.btn-text');
        if (txt) txt.textContent = '再抽出 (リスタート)';
      }
    });

    if (statusLight) statusLight.className = 'status-indicator ready';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new EspressoApp();
  app.init();
});
