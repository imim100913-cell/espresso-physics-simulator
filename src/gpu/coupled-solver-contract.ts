/** Architecture contract, NOT a production MLS-MPM/XPBD implementation.
 * All compute stages must pass a conservation test before this can power reports. */
export type Vec3 = readonly [number, number, number];
export interface SolverConfig {
  particleCount: number;
  grid: Vec3;
  dxMeters: number;
  bulkDensityKgM3: number;
  shearModulusPa: number;
  lameLambdaPa: number;
  frictionAngleRadians: number;
  waterViscosityPaS: number;
  maxMechanicalSubsteps: number;
}
export interface FrameBudget {
  seconds: number;
  availableGpuMilliseconds: number;
}
export interface Diagnostics {
  dryMassKg: number;
  waterInKg: number;
  waterOutKg: number;
  waterStoredKg: number;
  dissolvedSolidsKg: number;
  maxVelocityMS: number;
  minDetF: number;
  nanCount: number;
  residualL2: number;
  simulatedSeconds: number;
}
export interface CoupledSolver {
  // GPU-resident render buffers: do not copy 500k particle positions through JS.
  getRenderBuffers(): {
    positions: GPUBuffer;
    saturation: GPUBuffer;
    solute: GPUBuffer;
  };
  advance(
    config: FrameBudget,
  ): Promise<{ consumedSimulatedSeconds: number; diagnostics?: Diagnostics }>;
  setMachineBoundary(input: {
    pressurePa: number;
    temperatureK: number;
    tampDisplacementMeters: number;
    wdtPose?: Float32Array;
  }): void;
  dispose(): void;
}
export const computeStages = [
  "resetGrid",
  "hashParticles",
  "prefixScan",
  "sortParticleIndices",
  "updateDeformationGradient",
  "svdAndDruckerPragerReturnMap",
  "gatherParticleMassAndMomentum",
  "gridForcesAndSolidContact",
  "richardsPressureSolve",
  "conservativeWaterAndSoluteFlux",
  "twoWayDragMomentumExchange",
  "g2pApic",
  "liquidHash",
  "xpbdDensityAndContactIterations",
  "viscosityAndSurfaceTension",
  "reduceConservationDiagnostics",
] as const;
export function mechanicalTimeStep(
  c: SolverConfig,
  maxVelocityMS: number,
): number {
  const waveSpeed = Math.sqrt(
    (c.lameLambdaPa + 2 * c.shearModulusPa) / c.bulkDensityKgM3,
  );
  return (0.3 * c.dxMeters) / (waveSpeed + Math.max(0, maxVelocityMS));
}
// Deliberately rejects unsupported requests instead of substituting cosmetic motion.
export function createCoupledSolver(
  _device: GPUDevice,
  _config: SolverConfig,
): never {
  throw new Error(
    "MLS-MPM/XPBD constitutive, pressure, and coupling passes are a planned implementation; use the isolated wetting reference for current GPU experiments.",
  );
}
