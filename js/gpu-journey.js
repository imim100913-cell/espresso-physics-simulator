/* Coordinates actual GPU steps; simulated time advances only after kernels finish. */
(function () {
  "use strict";
  class GpuBrewSession {
    static async create({
      recipe,
      particleCount,
      scene,
      onUpdate,
      onComplete,
      onError,
      onNotice,
    }) {
      const module = await import("./renderer.bundle.js?v=4.2.0");
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
        particleCount,
        onLost: (message) => {
          if (!session.cancelled)
            session.fail(new Error("GPUとの接続が切れました。" + message));
        },
      });
      if (scene) {
        let view;
        try {
          view = new module.CoupledGpuView(session.solver, scene);
          await view.init();
          session.view = view;
          view.onError = (error) => {
            view.dispose();
            session.view = null;
            onNotice("粒子の表示を停止しました。物理計算は続行します。");
          };
        } catch (error) {
          view?.dispose();
          onNotice(
            "この端末では粒子の3D表示を利用できません。数値計算は続行します。",
          );
          console.warn(error);
        }
      }
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
    start() {
      if (this.running || this.cancelled) return;
      this.running = true;
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
          d = await this.solver.drain({ steps: 10 });
          this.draining = true;
        } else {
          pressure =
            before.preparationProgress < 1
              ? 0
              : window.BrewModel.pressureAt(
                  before.hydraulicSeconds,
                  this.recipe,
                );
          d = await this.solver.advance({
            mechanicalSubsteps: this.mechanicalBatch,
            hydraulicSteps: 1,
            pressure: pressure * 1e5,
          });
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
            d.preparationProgress < 1 ? d.preparationProgress * 7.5 : 7.5 + t,
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
      this.running = false;
      clearTimeout(this.timer);
      this.view?.dispose();
      const solver = this.solver;
      if (solver?.busy) {
        solver.device.queue
          .onSubmittedWorkDone()
          .finally(() => solver.dispose())
          .catch(() => {});
      } else solver?.dispose();
    }
  }
  window.GpuBrewSession = GpuBrewSession;
})();
