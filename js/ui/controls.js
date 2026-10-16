/**
 * controls.js — UI Controls, Progressive Disclosure & Interactive State
 */

export class UIControls {
  constructor() {
    this.isAdvanced = false;
    this.params = {
      // Beans & Roast
      roastLevel: 65,      // Agtron (35: Dark - 95: Light)
      beanAge: 14,         // Days off roast
      // Grinder & PSD
      grindSize: 380,      // d50 (microns)
      burrType: 'flat_std',
      grinderRPM: 400,
      // Puck & Geometry
      dose: 18.0,          // grams
      targetYield: 36.0,   // grams
      basketDiameter: 58,  // mm
      basketType: 'precision',
      tampForce: 15,       // kgf
      distributionQuality: 95, // %
      // Extraction & Brew
      waterTemp: 93.0,     // deg C
      maxPressure: 9.0,    // bar
      pressureProfile: 'preinfusion',
      piDuration: 4.0,     // s
      waterGH: 100,        // ppm CaCO3
      waterKH: 50          // ppm CaCO3
    };

    this.listeners = [];
  }

  init() {
    this.bindDOM();
    this.bindEvents();
    this.setMode(false); // Default to Basic mode
    this.updateAllDisplays();
  }

  bindDOM() {
    // Mode Switch
    this.modeToggle = document.getElementById('modeToggle');
    this.labelBasic = document.getElementById('labelBasic');
    this.labelAdvanced = document.getElementById('labelAdvanced');

    // Accordion Headers
    this.accordionHeaders = document.querySelectorAll('.section-header');

    // Controls
    this.slRoast = document.getElementById('paramRoastLevel');
    this.slAge = document.getElementById('paramBeanAge');
    this.slGrind = document.getElementById('paramGrindSize');
    this.selBurr = document.getElementById('paramBurrType');
    this.slRPM = document.getElementById('paramGrinderRPM');
    this.slDose = document.getElementById('paramDose');
    this.slYield = document.getElementById('paramTargetYield');
    this.ctrlBasketDiam = document.getElementById('ctrlBasketDiameter');
    this.selBasketType = document.getElementById('paramBasketType');
    this.slTamp = document.getElementById('paramTampForce');
    this.slPrep = document.getElementById('paramDistributionQuality');
    this.slTemp = document.getElementById('paramWaterTemp');
    this.slPress = document.getElementById('paramMaxPressure');
    this.selProfile = document.getElementById('paramProfilePreset');
    this.slPI = document.getElementById('paramPIDuration');
    this.slGH = document.getElementById('paramWaterGH');
    this.slKH = document.getElementById('paramWaterKH');

    // Displays
    this.dispRoast = document.getElementById('valRoastLevel');
    this.badgeRoast = document.getElementById('badgeRoastPreset');
    this.dispAge = document.getElementById('valBeanAge');
    this.dispGrind = document.getElementById('valGrindSize');
    this.dispRPM = document.getElementById('valGrinderRPM');
    this.dispDose = document.getElementById('valDose');
    this.dispYield = document.getElementById('valTargetYield');
    this.badgeRatio = document.getElementById('badgeBrewRatio');
    this.dispTamp = document.getElementById('valTampForce');
    this.dispPrep = document.getElementById('valDistributionQuality');
    this.dispTemp = document.getElementById('valWaterTemp');
    this.dispPress = document.getElementById('valMaxPressure');
    this.dispPI = document.getElementById('valPIDuration');
    this.dispGH = document.getElementById('valWaterGH');
    this.dispKH = document.getElementById('valWaterKH');

    // Modals
    this.modalRecipe = document.getElementById('modalRecipeManager');
    this.btnOpenRecipe = document.getElementById('btnRecipeManager');
    this.btnCloseRecipe = document.getElementById('btnCloseRecipeModal');
  }

