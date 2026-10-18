/* Guided mobile experience. The model is independent from optional 3D assets. */
(function () {
  "use strict";
  const M = window.BrewModel;
  const $ = (id) => document.getElementById(id);
  const text = (id, value) => {
    $(id).textContent = value;
  };
  const fmt = (n, d = 1) => n.toFixed(d);
  const roastName = (n) =>
    n >= 85
      ? "浅煎り"
      : n >= 72
        ? "中浅煎り"
        : n >= 58
          ? "中煎り"
          : n >= 45
            ? "中深煎り"
            : "深煎り";
  const controls = {
    roastLevel: "RoastLevel",
    beanAge: "BeanAge",
    grindSize: "GrindSize",
    grinderRPM: "GrinderRPM",
    dose: "Dose",
    targetYield: "TargetYield",
    tampForce: "TampForce",
    waterTemp: "WaterTemp",
    maxPressure: "MaxPressure",
    waterGH: "WaterGH",
    burrType: "BurrType",
    pressureProfile: "ProfilePreset",
  };
  const burrNames = {
    flat_high: "フラット / 高均一",
    flat_std: "フラット / 標準",
    conical_std: "コニカル / 標準",
    conical_trad: "コニカル / 伝統型",
  };
  const state = {
    step: "setup",
    params: { ...M.defaults },
    shot: null,
    lastShot: null,
    previous: null,
    elapsed: 0,
    paused: false,
    raf: 0,
    recipeName: "バランス",
    scene: null,
    sceneLoading: false,
    generation: 0,
    gpu: null,
    gpuPending: false,
    gpuSample: null,
  };
  let toastTimer;
  function notify(message) {
    text("toast", message);
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
  }
  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      notify(
        "端末に保存できませんでした。ブラウザの保存設定をご確認ください。",
      );
      return false;
    }
  }
  function records() {
    const data = read("espressoLabRecipes", []);
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r &&
              typeof r.name === "string" &&
              typeof r.id === "string" &&
              r.params &&
              typeof r.params === "object",
          )
          .slice(0, 30)
      : [];
  }
  function setStep(step) {
    state.step = step;
    document.body.dataset.step = step;
    for (const name of ["setup", "brew", "result"])
      $(name + "Screen").hidden = name !== step;
    document.querySelectorAll("[data-go]").forEach((b) => {
      const name = b.dataset.go;
      b.disabled =
        name === "brew"
          ? state.shot === null || state.finished
          : name === "result"
            ? !state.finished
            : step === "brew";
      if (name === step) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    $("btnRecipeManager").disabled = step === "brew";
    updateDock();
    window.scrollTo({ top: 0, behavior: "instant" });
    $(
      step === "setup"
        ? "setupTitle"
        : step === "brew"
          ? "brewTitle"
          : "resultTitle",
    ).focus({ preventScroll: true });
  }
  function updateDock() {
    if (state.step === "setup") {
      text("dockEyebrow", "READY TO BREW");
      text("dockDescription", state.recipeName + "のレシピで準備OK");
      text("primaryLabel", "このレシピで抽出する");
      text("primaryIcon", "→");
    } else if (state.step === "brew") {
      text("dockEyebrow", state.paused ? "PAUSED" : "BREWING");
      text(
        "dockDescription",
        state.paused
          ? "同じところから再開できます"
          : "目標量に達すると自動で結果へ",
      );
      text(
        "primaryLabel",
        state.paused ? "抽出を再開する" : "抽出を一時停止する",
      );
      text("primaryIcon", state.paused ? "▶" : "Ⅱ");
    } else {
      text("dockEyebrow", "KEEP EXPLORING");
      text("dockDescription", "今の設定をもとに次の一杯へ");
      text("primaryLabel", "レシピを調整する");
      text("primaryIcon", "↗");
    }
  }
  function syncParams() {
    for (const [key, suffix] of Object.entries(controls)) {
      const el = $("param" + suffix);
      if (el) el.value = state.params[key];
      const display = $("val" + suffix);
      if (display)
        display.textContent =
          typeof state.params[key] === "number"
            ? fmt(
                state.params[key],
                ["dose", "targetYield", "waterTemp", "maxPressure"].includes(
                  key,
                )
                  ? 1
                  : 0,
              )
            : state.params[key];
    }
    document.querySelectorAll("[data-preset]").forEach((b) => {
      const selected = Object.entries(M.presets[b.dataset.preset]).every(
        ([k, v]) => state.params[k] === v,
      );
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
    document
      .querySelectorAll("#ctrlBasketDiameter .segment-btn")
      .forEach((b) =>
        b.classList.toggle(
          "active",
          +b.dataset.val === state.params.basketDiameter,
        ),
      );
    const estimate = M.simulate(state.params);
    text("badgeRoastPreset", roastName(state.params.roastLevel));
    text(
      "badgeBrewRatio",
      "1:" + fmt(state.params.targetYield / state.params.dose),
    );
    text("recipeName", state.recipeName + "のレシピ");
    text(
      "recipeSummary",
      `粉 ${fmt(state.params.dose)} g → ${fmt(state.params.targetYield)} g の一杯`,
    );
    text(
      "estimateTime",
      estimate.complete ? `${fmt(estimate.duration, 0)} 秒` : "120 秒以上",
    );
    text("metricFinesRatio", fmt(estimate.fines * 100) + "%");
    text(
      "metricSauterD32",
      `d₃₂: ${fmt(state.params.grindSize * (1 - estimate.fines * 0.62), 0)} µm`,
    );
    const norm = (95 - state.params.roastLevel) / 60,
      density = 1300 * (1 - 0.55 * norm),
      eps = 0.5 - 0.12 * (1 - Math.exp(-state.params.tampForce / 5));
    text("metricBeanDensity", fmt(density, 0) + " kg/m³");
    text("metricIntraPorosity", fmt(0.3 + 0.35 * norm, 3));
    text(
      "metricResidualCO2",
      fmt((6 + 12 * norm) * Math.exp(-state.params.beanAge / 10), 2) + " mg/g",
    );
    text(
      "metricBedHeight",
      fmt(
        ((state.params.dose * 0.001) /
          ((density *
            (1 - eps) *
            Math.PI *
            (state.params.basketDiameter / 1000) ** 2) /
            4)) *
          1000,
      ) + " mm",
    );
    text("metricInitialPorosity", fmt(eps, 3));
    $("customEditor").hidden = state.params.pressureProfile !== "custom";
    renderCustomInputs();
    if (charts.canvases.canvasPSDPreview)
      charts.renderPSDPreview(state.params.grindSize, estimate.fines);
    updateDock();
  }
  function releaseGpu() {
    state.generation++;
    state.gpu?.dispose();
    state.gpu = null;
    state.gpuPending = false;
    state.gpuSample = null;
  }
  function changeParams(params, name) {
    releaseGpu();
    state.params = M.normalize(params);
    state.recipeName = name;
    state.finished = false;
    state.shot = null;
    setStep("setup");
    syncParams();
  }
  function renderCustomInputs() {
    if (state.params.pressureProfile !== "custom") return;
    if (!state.params.customPoints)
      state.params.customPoints = [
        { t: 0, p: 2 },
        { t: 4, p: 2 },
        { t: 6, p: state.params.maxPressure },
        { t: 35, p: state.params.maxPressure },
      ];
    const container = $("customPointInputs");
    container.replaceChildren();
    state.params.customPoints.forEach((pt, i) => {
      const row = document.createElement("div");
      row.className = "custom-point";
      for (const [key, label, max] of [
        ["t", "秒", 120],
        ["p", "bar", state.params.maxPressure],
      ]) {
        const wrap = document.createElement("label");
        wrap.textContent = `${i + 1}: ${label} `;
        const input = document.createElement("input");
        input.type = "number";
        input.min = 0;
        input.max = max;
        input.step = 0.5;
        input.value = pt[key];
        input.required = true;
        input.setAttribute("aria-label", `制御点${i + 1}の${label}`);
        if (key === "t" && i === 0) input.readOnly = true;
        input.addEventListener("change", () => {
          if (!input.checkValidity()) {
            input.reportValidity();
            input.value = pt[key];
            return;
          }
          pt[key] = +input.value;
          state.params = M.normalize(state.params);
          state.recipeName = "カスタム";
          syncParams();
        });
        wrap.append(input);
        row.append(wrap);
      }
      container.append(row);
    });
  }
  const charts = new window.EspressoVisuals.ChartEngine();
  charts.init();
  const renderCharts = () => {
    charts.setupCanvases();
    if (state.finished && state.shot)
      charts.updateDataset(
        state.shot.samples,
        state.shot.tds,
        state.shot.ey,
        state.shot.flavor,
        {
          title:
            state.shot.source === "gpu"
              ? "GPU計算から得た値"
              : "簡易モデルの推定値",
          desc: "収率18〜22%・濃度8〜12%を参考域として表示。豆や好みにより適する範囲は異なります。",
        },
      );
    charts.renderPSDPreview(
      state.params.grindSize,
      M.simulate(state.params).fines,
    );
  };
  $("analyticsDetails").addEventListener("toggle", () => {
    if ($("analyticsDetails").open) requestAnimationFrame(renderCharts);
  });
  document.querySelectorAll(".section-header").forEach((b) =>
    b.addEventListener("click", () => {
      const open = b.classList.toggle("active");
      b.setAttribute("aria-expanded", String(open));
      if (open) requestAnimationFrame(renderCharts);
    }),
  );
  for (const [key, suffix] of Object.entries(controls)) {
    $("param" + suffix)?.addEventListener(
      ["burrType", "pressureProfile"].includes(key) ? "change" : "input",
      (e) => {
        state.params = M.normalize({
          ...state.params,
          [key]: e.target.type === "range" ? +e.target.value : e.target.value,
        });
        state.recipeName = "自分だけ";
        state.finished = false;
        state.shot = null;
        syncParams();
      },
    );
  }
  document.querySelectorAll("#ctrlBasketDiameter .segment-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.params.basketDiameter = +b.dataset.val;
      state.recipeName = "自分だけ";
      syncParams();
    }),
  );
  document.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      state.params = { ...M.presets[b.dataset.preset] };
      state.recipeName = b.querySelector("strong").textContent;
      syncParams();
      notify(state.recipeName + "のレシピを選びました");
    }),
  );
  $("btnResetParams").addEventListener("click", () => {
    state.params = { ...M.defaults };
    state.recipeName = "バランス";
    syncParams();
    notify("おすすめのレシピに戻しました");
  });
  $("modeToggle").addEventListener("change", (e) => {
    document.body.classList.toggle("mode-basic", !e.target.checked);
    requestAnimationFrame(renderCharts);
  });
  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.go === "setup" && state.finished)
        changeParams(state.shot.params, "自分だけ");
      else setStep(b.dataset.go);
    }),
  );

  text(
    "physicsAvailability",
    navigator.gpu
      ? "WebGPU APIを検出しました。抽出開始時にGPUの利用可否を確認します。"
      : "このブラウザでは簡易モデルを利用します。",
  );
  $("physicsBackend").addEventListener("change", () =>
    text(
      "physicsModeSummary",
      $("physicsBackend").selectedOptions[0].textContent,
    ),
  );
  async function ensureScene() {
    if (
      state.scene ||
      state.sceneLoading ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    state.sceneLoading = true;
    try {
      const { EspressoScene } = await import("./renderer.bundle.js?v=4.2.0");
      state.scene = new EspressoScene("viewport3DContainer");
      state.scene.setQuality($("renderQuality").value);
      $("renderQuality").value = state.scene.quality;
      state.scene.setCutaway(
        $("btnCutaway").getAttribute("aria-pressed") === "true",
      );
      $("visualFallback").hidden = true;
      $("cameraHint").hidden = false;
      state.scene.renderer.domElement.setAttribute(
        "aria-label",
        "豆の粉砕・タンピング・抽出の3Dアニメーション",
      );
      state.scene.renderer.domElement.setAttribute("role", "img");
      state.scene.renderer.domElement.addEventListener(
        "webglcontextlost",
        (e) => {
          e.preventDefault();
          state.scene?.dispose();
          state.scene = null;
          $("visualFallback").hidden = false;
          $("cameraHint").hidden = true;
        },
      );
      if (state.step === "brew") {
        state.scene.updateConfig({
          ...state.shot.params,
          rpm: state.shot.params.grinderRPM,
        });
        state.scene.start(state.shot.duration + 7.5);
      }
    } catch {
      state.scene?.dispose();
      state.scene = null;
      $("visualFallback").hidden = false;
      $("cameraHint").hidden = true;
      $("viewport3DContainer").querySelector("canvas")?.remove();
    } finally {
      state.sceneLoading = false;
    }
  }
  $("btnCutaway").addEventListener("click", () => {
    const enabled = $("btnCutaway").getAttribute("aria-pressed") !== "true";
    $("btnCutaway").setAttribute("aria-pressed", String(enabled));
    state.scene?.setCutaway(enabled);
  });
  $("renderQuality").addEventListener("change", (e) => {
    state.scene?.setQuality(e.target.value);
    if (state.scene && state.scene.quality !== e.target.value) {
      e.target.value = state.scene.quality;
      notify("この端末で使える標準画質に切り替えました");
    }
  });
  document.querySelectorAll("[data-camera]").forEach((button) =>
    button.addEventListener("click", () => {
      state.scene?.setView(button.dataset.camera);
      document
        .querySelectorAll("[data-camera]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    }),
  );
  async function startBrew() {
    releaseGpu();
    const generation = state.generation;
    state.shot = M.simulate(state.params);
    state.finished = false;
    state.paused = false;
    state.elapsed = 0;
    state.previous = state.lastShot;
    state.rating = 0;
    state.shotId =
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    $("analyticsDetails").open = false;
    setStep("brew");
    text("yieldTarget", `目標 ${fmt(state.shot.params.targetYield)} g`);
    state.gpuPending =
      $("physicsBackend").value !== "simple" && !!navigator.gpu;
    state.gpuSample = null;
    $("gpuDiagnostics").hidden = true;
    $("btnSkipBrew").disabled = state.gpuPending;
    text(
      "backendStatus",
      state.gpuPending
        ? "GPUの計算を準備しています…"
        : "簡易モデルで抽出を予測しています",
    );
    text("btnSkipBrew", "アニメを省略して結果へ →");
    renderPlayback();
    if (state.gpuPending) {
      text("phasePill", "物理計算を準備");
      text("remainingTime", "初回は準備に時間がかかります");
    }
    if (state.scene) {
      state.scene.onResize();
      state.scene.updateConfig({
        ...state.shot.params,
        rpm: state.shot.params.grinderRPM,
      });
      state.scene.start(state.shot.duration + 7.5);
    }
    if (state.gpuPending) {
      try {
        await ensureScene();
        if (generation !== state.generation) return;
        const particleCount =
          $("physicsParticles").value === "auto"
            ? matchMedia("(max-width:700px)").matches
              ? 32768
              : 100000
            : +$("physicsParticles").value;
        const session = await window.GpuBrewSession.create({
          recipe: state.shot.params,
          particleCount,
          scene: state.scene,
          onNotice: notify,
          onUpdate: ({ diagnostics: d, sample, elapsed, draining }) => {
            if (generation !== state.generation) return;
            state.gpuSample = sample;
            state.elapsed = elapsed;
            renderPlayback(0.02);
            text(
              "remainingTime",
              draining
                ? "流出した液体をカップへ集めています"
                : `計算時間 ${fmt(d.hydraulicSeconds)} 秒`,
            );
            text(
              "backendStatus",
              `GPU物理 · ${d.particleCount.toLocaleString()} 粒子 · ${fmt(d.gpuBatchWallMilliseconds ?? 0, 0)} ms / バッチ`,
            );
            fillDL("gpuDiagnosticValues", [
              ["水の流入", fmt(d.waterInKg * 1000, 3) + " g"],
              ["液体の流出", fmt(d.outletSolutionKg * 1000, 3) + " g"],
              ["粉の残量", fmt(d.dryMassKg * 1000, 3) + " g"],
              ["粉の平均高さ", fmt(d.meanHeightMeters * 1000, 2) + " mm"],
              ["水の保存誤差", (d.waterErrorKg * 1000).toExponential(2) + " g"],
              [
                "成分の保存誤差",
                (d.coffeeErrorKg * 1000).toExponential(2) + " g",
              ],
              [
                "液体の保存誤差",
                (d.liquidErrorKg * 1000).toExponential(2) + " g",
              ],
              ["非有限値", String(d.nanCount)],
            ]);
          },
          onComplete: (shot) => {
            if (generation !== state.generation) return;
            state.shot = shot;
            finishBrew();
          },
          onError: (error) => {
            if (generation !== state.generation) return;
            notify(error.message);
            text(
              "backendStatus",
              error.message + " 設定に戻って、簡易モデルで再試行できます。",
            );
            state.paused = true;
            state.gpu?.dispose();
            $("btnSkipBrew").disabled = true;
            $("btnPrimary").disabled = true;
            updateDock();
          },
        });
        if (generation !== state.generation) {
          session.dispose();
          return;
        }
        state.gpu = session;
        state.gpuPending = false;
        $("gpuDiagnostics").hidden = false;
        text("gpuParticleLabel", particleCount.toLocaleString() + " 粒子");
        text("btnSkipBrew", "ここまでの計算で結果を見る →");
        $("btnSkipBrew").disabled = false;
        session.paused = state.paused;
        session.start();
        return;
      } catch (error) {
        if (generation !== state.generation) return;
        state.gpuPending = false;
        notify("GPU計算を開始できなかったため、簡易モデルに切り替えました。");
        text("backendStatus", "簡易モデルで実行中 · " + error.message);
        $("btnSkipBrew").disabled = false;
      }
    } else {
      if ($("physicsBackend").value === "gpu")
        notify("この端末はWebGPU非対応のため、簡易モデルで実行します");
      ensureScene();
    }
    state.tickAt = performance.now();
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - state.tickAt) / 1000));
    state.tickAt = now;
    if (state.step !== "brew" || state.finished) return;
    if (!state.paused && !document.hidden) {
      state.elapsed = Math.min(state.elapsed + dt, state.shot.duration + 7.5);
      renderPlayback(dt);
    }
    if (state.elapsed >= state.shot.duration + 7.5) {
      finishBrew();
      return;
    }
    state.raf = requestAnimationFrame(tick);
  }
  function renderPlayback(dt = 0) {
    const elapsed = state.elapsed,
      shot = state.shot,
      extractT = Math.max(0, elapsed - 7.5),
      sample = state.gpuSample ?? M.sampleAt(shot, extractT);
    const stage = elapsed < 4.5 ? 0 : elapsed < 7.5 ? 1 : 2;
    const phase = ["豆を挽く", "粉を詰める", "お湯を通す"][stage];
    const tips = [
      [
        "最初は、準備の時間。",
        "豆を挽いて粉を詰めたら抽出へ。目標量に達すると自動で終了し、一杯のレポートが開きます。",
      ],
      [
        "均一な粉のベッドをつくる。",
        "粉を水平に詰める工程をタンピングといいます。お湯が偏らず、全体を通るための準備です。",
      ],
      [
        "少しずつ、味がカップに。",
        "最初は濃い成分が出て、後半ほどカップ全体の濃度が薄くなる傾向をモデルで表しています。終了後に数値を振り返りましょう。",
      ],
    ];
    text("phasePill", state.paused ? "一時停止中" : phase);
    text("livePhaseLabel", state.paused ? "一時停止中" : phase + "しています");
    text("brewDescription", tips[stage][1]);
    text("learningTitle", tips[stage][0]);
    text("learningText", tips[stage][1]);
    text(
      "remainingTime",
      state.paused
        ? "再開を待っています"
        : `あと約 ${Math.ceil(shot.duration + 7.5 - elapsed)} 秒`,
    );
    text("simTimerDisplay", fmt(elapsed) + " s");
    text("liveShotTime", fmt(extractT) + " s");
    text("liveYield", fmt(sample.yield) + " g");
    text("livePressure", fmt(stage === 2 ? sample.p : 0) + " bar");
    text("liveFlowRate", fmt(stage === 2 ? sample.q : 0, 2) + " g/s");
    const progress = state.gpu
      ? Math.min(
          99,
          Math.min(15, (elapsed / 7.5) * 15) +
            (sample.yield / shot.params.targetYield) * 84,
        )
      : (elapsed / (shot.duration + 7.5)) * 100;
    $("brewProgressFill").style.width = progress + "%";
    document
      .querySelector(".brew-progress")
      .setAttribute("aria-valuenow", String(Math.round(progress)));
    ["Grind", "Tamp", "Extract", "Done"].forEach((id, i) => {
      $("phase" + id).classList.toggle("active", stage === i);
      $("phase" + id).classList.toggle("done", i < stage);
    });
    if (state.scene && dt > 0 && !state.paused) {
      state.scene.currentTime = elapsed;
      state.scene.config.sample = sample;
      state.scene.step3DPhysics(dt);
    }
  }
  function finishBrew() {
    if (state.finished) return;
    cancelAnimationFrame(state.raf);
    state.finished = true;
    state.elapsed = state.shot.duration + 7.5;
    state.scene?.stop();
    renderReport();
    state.lastShot = state.shot;
    setStep("result");
  }
  function fillDL(id, rows) {
    const root = $(id);
    root.replaceChildren();
    for (const [label, value] of rows) {
      const wrap = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      wrap.append(dt, dd);
      root.append(wrap);
    }
  }
  function renderReport() {
    const s = state.shot,
      p = s.params;
    text(
      "completionTag",
      s.complete ? "✓ 抽出完了" : (s.stopReason ?? "120秒で抽出を終了"),
    );
    text(
      "resultSource",
      s.source === "gpu"
        ? `WebGPUで計算した液量・溶質量からTDSと収率を算出。${s.diagnostics.particleCount.toLocaleString()}粒子。味・点数は参考予測です。物性値は未校正です。`
        : "味・点数は簡易モデルによる予測です。実際の味や品質を保証する評価ではありません。",
    );
    text(
      "resultTitle",
      s.complete
        ? "あなたの一杯が、できました。"
        : "目標量まで、あと少しでした。",
    );
    text("shotScore", s.score);
    text("tasteTitle", s.title);
    text("tasteDescription", s.description);
    const tags = $("tasteTags");
    tags.replaceChildren();
    for (const label of [
      `酸味 ${fmt(s.flavor.acidity)} / 10`,
      `甘味 ${fmt(s.flavor.sweetness)} / 10`,
      `苦味 ${fmt(s.flavor.bitterness)} / 10`,
      `抽出ムラの目安 ${fmt(s.risk, 0)}%`,
    ]) {
      const span = document.createElement("span");
      span.textContent = label;
      tags.append(span);
    }
    text("resultYield", fmt(s.output) + " g");
    text(
      "resultRatio",
      "粉 " + fmt(p.dose) + " g · 1:" + fmt(s.output / p.dose),
    );
    text("resultTime", fmt(s.duration) + " s");
    text(
      "resultTimeNote",
      s.source === "gpu" ? "通水＋落下液の回収時間" : "お湯を通した時間",
    );
    text("resultTDS", fmt(s.tds) + " %");
    text("resultEY", fmt(s.ey) + " %");
    const breakdown = $("scoreBreakdown");
    breakdown.replaceChildren();
    for (const item of s.breakdown) {
      const div = document.createElement("div");
      div.className = "breakdown-row";
      const label = document.createElement("span"),
        value = document.createElement("strong");
      label.textContent = item.label;
      value.textContent = `${item.value} / ${item.max}`;
      div.append(label, value);
      breakdown.append(div);
    }
    if (!s.complete) {
      const note = document.createElement("p");
      note.className = "small-note";
      note.textContent =
        "目標量に届かなかったため、合計点に40点の上限を適用しています。";
      breakdown.append(note);
    }
    fillDL("recipeSnapshot", [
      ["焙煎度", `${roastName(p.roastLevel)} / ${p.roastLevel}`],
      ["挽き目", p.grindSize + " µm"],
      ["粉量", fmt(p.dose) + " g"],
      ["目標の抽出量", fmt(p.targetYield) + " g"],
      ["お湯の温度", fmt(p.waterTemp) + " ℃"],
      ["最大設定圧力", fmt(p.maxPressure) + " bar"],
    ]);
    const advanced = [
      ["圧力のかけ方", M.profiles[p.pressureProfile]],
      ["焙煎からの日数", p.beanAge + " 日"],
      ["グラインダー", burrNames[p.burrType]],
      ["回転数", p.grinderRPM + " rpm"],
      ["バスケット", p.basketDiameter + " mm"],
      ["タンピング", p.tampForce + " kgf"],
      ["水の総硬度", p.waterGH + " ppm"],
    ];
    if (p.pressureProfile === "custom")
      advanced.push([
        "カスタム制御点",
        p.customPoints.map((pt) => `${pt.t}s: ${pt.p}bar`).join(" / "),
      ]);
    fillDL("advancedSnapshot", advanced);
    fillDL("flavorValues", [
      ["酸味", fmt(s.flavor.acidity)],
      ["甘味", fmt(s.flavor.sweetness)],
      ["苦味", fmt(s.flavor.bitterness)],
      ["渋味", fmt(s.flavor.astringency)],
      ["ボディ", fmt(s.flavor.body)],
    ]);
    const timeline = $("shotTimeline");
    timeline.replaceChildren();
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const sample = M.sampleAt(s, s.duration * f),
        row = document.createElement("tr");
      for (const value of [
        fmt(sample.t) + " s",
        fmt(sample.p),
        fmt(sample.yield),
        fmt(sample.tdsCup),
        fmt(sample.ey),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      timeline.append(row);
    }
    text("nextChangeTitle", s.next.label);
    text("nextChangeReason", s.next.reason);
    const previous = state.previous;
    $("lastComparison").hidden = !previous;
    if (previous) {
      const diff = s.score - previous.score;
      text(
        "lastComparison",
        `前の一杯と比較：参考点 ${previous.score} → ${s.score} (${diff > 0 ? "+" : ""}${diff}) · 抽出時間 ${fmt(previous.duration)} → ${fmt(s.duration)} 秒。好みに近づいたか、味の予測も見比べてみましょう。`,
      );
    }
    renderRating();
  }
  $("btnPrimary").addEventListener("click", () => {
    if (state.step === "setup") startBrew();
    else if (state.step === "result")
      changeParams(state.shot.params, "自分だけ");
    else {
      state.paused = !state.paused;
      if (state.gpu) state.gpu.paused = state.paused;
      state.tickAt = performance.now();
      updateDock();
      renderPlayback();
    }
  });
  $("btnCancelBrew").addEventListener("click", () => {
    releaseGpu();
    $("btnPrimary").disabled = false;
    cancelAnimationFrame(state.raf);
    state.scene?.stop();
    state.shot = null;
    state.finished = false;
    setStep("setup");
  });
  $("btnSkipBrew").addEventListener("click", () => {
    if (state.gpu) {
      state.gpu.finishEarly();
      state.paused = false;
      $("btnSkipBrew").disabled = true;
      text("backendStatus", "ポンプを止めて、流出済みの液体を集めています");
      updateDock();
    } else if (!state.gpuPending) finishBrew();
  });
  $("btnApplySuggestion").addEventListener("click", () => {
    const s = state.shot;
    changeParams({ ...s.params, [s.next.key]: s.next.value }, "次の実験");
    notify(s.next.label + "設定にしました。抽出して比べてみましょう。");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.step === "brew" && !state.paused) {
      state.paused = true;
      if (state.gpu) state.gpu.paused = true;
      updateDock();
      renderPlayback();
    }
  });
  function renderRating() {
    document.querySelectorAll("[data-rating]").forEach((b) => {
      const selected = +b.dataset.rating <= state.rating;
      b.textContent = selected ? "★" : "☆";
      b.setAttribute(
        "aria-pressed",
        String(+b.dataset.rating === state.rating),
      );
    });
    text(
      "ratingStatus",
      state.rating
        ? `期待度 ${state.rating} / 5${state.ratingSaved ? " をこの端末に保存しました" : "（保存できませんでした）"}`
        : "まだ評価していません",
    );
  }
  document.querySelectorAll("[data-rating]").forEach((b) =>
    b.addEventListener("click", () => {
      state.rating = +b.dataset.rating;
      let ratings = read("espressoLabRatings", []);
      if (!Array.isArray(ratings)) ratings = [];
      state.ratingSaved = write("espressoLabRatings", [
        ...ratings.filter((r) => r?.id !== state.shotId).slice(-19),
        {
          id: state.shotId,
          rating: state.rating,
          params: state.shot.params,
          score: state.shot.score,
        },
      ]);
      renderRating();
    }),
  );

  const modal = $("modalRecipeManager");
  function renderRecipes() {
    const list = $("savedRecipeList");
    list.replaceChildren();
    const saved = records();
    if (!saved.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        "まだレシピがありません。最初の一杯を保存してみましょう。";
      list.append(empty);
      return;
    }
    for (const recipe of saved) {
      const row = document.createElement("div"),
        info = document.createElement("div"),
        name = document.createElement("strong"),
        sub = document.createElement("p"),
        load = document.createElement("button"),
        del = document.createElement("button");
      row.className = "saved-recipe";
      name.textContent = recipe.name;
      const p = M.normalize(recipe.params);
      sub.textContent = `${roastName(p.roastLevel)} · ${fmt(p.dose)} g → ${fmt(p.targetYield)} g`;
      info.append(name, sub);
      load.className = "text-button";
      load.textContent = "使う";
      load.setAttribute("aria-label", recipe.name + "を使う");
      load.addEventListener("click", () => {
        changeParams(p, recipe.name);
        modal.close();
        notify("保存したレシピを読み込みました");
      });
      del.className = "icon-button";
      del.textContent = "×";
      del.setAttribute("aria-label", recipe.name + "を削除");
      del.addEventListener("click", () => {
        if (
          write(
            "espressoLabRecipes",
            records().filter((r) => r.id !== recipe.id),
          )
        )
          renderRecipes();
      });
      row.append(info, load, del);
      list.append(row);
    }
  }
  $("btnRecipeManager").addEventListener("click", () => {
    renderRecipes();
    $("inputRecipeName").value = state.recipeName;
    modal.showModal();
  });
  $("btnCloseRecipeModal").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => {
    const r = modal.getBoundingClientRect();
    if (
      e.target === modal &&
      (e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom)
    )
      modal.close();
  });
  $("recipeSaveForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("inputRecipeName").value.trim();
    if (!name) {
      $("inputRecipeName").value = "";
      $("inputRecipeName").reportValidity();
      return;
    }
    const recipe = {
      id: Date.now().toString(36),
      name,
      params: state.step === "result" ? state.shot.params : state.params,
    };
    if (write("espressoLabRecipes", [recipe, ...records()].slice(0, 30))) {
      renderRecipes();
      notify("レシピをこの端末に保存しました");
    }
  });
  $("btnShareRecipe").addEventListener("click", async () => {
    const url = new URL(location.href);
    url.hash =
      "recipe=" + encodeURIComponent(JSON.stringify(state.shot.params));
    try {
      await navigator.clipboard.writeText(url.href);
      notify("この一杯のレシピURLをコピーしました");
    } catch {
      window.prompt("このレシピのURLをコピーしてください", url.href);
    }
  });
  function restoreURL() {
    if (!location.hash.startsWith("#recipe=")) return;
    try {
      if (location.hash.length > 8000) throw new Error("too long");
      const data = JSON.parse(decodeURIComponent(location.hash.slice(8)));
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("invalid");
      state.params = M.normalize(data);
      state.recipeName = "共有された";
      notify("共有されたレシピを読み込みました。抽出してみましょう。");
    } catch {
      notify("レシピURLを読み込めなかったため、おすすめの設定で開きました。");
    }
  }
  restoreURL();
  syncParams();
})();
