const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/runtime-policy.js");
const wide = () => ({ matches: false });
test("Android stays mobile in landscape and with a reduced Chrome user agent", () => {
  assert.equal(
    R.isMobile(
      {
        userAgent:
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit Chrome/142.0 Mobile Safari",
        userAgentData: { mobile: false },
      },
      wide,
    ),
    true,
  );
  assert.equal(
    R.isMobile({ userAgent: "desktop", userAgentData: { mobile: true } }, wide),
    true,
  );
  assert.equal(
    R.isMobile({ platform: "MacIntel", maxTouchPoints: 5 }, wide),
    true,
  );
  assert.equal(R.isMobile({ userAgent: "Linux desktop" }, wide), false);
});
test("mobile auto starts without WebGPU; explicit GPU remains available", () => {
  assert.equal(R.useGpu("auto", { mobile: true, available: true }), false);
  assert.equal(R.useGpu("gpu", { mobile: true, available: true }), true);
  assert.equal(R.useGpu("auto", { mobile: false, available: true }), true);
  assert.equal(R.useGpu("gpu", { mobile: true, available: false }), false);
});
test("deadline rejects stalled initialization and disposes a late session", async () => {
  let resolveLate,
    disposed = false,
    aborted = false;
  const task = new Promise((r) => (resolveLate = r));
  await assert.rejects(
    R.waitFor(task, {
      timeoutMs: 10,
      onTimeout: () => (aborted = true),
      onLateResolve: (v) => v.dispose(),
    }),
    { code: "GPU_TIMEOUT" },
  );
  assert.equal(aborted, true);
  resolveLate({ dispose: () => (disposed = true) });
  await Promise.resolve();
  assert.equal(disposed, true);
});
test("cancellation rejects immediately and observes late rejection", async () => {
  const controller = new AbortController();
  let rejectLate;
  const task = new Promise((_, reject) => (rejectLate = reject));
  const waiting = R.waitFor(task, {
    timeoutMs: 1000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  rejectLate(new Error("late failure"));
  await Promise.resolve();
});