  bindEvents() {
    // Mode Switch
    this.modeToggle.addEventListener('change', (e) => {
      this.setMode(e.target.checked);
    });
    this.labelBasic.addEventListener('click', () => {
      this.modeToggle.checked = false;
      this.setMode(false);
    });
    this.labelAdvanced.addEventListener('click', () => {
      this.modeToggle.checked = true;
      this.setMode(true);
    });

    // Accordions
    this.accordionHeaders.forEach(header => {
      header.addEventListener('click', () => {
        header.classList.toggle('active');
      });
    });

    // Sliders & Selects
    const bindSlider = (elem, paramKey, dispElem, fmtFn) => {
      if (!elem) return;
      elem.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.params[paramKey] = val;
        if (dispElem) dispElem.textContent = fmtFn ? fmtFn(val) : val;
        this.onParamChange(paramKey, val);
      });
    };

    bindSlider(this.slRoast, 'roastLevel', this.dispRoast, (v) => v);
    bindSlider(this.slAge, 'beanAge', this.dispAge, (v) => v);
    bindSlider(this.slGrind, 'grindSize', this.dispGrind, (v) => v);
    bindSlider(this.slRPM, 'grinderRPM', this.dispRPM, (v) => v);
    bindSlider(this.slDose, 'dose', this.dispDose, (v) => v.toFixed(1));
    bindSlider(this.slYield, 'targetYield', this.dispYield, (v) => v.toFixed(1));
    bindSlider(this.slTamp, 'tampForce', this.dispTamp, (v) => v);
    bindSlider(this.slPrep, 'distributionQuality', this.dispPrep, (v) => v);
    bindSlider(this.slTemp, 'waterTemp', this.dispTemp, (v) => v.toFixed(1));
    bindSlider(this.slPress, 'maxPressure', this.dispPress, (v) => v.toFixed(1));
    bindSlider(this.slPI, 'piDuration', this.dispPI, (v) => v.toFixed(1));
    bindSlider(this.slGH, 'waterGH', this.dispGH, (v) => v);
    bindSlider(this.slKH, 'waterKH', this.dispKH, (v) => v);

    // Selects
    if (this.selBurr) {
      this.selBurr.addEventListener('change', (e) => {
        this.params.burrType = e.target.value;
        this.onParamChange('burrType', e.target.value);
      });
    }

    if (this.selBasketType) {
      this.selBasketType.addEventListener('change', (e) => {
        this.params.basketType = e.target.value;
        this.onParamChange('basketType', e.target.value);
      });
    }

    if (this.selProfile) {
      this.selProfile.addEventListener('change', (e) => {
        this.params.pressureProfile = e.target.value;
        this.onParamChange('pressureProfile', e.target.value);
      });
    }

    // Basket Diameter Segmented Buttons
    if (this.ctrlBasketDiam) {
      const btns = this.ctrlBasketDiam.querySelectorAll('.segment-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const val = parseInt(btn.getAttribute('data-val'), 10);
          this.params.basketDiameter = val;
          this.onParamChange('basketDiameter', val);
        });
      });
    }

    // Modal Events
    if (this.btnOpenRecipe) {
      this.btnOpenRecipe.addEventListener('click', () => {
        this.modalRecipe.classList.add('open');
      });
    }
    if (this.btnCloseRecipe) {
      this.btnCloseRecipe.addEventListener('click', () => {
        this.modalRecipe.classList.remove('open');
      });
    }
    window.addEventListener('click', (e) => {
      if (e.target === this.modalRecipe) {
        this.modalRecipe.classList.remove('open');
      }
    });

    // Reset button
    const btnReset = document.getElementById('btnResetParams');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.resetDefaults();
      });
    }
  }

  setMode(isAdvanced) {
    this.isAdvanced = isAdvanced;
    if (isAdvanced) {
      document.body.classList.remove('mode-basic');
      document.body.classList.add('mode-advanced');
      this.labelBasic.classList.remove('active');
      this.labelAdvanced.classList.add('active');
    } else {
      document.body.classList.remove('mode-advanced');
      document.body.classList.add('mode-basic');
      this.labelBasic.classList.add('active');
      this.labelAdvanced.classList.remove('active');
    }
  }

  onParamChange(key, value) {
    this.updateCalculatedBadges();
    this.notifyListeners(key, value);
  }

  updateCalculatedBadges() {
    // Roast Preset Label
    if (this.badgeRoast) {
      const ag = this.params.roastLevel;
      let label = 'Medium';
      if (ag >= 85) label = 'Light';
      else if (ag >= 72) label = 'Med-Light';
      else if (ag >= 58) label = 'Medium';
      else if (ag >= 45) label = 'Med-Dark';
      else label = 'Dark';
      this.badgeRoast.textContent = label;
    }

    // Brew Ratio Badge
    if (this.badgeRatio && this.params.dose > 0) {
      const ratio = this.params.targetYield / this.params.dose;
      this.badgeRatio.textContent = `1:${ratio.toFixed(1)}`;
    }

    // Advanced Calculated Labels (Estimate formulas for instant feedback)
    const normRoast = (95 - this.params.roastLevel) / 60; // 0 (light) to 1 (dark)
    const density = Math.round(1300 * (1 - 0.55 * normRoast));
    const intraPorosity = (0.30 + 0.35 * normRoast).toFixed(3);
    const residualCO2 = ((6 + 12 * normRoast) * Math.exp(-this.params.beanAge / 10)).toFixed(2);
    const brittleness = (0.3 + 0.7 * Math.pow(normRoast, 1.5)).toFixed(2);

    const mDensity = document.getElementById('metricBeanDensity');
    if (mDensity) mDensity.textContent = `${density} kg/m³`;

    const mPorosity = document.getElementById('metricIntraPorosity');
    if (mPorosity) mPorosity.textContent = intraPorosity;

    const mCO2 = document.getElementById('metricResidualCO2');
    if (mCO2) mCO2.textContent = `${residualCO2} mg/g`;

    const mBrit = document.getElementById('metricBrittleness');
    if (mBrit) mBrit.textContent = brittleness;

    // Puck geometry calculation
    const diamM = this.params.basketDiameter / 1000;
    const area = (Math.PI * Math.pow(diamM, 2)) / 4;
    const eps0 = 0.50 - 0.12 * (1 - Math.exp(-this.params.tampForce / 5));
    const bedHeightMm = (this.params.dose * 1e-3 / (density * (1 - eps0) * area)) * 1000;
    
    const mHeight = document.getElementById('metricBedHeight');
    if (mHeight) mHeight.textContent = `${bedHeightMm.toFixed(1)} mm`;

    const mPuckEps = document.getElementById('metricInitialPorosity');
    if (mPuckEps) mPuckEps.textContent = eps0.toFixed(3);
  }

  updateAllDisplays() {
    if (this.slRoast) this.slRoast.value = this.params.roastLevel;
    if (this.dispRoast) this.dispRoast.textContent = this.params.roastLevel;

    if (this.slAge) this.slAge.value = this.params.beanAge;
    if (this.dispAge) this.dispAge.textContent = this.params.beanAge;

    if (this.slGrind) this.slGrind.value = this.params.grindSize;
    if (this.dispGrind) this.dispGrind.textContent = this.params.grindSize;

    if (this.slRPM) this.slRPM.value = this.params.grinderRPM;
    if (this.dispRPM) this.dispRPM.textContent = this.params.grinderRPM;

    if (this.slDose) this.slDose.value = this.params.dose;
    if (this.dispDose) this.dispDose.textContent = this.params.dose.toFixed(1);

    if (this.slYield) this.slYield.value = this.params.targetYield;
    if (this.dispYield) this.dispYield.textContent = this.params.targetYield.toFixed(1);

    if (this.slTemp) this.slTemp.value = this.params.waterTemp;
    if (this.dispTemp) this.dispTemp.textContent = this.params.waterTemp.toFixed(1);

    if (this.slPress) this.slPress.value = this.params.maxPressure;
    if (this.dispPress) this.dispPress.textContent = this.params.maxPressure.toFixed(1);

    this.updateCalculatedBadges();
  }

  resetDefaults() {
    this.params = {
      roastLevel: 65,
      beanAge: 14,
      grindSize: 380,
      burrType: 'flat_std',
      grinderRPM: 400,
      dose: 18.0,
      targetYield: 36.0,
      basketDiameter: 58,
      basketType: 'precision',
      tampForce: 15,
      distributionQuality: 95,
      waterTemp: 93.0,
      maxPressure: 9.0,
      pressureProfile: 'preinfusion',
      piDuration: 4.0,
      waterGH: 100,
      waterKH: 50
    };
    this.updateAllDisplays();
    this.notifyListeners('reset', this.params);
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  notifyListeners(key, value) {
    this.listeners.forEach(cb => cb(key, value, this.params));
  }
}
