/* Startup policy shared by the guided UI and GPU controller. */
(function (root) {
  "use strict";
  function isMobile(nav = root.navigator, media = root.matchMedia?.bind(root)) {
    return !!(
      nav?.userAgentData?.mobile ||
      /Android|iPhone|iPad|iPod/i.test(nav?.userAgent ?? "") ||
      (nav?.platform === "MacIntel" && nav.maxTouchPoints > 1) ||
      media?.("(max-width:700px)").matches
    );
  }
  function useGpu(
    backend,
    { mobile = isMobile(), available = !!root.navigator?.gpu } = {},
  ) {
    return available && (backend === "gpu" || (backend === "auto" && !mobile));
  }
  function waitFor(
    promise,
    {
      timeoutMs,
      signal,
      onTimeout,
      onLateResolve,
      message = "GPUの応答を確認できませんでした",
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      let settled = false,
        timer;
      const abort = () =>
        finish(
          reject,
          signal.reason ?? new DOMException("Cancelled", "AbortError"),
        );
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        callback(value);
      }
      Promise.resolve(promise).then(
        (value) => {
          if (settled) onLateResolve?.(value);
          else finish(resolve, value);
        },
        (error) => finish(reject, error),
      );
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (timeoutMs > 0)
        timer = setTimeout(() => {
          const error = new Error(message);
          error.code = "GPU_TIMEOUT";
          finish(reject, error);
          onTimeout?.();
        }, timeoutMs);
    });
  }
  const api = { isMobile, useGpu, waitFor };
  if (typeof module !== "undefined") module.exports = api;
  else root.BrewRuntime = api;
})(typeof window === "undefined" ? globalThis : window);
