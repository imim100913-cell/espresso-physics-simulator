const { test, expect } = require("@playwright/test");

// Local browsers may omit WebGPU. The graphics CI must execute every GPU test.
async function requireGpu(page) {
  const available = await page.evaluate(async () => {
    const adapter = navigator.gpu && (await navigator.gpu.requestAdapter());
    return !!adapter;
  });
  if (process.env.PLAYWRIGHT_REQUIRE_GPU === "1")
    expect(
      available,
      "Graphics CI requires a WebGPU adapter; tests must not silently skip",
    ).toBe(true);
  test.skip(!available, "WebGPU adapter not exposed by this browser");
}

module.exports = { requireGpu };
