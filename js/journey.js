/* Guided mobile experience. The model is independent from optional 3D assets. */
(function () {
  "use strict";
  const M = window.BrewModel;
  const R = window.BrewRuntime;
  const W = window.BrewWorkflow;
  const PREPARATION = W.preparationSeconds;
  const mobile = R.isMobile();
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
    gpuStartupController: null,
    visualDisabled: true,
  };
  const savedArtwork = read(
    "espressoLabArtwork",
    navigator.connection?.saveData ? "diagram" : "photo",
  );
  $("illustrationStyle").value =
    savedArtwork === "diagram" ? "diagram" : "photo";
  const illustration = new window.BrewIllustration($("brewIllustration"), {
    style: $("illustrationStyle").value,
  });
  $("illustrationStyle").addEventListener("change", (event) => {
    illustration.setStyle(event.target.value);
    write("espressoLabArtwork", event.target.value);
  });
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
    state.gpuStartupController?.abort();
    state.gpuStartupController = null;
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
    mobile
      ? "スマホの自動設定は軽量計算です。GPU物理は手動で選択できます。"
      : navigator.gpu
        ? "GPUを利用できない場合は、軽量計算に切り替わります。"
        : "このブラウザでは簡易モデルを利用します。",
  );
  $("physicsBackend").addEventListener("change", () =>
    text(
      "physicsModeSummary",
      $("physicsBackend").selectedOptions[0].textContent,
    ),
  );
  if (mobile) {
    $("renderQuality").value = "low";
    text("physicsModeSummary", "スマホ向けの軽量計算");
  }
  function syncVisualControls() {
    $("btnToggle3D").setAttribute(
      "aria-pressed",
      String(!state.visualDisabled),
    );
    text("btnToggle3D", state.visualDisabled ? "3Dを表示" : "3Dをオフ");
    $("renderQuality").disabled = state.visualDisabled;
    $("btnCutaway").disabled = state.visualDisabled;
    document
      .querySelectorAll("[data-camera]")
      .forEach((b) => (b.disabled = state.visualDisabled));
  }
  syncVisualControls();
  function syncScenePresentation() {
    const extracting =
      state.step === "brew" && W.at(state.elapsed).id === "extract";
    const scene = state.scene;
    const ready =
      extracting && scene?.hasRenderedFrame && !state.visualDisabled;
    $("visualFallback").hidden = !!ready;
    $("cameraHint").hidden = !ready;
    $("renderNote").hidden = extracting;
    if (scene) scene.renderer.domElement.hidden = !extracting;
  }
  function disableScene() {
    state.visualDisabled = true;
    state.scene?.dispose();
    state.scene = null;
    $("visualFallback").hidden = false;
    $("cameraHint").hidden = true;
    syncVisualControls();
  }
  $("btnToggle3D").addEventListener("click", () => {
    if (!state.visualDisabled) disableScene();
    else {
      state.visualDisabled = false;
      syncVisualControls();
      ensureScene();
    }
  });
  async function ensureScene() {
    // Preparation uses the same focused scenes on every device. Load 3D at the machine.
    if (
      state.scene ||
      state.sceneLoading ||
      state.visualDisabled ||
      W.at(state.elapsed).id !== "extract"
    )
      return;
    state.sceneLoading = true;
    try {
      const { EspressoScene } = await import("./renderer.bundle.js?v=4.4.0");
      if (
        state.visualDisabled ||
        state.step !== "brew" ||
        W.at(state.elapsed).id !== "extract"
      )
        return;
      state.scene = new EspressoScene("viewport3DContainer", {
        quality: $("renderQuality").value,
        mobile,
        extractionOnly: true,
      });
      state.scene.onError = () => {
        disableScene();
        notify("軽量アニメーションで抽出を続けます。");
      };
      state.scene.setQuality($("renderQuality").value);
      $("renderQuality").value = state.scene.quality;
      state.scene.setCutaway(
        $("btnCutaway").getAttribute("aria-pressed") === "true",
      );
      const scene = state.scene;
      scene.onFirstFrame = () => {
        if (state.scene !== scene || state.visualDisabled) return;
        syncScenePresentation();
      };
      state.scene.renderer.domElement.setAttribute(
        "aria-label",
        "マシンからエスプレッソを抽出する3Dアニメーション",
      );
      state.scene.renderer.domElement.setAttribute("role", "img");
      state.scene.renderer.domElement.addEventListener(
        "webglcontextlost",
        (e) => {
          e.preventDefault();
          if (state.scene !== scene) return;
          disableScene();
          notify("軽量アニメーションで抽出を続けます。");
        },
      );
      if (state.step === "brew") {
        state.scene.updateConfig({
          ...state.shot.params,
          rpm: state.shot.params.grinderRPM,
        });
        state.scene.start(W.sceneTime(state.shot.duration + PREPARATION));
        state.scene.currentTime = W.sceneTime(state.elapsed);
        state.scene.config.sample =
          state.gpuSample ??
          M.sampleAt(state.shot, Math.max(0, state.elapsed - PREPARATION));
        state.scene.step3DPhysics(0);
        syncScenePresentation();
        state.gpu?.attachScene(state.scene);
      }
    } catch {
      disableScene();
      $("viewport3DContainer").querySelector("canvas")?.remove();
      notify("軽量アニメーションで抽出を表示します。");
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
  function startSimplePlayback(message) {
    state.gpuPending = false;
    $("btnPrimary").disabled = false;
    $("btnSkipBrew").disabled = false;
    $("btnUseSimple").hidden = true;
    text("btnSkipBrew", "アニメを省略して結果へ →");
    text("backendStatus", message);
    state.tickAt = performance.now();
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }
  function recoverSimple(message) {
    const params = state.shot.params;
    releaseGpu();
    state.shot = M.simulate(params);
    state.elapsed = 0;
    state.paused = false;
    state.scene?.updateConfig({ ...params, rpm: params.grinderRPM });
    state.scene?.start(W.sceneTime(state.shot.duration + PREPARATION));
    $("gpuDiagnostics").hidden = true;
    renderPlayback();
    updateDock();
    startSimplePlayback(message + " · 軽量計算で最初から抽出しています");
    notify(message + "。軽量計算に切り替えました。");
  }
  $("btnUseSimple").addEventListener("click", () =>
    recoverSimple("軽量モードを選びました"),
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
    state.gpuPending = R.useGpu($("physicsBackend").value, {
      mobile,
      available: !!navigator.gpu,
    });
    state.gpuSample = null;
    $("gpuDiagnostics").hidden = true;
    $("btnUseSimple").hidden = !state.gpuPending;
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
      state.scene.start(W.sceneTime(state.shot.duration + PREPARATION));
    }
    // Rendering is optional; it must not gate the shot clock or GPU startup.
    ensureScene();
    if (state.gpuPending) {
      const controller = new AbortController();
      state.gpuStartupController = controller;
      try {
        if (generation !== state.generation) return;
        const particleCount =
          $("physicsParticles").value === "auto"
            ? mobile
              ? 32768
              : 100000
            : +$("physicsParticles").value;
        const session = await R.waitFor(
          window.GpuBrewSession.create({
            signal: controller.signal,
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
                [
                  "水の保存誤差",
                  (d.waterErrorKg * 1000).toExponential(2) + " g",
                ],
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
              recoverSimple(
                error.code === "GPU_TIMEOUT"
                  ? "GPUの応答が止まりました"
                  : "GPU計算を続けられませんでした",
              );
            },
          }),
          {
            timeoutMs: 12000,
            signal: controller.signal,
            onTimeout: () => controller.abort(),
            onLateResolve: (session) => session.dispose(),
            message: "GPUの準備が時間内に終わりませんでした",
          },
        );
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
        session.attachScene(state.scene);
        return;
      } catch (error) {
        if (generation !== state.generation) return;
        controller.abort();
        startSimplePlayback("GPUを利用できなかったため、軽量計算で実行中");
        notify("GPUを利用できなかったため、軽量計算に切り替えました。");
        return;
      }
    }
    if ($("physicsBackend").value === "gpu")
      notify("この端末ではGPUを利用できないため、軽量計算で実行します");
    startSimplePlayback(
      mobile
        ? "スマホ向けの軽量計算で実行中"
        : "簡易モデルで抽出を予測しています",
    );
  }
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - state.tickAt) / 1000));
    state.tickAt = now;
    if (state.step !== "brew" || state.finished) return;
    if (!state.paused && !document.hidden) {
      state.elapsed = Math.min(
        state.elapsed + dt,
        state.shot.duration + PREPARATION,
      );
      renderPlayback(dt);
    }
    if (state.elapsed >= state.shot.duration + PREPARATION) {
      finishBrew();
      return;
    }
    state.raf = requestAnimationFrame(tick);
  }
  function renderPlayback(dt = 0) {
    const elapsed = state.elapsed,
      shot = state.shot,
      extractT = Math.max(0, elapsed - PREPARATION),
      sample = state.gpuSample ?? M.sampleAt(shot, extractT);
    illustration.update({ elapsed, sample, params: shot.params });
    const stage = W.at(elapsed),
      extracting = stage.id === "extract";
    text("phasePill", state.paused ? "一時停止中" : stage.label);
    text("livePhaseLabel", state.paused ? "一時停止中" : stage.label);
    text("brewDescription", stage.title);
    text("learningTitle", stage.title);
    text("learningText", stage.description);
    text(
      "illustrationStep",
      `${String(stage.index + 1).padStart(2, "0")} / 06 · ${stage.label}`,
    );
    text("nextPhaseLabel", stage.next);
    $("preparationReading").hidden = extracting;
    $("extractionReadings").hidden = !extracting;
    const p = shot.params;
    const preparationReadings = {
      weigh: [
        "今回量る豆",
        `${fmt(p.dose)} g`,
        "容器の重さをゼロにしてから計量します。",
      ],
      grind: [
        "設定した挽き目",
        `${p.grindSize} μm`,
        `豆 ${fmt(p.dose)} g · グラインダー ${p.grinderRPM} rpm`,
      ],
      distribute: [
        "バスケットの粉",
        `${fmt(p.dose)} g`,
        "細い針で塊をほぐし、均等に広げます。",
      ],
      tamp: [
        "タンピング荷重",
        `${p.tampForce} kg`,
        "タンパーを水平に保ち、均一に押し固めます。",
      ],
      setup: [
        "カップのスケール",
        "0.0 g",
        `カップを置いてゼロに。抽出の目標は ${fmt(p.targetYield)} g。`,
      ],
    }[stage.id];
    if (preparationReadings)
      ["prepMetricLabel", "prepMetricValue", "prepMetricHint"].forEach(
        (id, i) => text(id, preparationReadings[i]),
      );
    text(
      "remainingTime",
      state.paused
        ? "再開を待っています"
        : `あと約 ${Math.ceil(shot.duration + PREPARATION - elapsed)} 秒`,
    );
    text("simTimerDisplay", fmt(elapsed) + " s");
    text("liveShotTime", fmt(extractT) + " s");
    text("liveYield", fmt(sample.yield) + " g");
    text("livePressure", fmt(extracting ? sample.p : 0) + " bar");
    text("liveFlowRate", fmt(extracting ? sample.q : 0, 2) + " g/s");
    const progress = state.gpu
      ? Math.min(
          99,
          Math.min(15, (elapsed / PREPARATION) * 15) +
            (sample.yield / shot.params.targetYield) * 84,
        )
      : (elapsed / (shot.duration + PREPARATION)) * 100;
    $("brewProgressFill").style.width = progress + "%";
    document
      .querySelector(".brew-progress")
      .setAttribute("aria-valuenow", String(Math.round(progress)));
    [...W.stages.map((s) => s.id), "done"].forEach((id, i) => {
      const node = $("phase" + id[0].toUpperCase() + id.slice(1));
      node.classList.toggle("active", stage.index === i);
      node.classList.toggle("done", i < stage.index);
      if (stage.index === i) node.setAttribute("aria-current", "step");
      else node.removeAttribute("aria-current");
    });
    syncScenePresentation();
    if (extracting) ensureScene();
    if (state.scene && dt > 0 && !state.paused) {
      state.scene.currentTime = W.sceneTime(elapsed);
      state.scene.config.sample = sample;
      state.scene.step3DPhysics(dt);
    }
  }
  function finishBrew() {
    if (state.finished) return;
    cancelAnimationFrame(state.raf);
    state.finished = true;
    state.elapsed = state.shot.duration + PREPARATION;
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
