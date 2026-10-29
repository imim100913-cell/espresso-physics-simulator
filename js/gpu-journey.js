/* Coordinates actual GPU steps; simulated time advances only after kernels finish. */
(function () {
  "use strict";
  class GpuBrewSession {
    static async create({
      recipe,
      signal,
      particleCount,
      scene,
      onUpdate,
      onComplete,
      onError,
      onNotice,
    }) {
      const module = await import("./renderer.bundle.js?v=4.5.0");
      const session = new GpuBrewSession();
      Object.assign(session, {
        recipe,
        onUpdate,
        onComplete,
        onError,
        onNotice,
        paused: false,
        cancelled: false,
        ending: false,
        running: false,
        records: [],
        timer: 0,
        draining: false,
        mechanicalBatch: 4,
      });
      session.solver = await module.createCoupledSolver({
        recipe,
        signal,
        particleCount,
        onLost: (message) => {
          if (!session.cancelled)
            session.fail(new Error("GPUとの接続が切れました。" + message));
        },
      });
      if (signal?.aborted) {
        session.dispose();
        throw signal.reason;
      }
      session.signal = signal;
      session.abort = () => session.dispose();
      signal?.addEventListener("abort", session.abort, { once: true });
      session.scene = scene;
      session.records.push({
        t: 0,
        p: 0,
        q: 0,
        yield: 0,
        solute: 0,
        tds: 0,
        ey: 0,
        porosity: 0.4,
      });
      return session;
    }
    async attachScene(scene) {
      if (
        !scene ||
        scene.disposed ||
        this.cancelled ||
        this.view ||
        this.attaching
      )
        return;
      this.attaching = true;
      let view;
      try {
        const { CoupledGpuView } = await import("./renderer.bundle.js?v=4.5.0");
        if (this.cancelled || scene.disposed) return;
        view = new CoupledGpuView(this.solver, scene);
        await window.BrewRuntime.waitFor(view.init(), {
          timeoutMs: 8000,
          signal: this.signal,
          onTimeout: () => view.dispose(),
          onLateResolve: () => view.dispose(),
          message: "粒子表示の準備が時間内に終わりませんでした",
        });
        if (this.cancelled || scene.disposed) {
          view.dispose();
          return;
        }
        this.view = view;
        view.onError = () => {
          view.dispose();
          this.view = null;
          this.onNotice("粒子の表示を停止しました。数値計算は続行します。");
        };
      } catch (error) {
        view?.dispose();
        if (!this.cancelled)
          this.onNotice("GPU粒子の表示を省略して、数値計算を続けます。");
      } finally {
        this.attaching = false;
      }
    }
    start() {
      if (this.running || this.cancelled) return;
      this.running = true;
      this.attachScene(this.scene);
      this.schedule();
    }
    schedule() {
      if (!this.cancelled && this.running)
        this.timer = setTimeout(() => this.step(), 0);
    }
    async step() {
      if (this.cancelled || !this.running) return;
      if (this.paused || document.hidden) {
        this.timer = setTimeout(() => this.step(), 100);
        return;
      }
      try {
        const before = this.solver.latest;
        let d,
          pressure = 0;
        if (this.ending || this.draining) {
          d = await this.compute(this.solver.drain({ steps: 10 }));
          this.draining = true;
        } else {
          pressure =
            before.preparationProgress < 1
              ? 0
              : window.BrewModel.pressureAt(
                  before.hydraulicSeconds,
                  this.recipe,
                );
          d = await this.compute(
            this.solver.advance({
              mechanicalSubsteps: this.mechanicalBatch,
              hydraulicSteps: 1,
              pressure: pressure * 1e5,
            }),
          );
        }
        if (this.cancelled) return;
        if (d.gpuBatchWallMilliseconds > 0 && before.preparationProgress < 1)
          this.mechanicalBatch = Math.max(
            1,
            Math.min(
              32,
              Math.floor(
                (this.mechanicalBatch * 50) / d.gpuBatchWallMilliseconds,
              ),
            ),
          );
        const t = d.liquidSeconds,
          previous = this.records.at(-1);
        const sample = {
          t,
          p: pressure,
          q:
            t > previous.t
              ? (d.cupMassKg * 1000 - previous.yield) / (t - previous.t)
              : 0,
          yield: d.cupMassKg * 1000,
          solute: d.cupSoluteKg * 1000,
          tds: d.cupMassKg > 0 ? (d.cupSoluteKg / d.cupMassKg) * 100 : 0,
          tdsCup: d.cupMassKg > 0 ? (d.cupSoluteKg / d.cupMassKg) * 100 : 0,
          ey: (d.cupSoluteKg / (this.recipe.dose * 0.001)) * 100,
          porosity: d.meanPorosity ?? 0.4,
        };
        if (t > previous.t) this.records.push(sample);
        this.onUpdate({
          diagnostics: d,
          sample,
          elapsed:
            d.preparationProgress < 1
              ? d.preparationProgress * window.BrewWorkflow.preparationSeconds
              : window.BrewWorkflow.preparationSeconds + t,
          draining: this.draining,
        });
        if (
          d.outletSolutionKg >= this.recipe.targetYield * 0.001 - 1e-7 ||
          d.hydraulicSeconds >= 120
        )
          this.draining = true;
        if (this.draining && d.fallingMassKg + d.reservoirMassKg < 1e-7) {
          const result = window.BrewModel.fromMeasurements(
            this.recipe,
            this.records,
            { risk: d.channelRiskPercent ?? 0, diagnostics: d },
          );
          result.stopReason = this.ending
            ? "ユーザー操作で終了"
            : result.complete
              ? "目標量に到達"
              : "120秒で終了";
          if (this.ending && !result.complete) {
            result.title = "途中までの抽出レポート";
            result.description =
              "抽出を途中で終了しました。ここまでにカップへ届いた液量と成分量を記録しています。";
          }
          this.onComplete(result);
          this.running = false;
          return;
        }
        this.schedule();
      } catch (error) {
        this.fail(error);
      }
    }
    compute(promise) {
      return window.BrewRuntime.waitFor(promise, {
        timeoutMs: 8000,
        signal: this.signal,
        onTimeout: () => this.solver.dispose(),
        message: "GPUの計算が時間内に終わりませんでした",
      });
    }
    finishEarly() {
      this.ending = true;
      this.paused = false;
    }
    fail(error) {
      if (this.cancelled || !this.running) return;
      this.running = false;
      this.onError(error);
    }
    dispose() {
      if (this.cancelled) return;
      this.cancelled = true;
      this.signal?.removeEventListener("abort", this.abort);
      this.running = false;
      clearTimeout(this.timer);
      this.view?.dispose();
      this.solver?.dispose();
    }
  }
  window.GpuBrewSession = GpuBrewSession;
})();
