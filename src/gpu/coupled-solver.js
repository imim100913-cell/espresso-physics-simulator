import common from "./common.wgsl";
import mpmCode from "./mpm.wgsl";
import porousCode from "./porous.wgsl";
import liquidCode from "./liquid.wgsl";

export const PARTICLE_STRIDE = 144;
export const CELL_STRIDE = 96;
export const DROP_STRIDE = 64;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export async function createCoupledSolver(options = {}) {
  options.signal?.throwIfAborted();
  if (!navigator.gpu) throw new Error("このブラウザはWebGPUに対応していません");
  const count =
    options.particleCount ??
    (matchMedia("(max-width:700px)").matches ? 32768 : 100000);
  const fluidCount = options.fluidCount ?? 2048;
  if (
    !Number.isInteger(count) ||
    count < 128 ||
    count > 500000 ||
    !Number.isInteger(fluidCount) ||
    fluidCount < 32 ||
    fluidCount > 8192
  )
    throw new Error("粒子数が対応範囲外です");
  const adapter =
    options.adapter ??
    (await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    }));
  options.signal?.throwIfAborted();
  if (!adapter) throw new Error("利用可能なGPUがありません");
  const storageBytes = Math.max(
    count * PARTICLE_STRIDE,
    (options.gridDimension ?? 32) ** 3 * 16,
    fluidCount * DROP_STRIDE,
  );
  if (
    adapter.limits.maxStorageBufferBindingSize < storageBytes ||
    adapter.limits.maxStorageBuffersPerShaderStage < 8
  )
    throw new Error("この端末では選択した粒子数を計算できません");
  const device =
    options.device ??
    (await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: storageBytes,
        maxBufferSize: Math.max(16 * 1024 * 1024, storageBytes),
      },
    }));
  const ownDevice = !options.device;
  if (options.signal?.aborted) {
    if (ownDevice) device.destroy();
    options.signal.throwIfAborted();
  }
  const buffers = {},
    resources = [];
  const buffer = (
    name,
    bytes,
    usage = GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  ) => {
    const b = device.createBuffer({
      label: name,
      size: Math.max(16, Math.ceil(bytes / 16) * 16),
      usage,
    });
    buffers[name] = b;
    resources.push(b);
    return b;
  };
  const dim = options.gridDimension ?? 32,
    hdim = dim / 2;
  if (![16, 32, 48].includes(dim)) {
    if (ownDevice) device.destroy();
    throw new Error("Invalid grid dimension");
  }
  const dx = 0.064 / dim,
    hdx = dx * 2,
    gridCount = dim ** 3,
    cellCount = hdim ** 3;
  const params = buffer(
    "params",
    128,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const particles = buffer("particles", count * PARTICLE_STRIDE),
    heads = buffer("heads", gridCount * 4),
    next = buffer("next", count * 4),
    grid = buffer("grid", gridCount * 16),
    cells = buffer("cells", cellCount * CELL_STRIDE),
    pressure = buffer("pressure", cellCount * 4),
    impulses = buffer("impulses", gridCount * 16),
    diagnostics = buffer("diagnostics", Math.ceil(count / 128) * 32);
  const drops = buffer("drops", fluidCount * DROP_STRIDE),
    fluidHeads = buffer("fluidHeads", (16 * 40 * 16 + 1) * 4),
    fluidNext = buffer("fluidNext", fluidCount * 4),
    delta = buffer("delta", fluidCount * 16),
    pool = buffer("pool", 16 * 16),
    cdf = buffer("cdf", cellCount * 4),
    collected = buffer("collected", fluidCount * 16);
  let disposed = false,
    lost = false,
    busy = false;
  const disposeResources = () => {
    if (disposed) return;
    disposed = true;
    options.signal?.removeEventListener("abort", disposeResources);
    resources.forEach((b) => b.destroy());
    if (ownDevice) device.destroy();
  };
  options.signal?.addEventListener("abort", disposeResources, { once: true });
  device.lost.then((info) => {
    if (!disposed) {
      lost = true;
      options.onLost?.(info.message);
    }
  });
  const errors = [];
  device.addEventListener("uncapturederror", (event) => {
    errors.push(event.error.message);
  });
  async function pipelines(source, entryPoints, bindings) {
    options.signal?.throwIfAborted();
    const module = device.createShaderModule({ code: common + "\n" + source });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length)
      throw new Error(
        errors.map((m) => `WGSL ${m.lineNum}: ${m.message}`).join("\n"),
      );
    const layout = device.createBindGroupLayout({
      entries: bindings.map((b, i) => ({
        binding: i,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: i === 0 ? "uniform" : "storage" },
      })),
    });
    const group = device.createBindGroup({
      layout,
      entries: bindings.map((b, i) => ({
        binding: i,
        resource: { buffer: b },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });
    const result = {};
    for (const entryPoint of entryPoints) {
      options.signal?.throwIfAborted();
      result[entryPoint] = {
        pipeline: await device.createComputePipelineAsync({
          label: entryPoint,
          layout: pipelineLayout,
          compute: { module, entryPoint },
        }),
        group,
      };
    }
    options.signal?.throwIfAborted();
    return result;
  }
  let m, h, f;
  try {
    m = await pipelines(
      mpmCode,
      [
        "initialize",
        "clearGrid",
        "binParticles",
        "constitutive",
        "gather",
        "g2p",
        "reduce",
        "dragFeedback",
      ],
      [params, particles, heads, next, grid, cells, diagnostics, impulses],
    );
    h = await pipelines(
      porousCode,
      [
        "clearBins",
        "bin",
        "initializeCells",
        "solvePressure",
        "copyPressure",
        "flux",
        "x0",
        "x1",
        "y0",
        "y1",
        "z0",
        "z1",
        "outletBudget",
        "boundaries",
        "refreshCells",
        "dissolveParticles",
      ],
      [params, particles, heads, next, cells, pressure, pool],
    );
    f = await pipelines(
      liquidCode,
      [
        "initialize",
        "prepareEmission",
        "emit",
        "finishEmission",
        "clear",
        "bin",
        "predict",
        "density",
        "correction",
        "apply",
        "surface",
        "finish",
      ],
      [
        params,
        cells,
        drops,
        fluidHeads,
        fluidNext,
        delta,
        pool,
        cdf,
        collected,
      ],
    );
  } catch (error) {
    disposeResources();
    throw error;
  }
  let recipe = {
    dose: 18,
    grindSize: 380,
    waterTemp: 93,
    maxPressure: 9,
    targetYield: 36,
    tampForce: 15,
    ...options.recipe,
  };
  let mechanicsTime = 0,
    hydraulicTime = 0,
    liquidTime = 0,
    initializedHydro = false,
    lastMaxSpeed = 0,
    serial = 0,
    latest = null;
  const prepDuration = options.preparationSeconds ?? 0.12,
    hydraulicDt = options.hydraulicDt ?? 0.02,
    fluidDt = options.fluidDt ?? 0.002;
  if (!(
    prepDuration > 0 &&
    prepDuration <= 1 &&
    hydraulicDt > 0 &&
    hydraulicDt <= 0.05 &&
    fluidDt > 0 &&
    fluidDt <= 0.002 &&
    Number.isInteger(hydraulicDt / fluidDt)
  )) {
    resources.forEach((b) => b.destroy());
    if (ownDevice) device.destroy();
    throw new Error("Invalid time step");
  }
  const data = new ArrayBuffer(128),
    u32 = new Uint32Array(data),
    floats = new Float32Array(data);
  const materialDensity = 1400,
    mu = 5000,
    lambda = 10000,
    frictionAngle = (Math.PI * 35) / 180;
  const alpha =
    (Math.sqrt(2 / 3) * 2 * Math.sin(frictionAngle)) /
    (3 - Math.sin(frictionAngle));
  let forceFlush = false;
  let pressurePa = 0,
    dt = 0.0001;
  function uniform() {
    const norm = clamp(mechanicsTime / prepDuration, 0, 1),
      press = clamp((norm - 0.55) / 0.4, 0, 1);
    const stroke = (1 - Math.exp(-recipe.tampForce / 5)) * 0.013;
    const tampY = 0.034 - stroke * press;
    const tampV =
      norm > 0.55 && norm < 0.95 ? -stroke / (prepDuration * 0.4) : 0;
    const viscosity =
      2.414e-5 * 10 ** (247.8 / (recipe.waterTemp + 273.15 - 140));
    u32.set([count, dim, hdim, fluidCount]);
    floats.set(
      [
        dx,
        0.032,
        0.026,
        0.006,
        materialDensity,
        mu,
        lambda,
        alpha,
        dt,
        mechanicsTime,
        tampY,
        tampV,
        9.81,
        hydraulicDt,
        pressurePa,
        recipe.waterTemp + 273.15,
        recipe.dose * 0.001,
        (recipe.dose * 0.001) / count / materialDensity,
        recipe.targetYield * 0.001,
        fluidDt,
        hdx,
        forceFlush ? 1 : 0,
        7e-15 * (recipe.grindSize / 380) ** 2,
        viscosity,
        0.004,
        2.5e-7,
        1e-6,
        -0.058,
      ],
      4,
    );
    device.queue.writeBuffer(params, 0, data);
  }
  // Distinct uniform snapshots are required for substeps: queue.writeBuffer is not
  // interleaved with previously encoded commands. Each mechanical batch uses one dt/boundary.
  function dispatch(command, stage, n, workgroup = 128) {
    const pass = command.beginComputePass({ label: stage.pipeline.label });
    pass.setPipeline(stage.pipeline);
    pass.setBindGroup(0, stage.group);
    pass.dispatchWorkgroups(Math.ceil(n / workgroup));
    pass.end();
  }
  function mechanical(command, substeps) {
    for (let i = 0; i < substeps; i++) {
      dispatch(command, m.clearGrid, gridCount);
      dispatch(command, m.constitutive, count);
      dispatch(command, m.binParticles, count);
      dispatch(command, m.gather, gridCount, 64);
      dispatch(command, m.g2p, count);
      dispatch(command, m.dragFeedback, cellCount);
    }
    mechanicsTime += substeps * dt;
  }
  function hydroBins(command, first = false) {
    dispatch(command, h.clearBins, cellCount);
    dispatch(command, h.bin, count);
    dispatch(command, first ? h.initializeCells : h.refreshCells, cellCount);
  }
  function liquid(command, substeps) {
    for (let i = 0; i < substeps; i++) {
      dispatch(command, f.predict, fluidCount);
      for (let iteration = 0; iteration < 3; iteration++) {
        dispatch(command, f.clear, 16 * 40 * 16);
        dispatch(command, f.bin, fluidCount);
        dispatch(command, f.density, fluidCount);
        dispatch(command, f.correction, fluidCount);
        dispatch(command, f.apply, fluidCount);
      }
      dispatch(command, f.clear, 16 * 40 * 16);
      dispatch(command, f.bin, fluidCount);
      dispatch(command, f.surface, fluidCount);
      dispatch(command, f.finish, fluidCount);
    }
    liquidTime += substeps * fluidDt;
  }
  function transport(command) {
    hydroBins(command, !initializedHydro);
    initializedHydro = true;
    for (let i = 0; i < 32; i++) {
      dispatch(command, h.solvePressure, cellCount);
      dispatch(command, h.copyPressure, cellCount);
    }
    dispatch(command, h.flux, cellCount);
    for (const key of ["x0", "x1", "y0", "y1", "z0", "z1"])
      dispatch(command, h[key], cellCount);
    dispatch(command, h.outletBudget, 1, 1);
    dispatch(command, h.boundaries, cellCount);
    dispatch(command, h.dissolveParticles, count);
    dispatch(command, f.prepareEmission, 1, 1);
    dispatch(command, f.emit, fluidCount);
    dispatch(command, f.finishEmission, 1, 1);
    liquid(command, Math.round(hydraulicDt / fluidDt));
    dispatch(command, f.prepareEmission, 1, 1);
    hydraulicTime += hydraulicDt;
  }
  async function readBuffers(requests) {
    const sizes = requests.map(([b, size]) => size),
      offsets = [];
    let total = 0;
    for (const size of sizes) {
      offsets.push(total);
      total += Math.ceil(size / 256) * 256;
    }
    const staging = device.createBuffer({
      size: Math.max(256, total),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const command = device.createCommandEncoder();
    requests.forEach(([b, size], i) =>
      command.copyBufferToBuffer(b, 0, staging, offsets[i], size),
    );
    device.queue.submit([command.finish()]);
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const mapped = staging.getMappedRange();
      return sizes.map(
        (size, i) =>
          new Float32Array(mapped.slice(offsets[i], offsets[i] + size)),
      );
    } finally {
      if (staging.mapState === "mapped") staging.unmap();
      staging.destroy();
    }
  }
  async function diagnosticsSnapshot() {
    const blocks = Math.ceil(count / 128),
      [a, b] = await readBuffers([
        [diagnostics, blocks * 32],
        [pool, 256],
      ]);
    let dry = 0,
      center = 0,
      plastic = 0,
      maxSpeed = 0,
      bad = 0,
      minDet = Infinity;
    for (let i = 0; i < blocks; i++) {
      dry += a[i * 8];
      center += a[i * 8 + 1];
      plastic += a[i * 8 + 2];
      maxSpeed = Math.max(maxSpeed, a[i * 8 + 3]);
      bad += a[i * 8 + 4];
      minDet = Math.min(minDet, a[i * 8 + 5]);
    }
    lastMaxSpeed = maxSpeed;
    latest = {
      particleCount: count,
      fluidCapacity: fluidCount,
      mechanicsSeconds: mechanicsTime,
      preparationProgress: Math.min(1, mechanicsTime / prepDuration),
      hydraulicSeconds: hydraulicTime,
      liquidSeconds: liquidTime,
      dryMassKg: dry,
      meanHeightMeters: dry ? center / dry : 0,
      plasticStrain: dry ? plastic / dry : 0,
      maxVelocityMS: maxSpeed,
      minDetF: minDet,
      nanCount: bad + b[24],
      meanPorosity: initializedHydro ? b[25] : 0.4,
      channelRiskPercent: b[26],
      waterInKg: b[0],
      outletSolutionKg: b[1],
      outletSoluteKg: b[2],
      dissolvedKg: b[3],
      storedWaterKg: b[12],
      storedSoluteKg: b[13],
      remainingSolubleKg: initializedHydro ? b[14] : recipe.dose * 0.001 * 0.28,
      cupMassKg: b[16],
      cupSoluteKg: b[17],
      fallingMassKg: b[18],
      fallingSoluteKg: b[19],
      reservoirMassKg: b[8],
      reservoirSoluteKg: b[9],
      waterErrorKg: b[0] - b[12] - (b[1] - b[2]),
      coffeeErrorKg: recipe.dose * 0.001 - dry - b[13] - b[2],
      liquidErrorKg: b[1] - b[16] - b[18] - b[8],
      validationErrors: [...errors],
    };
    latest.complete = latest.cupMassKg >= recipe.targetYield * 0.001 - 1e-7;
    if (
      !Object.entries(latest)
        .filter(([, v]) => typeof v === "number")
        .every(([, v]) => Number.isFinite(v)) ||
      latest.nanCount > 0 ||
      errors.length
    )
      throw new Error("GPU計算が不安定になったため停止しました");
    return latest;
  }
  async function initialize() {
    uniform();
    const command = device.createCommandEncoder();
    dispatch(command, m.initialize, count);
    dispatch(command, f.initialize, Math.max(fluidCount, 16 * 40 * 16));
    dispatch(command, m.reduce, count);
    device.queue.submit([command.finish()]);
    await device.queue.onSubmittedWorkDone();
    return diagnosticsSnapshot();
  }
  try {
    await initialize();
  } catch (error) {
    disposeResources();
    throw error;
  }
  return {
    device,
    adapter,
    particleCount: count,
    fluidCount,
    gridDimension: dim,
    hydroDimension: hdim,
    buffers,
    recipe,
    get disposed() {
      return disposed;
    },
    get latest() {
      return latest;
    },
    get busy() {
      return busy;
    },
    getRenderBuffers() {
      return { positions: particles, saturation: cells, solute: cells, drops };
    },
    setMachineBoundary(boundary) {
      pressurePa = clamp(boundary.pressurePa ?? pressurePa, 0, 1.2e6);
    },
    async advance({
      mechanicalSubsteps = 8,
      hydraulicSteps = 1,
      pressure = pressurePa,
    } = {}) {
      if (disposed || lost) throw new Error("GPU device unavailable");
      if (busy) throw new Error("GPU step already in flight");
      if (
        !Number.isInteger(mechanicalSubsteps) ||
        mechanicalSubsteps < 0 ||
        mechanicalSubsteps > 128 ||
        !Number.isInteger(hydraulicSteps) ||
        hydraulicSteps < 0 ||
        hydraulicSteps > 16
      )
        throw new Error("Invalid substep count");
      busy = true;
      try {
        forceFlush = false;
        pressurePa = clamp(pressure, 0, 1.2e6);
        const wave = Math.sqrt((lambda + 2 * mu) / materialDensity);
        dt = Math.min(
          0.00015,
          (0.3 * dx) /
            (wave + lastMaxSpeed + Math.sqrt(pressurePa / materialDensity)),
        );
        const preparation = mechanicsTime < prepDuration;
        const steps = preparation
          ? Math.min(
              mechanicalSubsteps,
              Math.ceil((prepDuration - mechanicsTime) / dt),
            )
          : Math.min(mechanicalSubsteps, 2);
        uniform();
        const start = performance.now();
        const command = device.createCommandEncoder();
        mechanical(command, steps);
        if (!preparation)
          for (let i = 0; i < hydraulicSteps; i++) transport(command);
        dispatch(command, m.reduce, count);
        device.queue.submit([command.finish()]);
        await device.queue.onSubmittedWorkDone();
        const result = await diagnosticsSnapshot();
        return {
          ...result,
          gpuBatchWallMilliseconds: performance.now() - start,
        };
      } finally {
        busy = false;
      }
    },
    async readParticles(limit = 16) {
      if (limit > count || limit < 1) throw new Error("Invalid sample count");
      return (await readBuffers([[particles, limit * PARTICLE_STRIDE]]))[0];
    },
    async readCells() {
      return (await readBuffers([[cells, cellCount * CELL_STRIDE]]))[0];
    },
    async drain({ steps = 10 } = {}) {
      if (disposed || lost) throw new Error("GPU device unavailable");
      if (!Number.isInteger(steps) || steps < 1 || steps > 128)
        throw new Error("Invalid drain steps");
      forceFlush = true;
      if (busy) throw new Error("GPU step already in flight");
      busy = true;
      try {
        uniform();
        const command = device.createCommandEncoder();
        liquid(command, steps);
        dispatch(command, f.prepareEmission, 1, 1);
        dispatch(command, f.emit, fluidCount);
        dispatch(command, f.finishEmission, 1, 1);
        dispatch(command, f.prepareEmission, 1, 1);
        dispatch(command, m.reduce, count);
        device.queue.submit([command.finish()]);
        await device.queue.onSubmittedWorkDone();
        return await diagnosticsSnapshot();
      } finally {
        busy = false;
      }
    },
    dispose: disposeResources,
  };
}
