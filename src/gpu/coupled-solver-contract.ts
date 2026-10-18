/** Public interface for the implemented GPU solver. SI units unless labelled. */
export interface SolverOptions {
  particleCount?: number; // 128..500000
  fluidCount?: number; // 32..8192
  gridDimension?: 16 | 32 | 48;
  preparationSeconds?: number;
  hydraulicDt?: number;
  fluidDt?: number;
  recipe?: {
    dose?: number;
    grindSize?: number;
    waterTemp?: number;
    maxPressure?: number;
    targetYield?: number;
    tampForce?: number;
  };
  adapter?: GPUAdapter;
  device?: GPUDevice;
  onLost?: (message: string) => void;
}
export interface Diagnostics {
  particleCount: number;
  fluidCapacity: number;
  mechanicsSeconds: number;
  preparationProgress: number;
  hydraulicSeconds: number;
  liquidSeconds: number;
  dryMassKg: number;
  meanHeightMeters: number;
  plasticStrain: number;
  maxVelocityMS: number;
  minDetF: number;
  nanCount: number;
  meanPorosity: number;
  channelRiskPercent: number;
  waterInKg: number;
  outletSolutionKg: number;
  outletSoluteKg: number;
  dissolvedKg: number;
  storedWaterKg: number;
  storedSoluteKg: number;
  remainingSolubleKg: number;
  cupMassKg: number;
  cupSoluteKg: number;
  fallingMassKg: number;
  reservoirMassKg: number;
  waterErrorKg: number;
  coffeeErrorKg: number;
  liquidErrorKg: number;
  validationErrors: string[];
  complete: boolean;
  gpuBatchWallMilliseconds?: number;
}
export interface CoupledSolver {
  readonly device: GPUDevice;
  readonly particleCount: number;
  readonly latest: Diagnostics;
  getRenderBuffers(): {
    positions: GPUBuffer;
    saturation: GPUBuffer;
    solute: GPUBuffer;
    drops: GPUBuffer;
  };
  advance(options?: {
    mechanicalSubsteps?: number;
    hydraulicSteps?: number;
    pressure?: number;
  }): Promise<Diagnostics>;
  drain(options?: { steps?: number }): Promise<Diagnostics>;
  setMachineBoundary(boundary: { pressurePa?: number }): void;
  readParticles(limit?: number): Promise<Float32Array>;
  readCells(): Promise<Float32Array>;
  dispose(): void;
}
export { createCoupledSolver } from "./coupled-solver.js";
