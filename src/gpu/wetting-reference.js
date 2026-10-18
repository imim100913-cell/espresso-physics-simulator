// Executable WebGPU reference. Kept outside the mobile renderer until calibrated.
export async function createWettingReference({
  size = [16, 24, 16],
  dx = 0.001,
  dt = 0.01,
  diffusivity = 1e-6,
  inlet = 0.0001,
  drain = 0.00003,
  inletConcentration = 0,
} = {}) {
  if (!navigator.gpu) throw new Error("WebGPU unavailable");
  if (
    ![inlet, drain, inletConcentration].every(
      (v) => Number.isFinite(v) && v >= 0,
    )
  )
    throw new Error("Invalid boundary conditions");
  if (
    size.some((n) => !Number.isInteger(n) || n < 1 || n > 128) ||
    !Number.isFinite(dx) ||
    dx <= 0 ||
    !Number.isFinite(dt) ||
    dt <= 0 ||
    !Number.isFinite(diffusivity) ||
    diffusivity <= 0 ||
    dt > (dx * dx) / (6 * diffusivity)
  )
    throw new Error("Invalid grid or explicit-diffusion CFL bound");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter");
  const device = await adapter.requestDevice();
  const response = await fetch(new URL("./wetting.wgsl", import.meta.url));
  if (!response.ok) throw new Error("Wetting shader unavailable");
  const code = await response.text();
  const module = device.createShaderModule({ code });
  const messages = (await module.getCompilationInfo()).messages.filter(
    (m) => m.type === "error",
  );
  if (messages.length)
    throw new Error(messages.map((m) => m.message).join("\n"));
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "step" },
  });
  const n = size.reduce((a, b) => a * b),
    bytes = n * 16,
    usage =
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST;
  const a = device.createBuffer({ size: bytes, usage }),
    b = device.createBuffer({ size: bytes, usage }),
    boundary = device.createBuffer({ size: bytes, usage });
  const initial = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    initial[i * 4 + 2] = 0.4;
    initial[i * 4 + 3] = 1;
  }
  device.queue.writeBuffer(a, 0, initial);
  device.queue.writeBuffer(b, 0, initial);
  const params = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    data = new ArrayBuffer(48);
  new Uint32Array(data).set([...size, 0]);
  new Float32Array(data, 16).set([
    dx,
    dt,
    diffusivity,
    inlet,
    inletConcentration,
    drain,
    0,
    0,
  ]);
  device.queue.writeBuffer(params, 0, data);
  const groups = [
    [a, b],
    [b, a],
  ].map(([read, write]) =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: read } },
        { binding: 2, resource: { buffer: write } },
        { binding: 3, resource: { buffer: boundary } },
      ],
    }),
  );
  let parity = 0;
  return {
    device,
    module,
    count: n,
    step(substeps = 1) {
      if (!Number.isInteger(substeps) || substeps < 1 || substeps > 256)
        throw new Error("Invalid substep count");
      const command = device.createCommandEncoder();
      for (let i = 0; i < substeps; i++) {
        const pass = command.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, groups[parity]);
        pass.dispatchWorkgroups(...size.map((n) => Math.ceil(n / 4)));
        pass.end();
        parity = 1 - parity;
      }
      device.queue.submit([command.finish()]);
    },
    async read() {
      const staging = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const command = device.createCommandEncoder();
      command.copyBufferToBuffer(parity ? b : a, 0, staging, 0, bytes);
      device.queue.submit([command.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      staging.destroy();
      return result;
    },
    dispose() {
      [a, b, boundary, params].forEach((buffer) => buffer.destroy());
      device.destroy();
    },
  };
}
