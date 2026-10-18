import common from "./common.wgsl";
import viewSource from "./view.wgsl";
import postSource from "./composite.wgsl";
import * as THREE from "three";

export class CoupledGpuView {
  constructor(solver, scene) {
    this.solver = solver;
    this.scene = scene;
    this.device = solver.device;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gpu-particle-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
    scene.container.append(this.canvas);
    this.softwarePresentation =
      !!solver.adapter.info?.isFallbackAdapter ||
      /swiftshader|llvmpipe/i.test(solver.adapter.info?.architecture ?? "");
    this.format = this.softwarePresentation
      ? "rgba8unorm"
      : navigator.gpu.getPreferredCanvasFormat();
    this.context = this.canvas.getContext(
      this.softwarePresentation ? "2d" : "webgpu",
    );
    if (!this.softwarePresentation)
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: "opaque",
      });
    this.colorReadback = this.softwarePresentation;
    this.meshes = [];
    this.resources = [];
    this.textures = [];
    this.width = 0;
    this.height = 0;
    this.disposed = false;
    this.enabled = true;
  }
  async init() {
    const d = this.device;
    const buffer = (size, usage) => {
      if (this.disposed) throw new DOMException("View cancelled", "AbortError");
      const b = d.createBuffer({ size: Math.ceil(size / 16) * 16, usage });
      this.resources.push(b);
      return b;
    };
    this.cameraBuffer = buffer(
      320,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.cameraLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.cameraGroup = d.createBindGroup({
      layout: this.cameraLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });
    this.simLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        ...[1, 2, 3].map((binding) => ({
          binding,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        })),
      ],
    });
    this.simGroup = d.createBindGroup({
      layout: this.simLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer } },
        { binding: 1, resource: { buffer: this.solver.buffers.particles } },
        { binding: 2, resource: { buffer: this.solver.buffers.cells } },
        { binding: 3, resource: { buffer: this.solver.buffers.drops } },
      ],
    });
    const module = d.createShaderModule({ code: common + "\n" + viewSource });
    const errors = (await module.getCompilationInfo()).messages.filter(
      (m) => m.type === "error",
    );
    if (errors.length) throw new Error(errors.map((m) => m.message).join("\n"));
    const simPipelineLayout = d.createPipelineLayout({
      bindGroupLayouts: [this.simLayout],
    });
    const pipeline = async (v, f, format, depth = false, blend) =>
      d.createRenderPipelineAsync({
        layout: simPipelineLayout,
        vertex: { module, entryPoint: v },
        fragment: {
          module,
          entryPoint: f,
          targets: [{ format, ...(blend ? { blend } : {}) }],
        },
        primitive: { topology: "triangle-list" },
        ...(depth
          ? {
              depthStencil: {
                format: "depth32float",
                depthWriteEnabled: true,
                depthCompare: "less-equal",
              },
            }
          : {}),
      });
    this.powder = await pipeline(
      "powderVertex",
      "powderFragment",
      "rgba8unorm",
      true,
    );
    this.fluidDepth = await pipeline(
      "liquidVertex",
      "liquidDepth",
      "rgba16float",
      true,
    );
    this.fluidThickness = await pipeline(
      "liquidVertex",
      "thickness",
      "rgba16float",
      false,
      {
        color: { operation: "add", srcFactor: "one", dstFactor: "one" },
        alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
      },
    );
    this.postLayout = d.createBindGroupLayout({
      entries: [0, 1, 2].map((binding) => ({
        binding,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      })),
    });
    const postPipelineLayout = d.createPipelineLayout({
      bindGroupLayouts: [this.cameraLayout, this.postLayout],
    });
    const post = async (entry, format, axis = [1, 0]) => {
      const mod = d.createShaderModule({
        code:
          `const AXIS_X:i32=${axis[0]};const AXIS_Y:i32=${axis[1]};\n` +
          postSource,
      });
      const info = await mod.getCompilationInfo();
      if (info.messages.some((m) => m.type === "error"))
        throw new Error(info.messages.map((m) => m.message).join("\n"));
      return d.createRenderPipelineAsync({
        layout: postPipelineLayout,
        vertex: { module: mod, entryPoint: "quad" },
        fragment: { module: mod, entryPoint: entry, targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
    };
    this.copy = await post("copy", "rgba8unorm");
    this.blurX = await post("bilateral", "rgba16float", [1, 0]);
    this.blurY = await post("bilateral", "rgba16float", [0, 1]);
    this.compose = await post("composite", this.format);
    this.modelLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: 80,
          },
        },
      ],
    });
    const depthModule = d.createShaderModule({
      code: `struct Camera {vp:mat4x4<f32>,view:mat4x4<f32>,ip:mat4x4<f32>,projection:mat4x4<f32>,screen:vec4<f32>,domain:vec4<f32>,optics:vec4<f32>,counts:vec4<u32>}
      struct Object {model:mat4x4<f32>,clip:vec4<f32>}
      @group(0) @binding(0) var<uniform> camera:Camera;@group(1) @binding(0) var<uniform> object:Object;
      struct Varying {@builtin(position) position:vec4<f32>,@location(0) world:vec3<f32>}
      @vertex fn vertex(@location(0) p:vec3<f32>)->Varying {let w=object.model*vec4<f32>(p,1);let c=camera.vp*w;var o:Varying;o.position=vec4<f32>(c.xy,(c.z+c.w)*.5,c.w);o.world=w.xyz;return o;}
      @fragment fn fragment(in:Varying){if(object.clip.x>.5&&in.world.z>0.){discard;}}`,
    });
    this.depthPipeline = await d.createRenderPipelineAsync({
      layout: d.createPipelineLayout({
        bindGroupLayouts: [this.cameraLayout, this.modelLayout],
      }),
      vertex: {
        module: depthModule,
        entryPoint: "vertex",
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
          },
        ],
      },
      fragment: { module: depthModule, entryPoint: "fragment", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
    const excluded = new Set([
      this.scene.bed.skin,
      this.scene.bed.cap,
      ...this.scene.liquid.strands.map((s) => s.mesh),
      this.scene.liquid.drops,
    ]);
    this.scene.scene.traverse((o) => {
      if (
        !o.isMesh ||
        o.isInstancedMesh ||
        excluded.has(o) ||
        !o.geometry ||
        !o.material ||
        Array.isArray(o.material) ||
        o.material.colorWrite === false ||
        o.material.stencilWrite ||
        o.material.transparent
      )
        return;
      const position = o.geometry.getAttribute("position");
      if (!position) return;
      const positions = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        positions[i * 3] = position.getX(i);
        positions[i * 3 + 1] = position.getY(i);
        positions[i * 3 + 2] = position.getZ(i);
      }
      const vb = buffer(
        positions.byteLength,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      );
      d.queue.writeBuffer(vb, 0, positions);
      let ib = null,
        indexFormat = null;
      if (o.geometry.index) {
        const original = o.geometry.index.array,
          indices =
            original instanceof Uint32Array
              ? original
              : new Uint32Array(original);
        ib = buffer(
          indices.byteLength,
          GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        );
        d.queue.writeBuffer(ib, 0, indices);
        indexFormat = "uint32";
      }
      this.meshes.push({
        object: o,
        vb,
        ib,
        indexFormat,
        count: o.geometry.index?.count ?? position.count,
      });
    });
    this.models = buffer(
      Math.max(1, this.meshes.length) * 256,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    this.modelGroup = d.createBindGroup({
      layout: this.modelLayout,
      entries: [{ binding: 0, resource: { buffer: this.models, size: 80 } }],
    });
    if (this.disposed) throw new DOMException("View cancelled", "AbortError");
    this.scene.setGpuView(this);
    return this;
  }
  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.textures.forEach((t) => t.destroy());
    this.textures = [];
    const texture = (format, extra = 0) => {
      const t = this.device.createTexture({
        size: [w, h],
        format,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          extra,
      });
      this.textures.push(t);
      return t;
    };
    if (this.presentBuffer) {
      this.presentBuffer.destroy();
      this.presentBuffer = null;
    }
    if (this.softwarePresentation) {
      this.presentTexture = texture("rgba8unorm", GPUTextureUsage.COPY_SRC);
      this.presentBytesPerRow = Math.ceil((w * 4) / 256) * 256;
      this.presentBuffer = this.device.createBuffer({
        size: this.presentBytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    this.source = texture("rgba8unorm", GPUTextureUsage.COPY_DST);
    this.base = texture("rgba8unorm");
    this.depth = texture("depth32float");
    this.front = texture("rgba16float", GPUTextureUsage.COPY_SRC);
    this.thickness = texture("rgba16float");
    this.blurA = texture("rgba16float");
    this.blurB = texture("rgba16float");
    const group = (base, depth) =>
      this.device.createBindGroup({
        layout: this.postLayout,
        entries: [
          { binding: 0, resource: base.createView() },
          { binding: 1, resource: depth.createView() },
          { binding: 2, resource: this.thickness.createView() },
        ],
      });
    this.copyGroup = group(this.source, this.front);
    this.blurXGroup = group(this.base, this.front);
    this.blurYGroup = group(this.base, this.blurA);
    this.compositeGroup = group(this.base, this.blurB);
  }
  render() {
    if (
      this.disposed ||
      !this.enabled ||
      this.solver.disposed ||
      this.presenting
    )
      return;
    const s = this.scene,
      d = this.device,
      w = s.renderer.domElement.width,
      h = s.renderer.domElement.height;
    if (!w || !h) return;
    this.resize(w, h);
    const camera = s.camera;
    const data = new ArrayBuffer(320),
      f = new Float32Array(data),
      u = new Uint32Array(data);
    f.set(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ).elements,
      0,
    );
    f.set(camera.matrixWorldInverse.elements, 16);
    f.set(camera.projectionMatrixInverse.elements, 32);
    f.set(camera.projectionMatrix.elements, 48);
    f.set([w, h, s.cutaway ? 1 : 0, 0], 64);
    f.set([0.032, 0.006, 1.318, 17], 68);
    f.set([0, 0, 0.064 / this.solver.hydroDimension, 0], 72);
    u.set(
      [
        this.solver.particleCount,
        this.solver.hydroDimension,
        this.solver.fluidCount,
        0,
      ],
      76,
    );
    d.queue.writeBuffer(this.cameraBuffer, 0, data);
    const modelData = new Float32Array(this.meshes.length * 64);
    this.meshes.forEach(({ object }, i) => {
      modelData.set(object.matrixWorld.elements, i * 64);
      modelData[i * 64 + 16] = object.material.clippingPlanes?.length ? 1 : 0;
    });
    d.queue.writeBuffer(this.models, 0, modelData);
    // Some software adapters cannot import a WebGL canvas into Dawn. Fall back
    // to a color-only readback; particle positions never cross the CPU boundary.
    if (!this.colorReadback) {
      try {
        d.queue.copyExternalImageToTexture(
          { source: s.renderer.domElement },
          { texture: this.source },
          [w, h],
        );
      } catch {
        this.colorReadback = true;
      }
    }
    if (this.colorReadback) {
      if (this.colorPixels?.length !== w * h * 4) {
        this.colorPixels = new Uint8Array(w * h * 4);
        this.colorFlipped = new Uint8Array(w * h * 4);
      }
      const gl = s.renderer.getContext();
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.colorPixels);
      for (let y = 0; y < h; y++)
        this.colorFlipped.set(
          this.colorPixels.subarray(y * w * 4, (y + 1) * w * 4),
          (h - 1 - y) * w * 4,
        );
      d.queue.writeTexture(
        { texture: this.source },
        this.colorFlipped,
        { bytesPerRow: w * 4, rowsPerImage: h },
        [w, h],
      );
    }
    const command = d.createCommandEncoder();
    let pass = command.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1,
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.depthPipeline);
    pass.setBindGroup(0, this.cameraGroup);
    this.meshes.forEach(({ object, vb, ib, indexFormat, count }, i) => {
      let visible = true;
      for (let p = object; p; p = p.parent) if (!p.visible) visible = false;
      if (!visible) return;
      pass.setBindGroup(1, this.modelGroup, [i * 256]);
      pass.setVertexBuffer(0, vb);
      if (ib) {
        pass.setIndexBuffer(ib, indexFormat);
        pass.drawIndexed(count);
      } else pass.draw(count);
    });
    pass.end();
    const full = (pipeline, group, texture) => {
      const p = command.beginRenderPass({
        colorAttachments: [
          {
            view: texture.createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          },
        ],
      });
      p.setPipeline(pipeline);
      p.setBindGroup(0, this.cameraGroup);
      p.setBindGroup(1, group);
      p.draw(3);
      p.end();
    };
    full(this.copy, this.copyGroup, this.base);
    pass = command.beginRenderPass({
      colorAttachments: [
        { view: this.base.createView(), loadOp: "load", storeOp: "store" },
      ],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.powder);
    pass.setBindGroup(0, this.simGroup);
    pass.draw(6, this.solver.particleCount);
    pass.end();
    pass = command.beginRenderPass({
      colorAttachments: [
        {
          view: this.front.createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depth.createView(),
        depthLoadOp: "load",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(this.fluidDepth);
    pass.setBindGroup(0, this.simGroup);
    pass.draw(6, this.solver.fluidCount);
    pass.end();
    pass = command.beginRenderPass({
      colorAttachments: [
        {
          view: this.thickness.createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.fluidThickness);
    pass.setBindGroup(0, this.simGroup);
    pass.draw(6, this.solver.fluidCount);
    pass.end();
    full(this.blurX, this.blurXGroup, this.blurA);
    full(this.blurY, this.blurYGroup, this.blurB);
    full(
      this.compose,
      this.compositeGroup,
      this.softwarePresentation
        ? this.presentTexture
        : this.context.getCurrentTexture(),
    );
    if (this.softwarePresentation)
      command.copyTextureToBuffer(
        { texture: this.presentTexture },
        {
          buffer: this.presentBuffer,
          bytesPerRow: this.presentBytesPerRow,
          rowsPerImage: h,
        },
        [w, h],
      );
    d.queue.submit([command.finish()]);
    if (this.softwarePresentation) this.presentColor(w, h);
  }
  async presentColor(w, h) {
    this.presenting = true;
    try {
      await this.presentBuffer.mapAsync(GPUMapMode.READ);
      if (this.disposed) return;
      const padded = new Uint8Array(this.presentBuffer.getMappedRange()),
        pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        pixels.set(
          padded.subarray(
            y * this.presentBytesPerRow,
            y * this.presentBytesPerRow + w * 4,
          ),
          y * w * 4,
        );
      this.context.putImageData(new ImageData(pixels, w, h), 0, 0);
    } catch (error) {
      if (!this.disposed) {
        this.enabled = false;
        this.onError?.(error);
      }
    } finally {
      if (this.presentBuffer?.mapState === "mapped") this.presentBuffer.unmap();
      this.presenting = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.scene.gpuView === this) this.scene.setGpuView(null);
    this.textures.forEach((t) => t.destroy());
    this.resources.forEach((b) => b.destroy());
    this.presentBuffer?.destroy();
    if (!this.softwarePresentation) this.context.unconfigure();
    this.canvas.remove();
  }
}
