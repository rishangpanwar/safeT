/**
 * Four-Stage Biomechanical Fall & Traumatic Impact detector (report §2.2-B).
 * Pure TypeScript — fed 50 Hz accelerometer (g) + gyroscope (°/s) samples.
 *
 *   SVM(t)  = √(ax² + ay² + az²)                                   (Eq. 2.3)
 *   Jerk(t) = |SVM(t) − SVM(t − Δt)| / Δt                           (Eq. 2.4)
 *   Ω(t)    = √(ωx² + ωy² + ωz²)
 *   θ(t)    = arccos(a_z / SVM) · 180/π                              (Eq. 2.5)
 *
 * Eq. 2.5 assumes the device z-axis is vertical when upright. A phone in a pocket is
 * usually upright along y, so θ is measured against the gravity vector observed just
 * before the fall (identical to Eq. 2.5 when that vector lies on z).
 *
 * Low-energy collapse path. Someone who faints or arrests while standing crumples: the knees
 * buckle (|a| only dips to ~0.6–0.8 g, never below the 0.5 g free-fall line) and the impact is
 * soft (~2–3 g). The accuracy evaluation showed the four-stage path missing every such collapse.
 * So an impact ≥ 1.8 g with rotation ≥ 100 °/s right after partial unloading (< 0.85 g) also
 * opens Stage 3–4. Because that evidence is weaker, Stage 4 then needs 20 s instead of 10 s and
 * no voluntary rotation (|ω| < 20 °/s): a person flopping down to rest shifts and turns, an
 * unconscious one does not.
 */

export interface MotionSample {
  t: number; // ms
  ax: number; ay: number; az: number; // g
  gx: number; gy: number; gz: number; // °/s
}

export type FallStage = 'idle' | 'free_fall' | 'impact_window' | 'rebound' | 'immobility_check';

export interface FallEvent {
  confirmedAt: number;
  freeFallMs: number;
  fallFromHeight: boolean; // free fall longer than the 400 ms slip/trip envelope
  lowEnergy: boolean; // collapse without free fall (syncope, cardiac arrest while standing)
  peakSvm: number;
  peakJerk: number;
  peakOmega: number;
  tiltDeg: number;
  svmVariance: number;
}

export const FALL_THRESHOLDS = {
  freeFallSvm: 0.5, // g
  freeFallMinMs: 100,
  freeFallMaxMs: 400,
  impactSvm: 3.2, // g
  impactJerk: 18, // g/s
  impactOmega: 250, // °/s
  impactWindowMs: 1000, // impact must follow free fall within this time
  reboundMs: 500,
  observationMs: 10_000,
  lyingTiltDeg: 60,
  immobileVariance: 0.02, // σ²_SVM
  abortVariance: 0.1, // vigorous motion ≥ 3 s into Stage 4 (running on) ends the observation early
  // Low-energy collapse path
  collapseUnloadSvm: 0.85, // g, minimum over the preceding second (knees buckling)
  collapseImpactSvm: 1.8, // g
  collapseOmega: 100, // °/s
  collapseObservationMs: 20_000,
  collapseMaxOmega: 20, // °/s, no voluntary rotation while lying
};

const svmOf = (s: MotionSample) => Math.sqrt(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
const omegaOf = (s: MotionSample) => Math.sqrt(s.gx * s.gx + s.gy * s.gy + s.gz * s.gz);

function angleDeg(a: [number, number, number], b: [number, number, number]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  if (na === 0 || nb === 0) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / (na * nb)))) * 180) / Math.PI;
}

export class FallDetector {
  stage: FallStage = 'idle';
  private th: typeof FALL_THRESHOLDS;
  private prev: MotionSample | null = null;
  private recent: MotionSample[] = []; // ~1 s of history for the upright reference
  private uprightRef: [number, number, number] = [0, 0, 1];
  private freeFallStart = 0;
  private freeFallMs = 0;
  private stageStart = 0;
  private peak = { svm: 0, jerk: 0, omega: 0 };
  private observation: MotionSample[] = [];
  private obsSum = 0; // running Σ SVM and Σ SVM² over the observation, for the early abort
  private obsSumSq = 0;
  private obsMaxOmega = 0;
  private lowEnergy = false;

  /** `overrides` lets the accuracy evaluation run variants (e.g. the four-stage path alone). */
  constructor(
    private onFall: (e: FallEvent) => void,
    private onStage?: (s: FallStage) => void,
    overrides: Partial<typeof FALL_THRESHOLDS> = {}
  ) {
    this.th = { ...FALL_THRESHOLDS, ...overrides };
  }

  private go(stage: FallStage, t: number) {
    this.stage = stage;
    this.stageStart = t;
    this.onStage?.(stage);
  }

  reset() {
    this.go('idle', this.prev?.t ?? 0);
    this.peak = { svm: 0, jerk: 0, omega: 0 };
    this.observation = [];
    this.lowEnergy = false;
  }

  /** Upright reference = mean gravity over the preceding second. */
  private captureUpright() {
    const n = this.recent.length;
    if (n > 5) {
      const sum = this.recent.reduce((acc, r) => [acc[0] + r.ax, acc[1] + r.ay, acc[2] + r.az], [0, 0, 0]);
      this.uprightRef = [sum[0] / n, sum[1] / n, sum[2] / n];
    }
  }

  push(s: MotionSample) {
    const svm = svmOf(s);
    const omega = omegaOf(s);
    const dt = this.prev ? (s.t - this.prev.t) / 1000 : 0;
    const jerk = this.prev && dt > 0 ? Math.abs(svm - svmOf(this.prev)) / dt : 0;
    this.prev = s;

    switch (this.stage) {
      case 'idle': {
        while (this.recent.length && s.t - this.recent[0].t > 1000) this.recent.shift();
        const unloaded = this.recent.some((r) => svmOf(r) < this.th.collapseUnloadSvm);
        this.recent.push(s);
        if (svm < this.th.freeFallSvm) {
          this.captureUpright();
          this.freeFallStart = s.t;
          this.go('free_fall', s.t);
        } else if (unloaded && svm >= this.th.collapseImpactSvm && omega >= this.th.collapseOmega) {
          // Low-energy collapse: buckling then a soft impact, with no free fall.
          this.captureUpright();
          this.lowEnergy = true;
          this.freeFallMs = 0;
          this.peak = { svm, jerk, omega };
          this.go('rebound', s.t);
        }
        break;
      }

      // Stage 1 — free-fall weightlessness
      case 'free_fall': {
        this.peak.omega = Math.max(this.peak.omega, omega); // rotation while tumbling
        if (svm < this.th.freeFallSvm) break;
        this.freeFallMs = s.t - this.freeFallStart;
        if (this.freeFallMs < this.th.freeFallMinMs) {
          this.reset(); // a hop or a jolt, not a fall
          break;
        }
        this.peak = { svm, jerk, omega: Math.max(this.peak.omega, omega) };
        this.go('impact_window', s.t);
        this.checkImpact();
        break;
      }

      // Stage 2 — traumatic impact shock
      case 'impact_window': {
        this.peak.svm = Math.max(this.peak.svm, svm);
        this.peak.jerk = Math.max(this.peak.jerk, jerk);
        this.peak.omega = Math.max(this.peak.omega, omega);
        if (!this.checkImpact() && s.t - this.stageStart > this.th.impactWindowMs) this.reset();
        break;
      }

      // Stage 3 — rebound / damping
      case 'rebound': {
        if (s.t - this.stageStart >= this.th.reboundMs) {
          this.observation = [];
          this.obsSum = 0;
          this.obsSumSq = 0;
          this.obsMaxOmega = 0;
          this.go('immobility_check', s.t);
        }
        break;
      }

      // Stage 4 — post-impact immobility & lying posture
      case 'immobility_check': {
        this.observation.push(s);
        this.obsSum += svm;
        this.obsSumSq += svm * svm;
        this.obsMaxOmega = Math.max(this.obsMaxOmega, omega);
        const elapsed = s.t - this.stageStart;
        const count = this.observation.length;
        const runningVariance = this.obsSumSq / count - (this.obsSum / count) ** 2;
        if (elapsed >= 3000 && runningVariance > this.th.abortVariance) {
          this.reset(); // clearly moving again (running on, walking off)
          break;
        }
        if (elapsed < (this.lowEnergy ? this.th.collapseObservationMs : this.th.observationMs)) break;

        const svms = this.observation.map(svmOf);
        const mean = svms.reduce((a, b) => a + b, 0) / svms.length;
        const variance = svms.reduce((a, b) => a + (b - mean) ** 2, 0) / svms.length;
        const n = this.observation.length;
        const g = this.observation.reduce((acc, r) => [acc[0] + r.ax, acc[1] + r.ay, acc[2] + r.az], [0, 0, 0]);
        const tilt = angleDeg(this.uprightRef, [g[0] / n, g[1] / n, g[2] / n]);
        const motionless = variance < this.th.immobileVariance && (!this.lowEnergy || this.obsMaxOmega < this.th.collapseMaxOmega);

        if (tilt > this.th.lyingTiltDeg && motionless) {
          this.onFall({
            confirmedAt: s.t,
            freeFallMs: this.freeFallMs,
            fallFromHeight: this.freeFallMs > this.th.freeFallMaxMs,
            lowEnergy: this.lowEnergy,
            peakSvm: round(this.peak.svm),
            peakJerk: round(this.peak.jerk),
            peakOmega: round(this.peak.omega),
            tiltDeg: round(tilt),
            svmVariance: round(variance, 4),
          });
        }
        this.reset();
        break;
      }
    }
  }

  private checkImpact(): boolean {
    const p = this.peak;
    if (p.svm >= this.th.impactSvm && p.jerk > this.th.impactJerk && p.omega > this.th.impactOmega) {
      this.go('rebound', this.prev!.t);
      return true;
    }
    return false;
  }
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
