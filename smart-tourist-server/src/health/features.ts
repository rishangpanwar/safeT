import { FeatureVector, createRng, SerializedForest, trainIsolationForest } from './isolationForest';
import { Avpu } from './mews';

/** One 1 Hz telemetry sample from the wearable + phone (report Tier 1). */
export interface VitalSample {
  t: number; // epoch ms
  hr?: number; // bpm (PPG)
  spo2?: number; // %
  skinTemp?: number; // °C
  rr?: number[]; // RR intervals in ms since last sample, when the band exposes them
  hrvRmssd?: number; // ms, when the band computes HRV itself
  mobility?: number; // std-dev of accelerometer SVM over the last second, in g
  altitude?: number; // m ASL (barometric / GNSS)
}

export interface WindowFeatures {
  vector: FeatureVector;
  named: { hr: number; deltaHr: number; spo2: number; hrvRmssd: number; skinTemp: number; mobility: number };
  latest: { hr?: number; spo2?: number; skinTemp?: number; altitude?: number };
  sampleCount: number;
  /**
   * Seconds the wearer has been continuously motionless (every sample's mobility below
   * IMMOBILE_MOBILITY), looking back over all the samples passed in, not just the 60 s window.
   */
  stillSeconds: number;
}

export const WINDOW_MS = 60_000;
/** `mobility` (σ of SVM, in g) below which the wearer is treated as motionless for AVPU. */
export const IMMOBILE_MOBILITY = 0.02;

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

/** RMSSD = √( mean( (RR_{i+1} − RR_i)² ) ) */
export function rmssd(rrIntervals: number[]): number | undefined {
  if (rrIntervals.length < 3) return undefined;
  let sum = 0;
  for (let i = 1; i < rrIntervals.length; i++) sum += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
  return Math.sqrt(sum / (rrIntervals.length - 1));
}

/** Length of the motionless run that ends at the newest sample (samples sorted by time). */
export function stillnessSeconds(sorted: VitalSample[]): number {
  const end = sorted.length ? sorted[sorted.length - 1].t : 0;
  let start = end;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i].mobility;
    if (typeof m !== 'number' || m >= IMMOBILE_MOBILITY) break;
    start = sorted[i].t;
  }
  return (end - start) / 1000;
}

const lastDefined = (samples: VitalSample[], key: keyof VitalSample) => {
  for (let i = samples.length - 1; i >= 0; i--) {
    const v = samples[i][key];
    if (typeof v === 'number') return v;
  }
  return undefined;
};

/**
 * Builds X = [HR, ΔHR, SpO2, HRV_RMSSD, Temp, KinematicMobility] from the samples in
 * the 60 s window ending at the newest sample. Missing channels fall back to neutral
 * population values so a band without (say) a thermistor still gets scored.
 */
export function extractWindowFeatures(samples: VitalSample[]): WindowFeatures | null {
  if (samples.length === 0) return null;
  const sorted = samples.slice().sort((a, b) => a.t - b.t);
  const end = sorted[sorted.length - 1].t;
  const win = sorted.filter((s) => s.t > end - WINDOW_MS);

  const hrs = win.map((s) => s.hr).filter((v): v is number => typeof v === 'number');
  const spo2s = win.map((s) => s.spo2).filter((v): v is number => typeof v === 'number');
  const temps = win.map((s) => s.skinTemp).filter((v): v is number => typeof v === 'number');
  const mobs = win.map((s) => s.mobility).filter((v): v is number => typeof v === 'number');
  const rr = win.flatMap((s) => s.rr ?? []);
  const bandHrv = win.map((s) => s.hrvRmssd).filter((v): v is number => typeof v === 'number');

  // ΔHR: change between the first and last 10 s of the window — sudden spikes/drops.
  const head = hrs.slice(0, Math.min(10, hrs.length));
  const tail = hrs.slice(-Math.min(10, hrs.length));
  const deltaHr = hrs.length >= 2 ? (mean(tail) ?? 0) - (mean(head) ?? 0) : 0;

  const named = {
    hr: mean(hrs) ?? 75,
    deltaHr,
    spo2: mean(spo2s) ?? 97,
    hrvRmssd: rmssd(rr) ?? mean(bandHrv) ?? 45,
    skinTemp: mean(temps) ?? 36.7,
    mobility: mean(mobs) ?? 0.1,
  };

  return {
    vector: [named.hr, named.deltaHr, named.spo2, named.hrvRmssd, named.skinTemp, named.mobility],
    named,
    latest: {
      hr: lastDefined(win, 'hr'),
      spo2: lastDefined(win, 'spo2'),
      skinTemp: lastDefined(win, 'skinTemp'),
      altitude: lastDefined(win, 'altitude'),
    },
    sampleCount: win.length,
    stillSeconds: stillnessSeconds(sorted),
  };
}

export type SelfCheckOutcome = 'none' | 'responded' | 'expired';

/**
 * Kinematic AVPU (Table 2.1, last row). The phone cannot ask questions, so responsiveness
 * is inferred from the self-check dialog and motion:
 *   responded to the prompt → Voice; prompt expired but limbs still moving → Pain;
 *   prompt expired and motionless → Unresponsive; otherwise Alert.
 */
export function inferAvpu(selfCheck: SelfCheckOutcome, mobility: number): Avpu {
  if (selfCheck === 'expired') return mobility < IMMOBILE_MOBILITY ? 'unresponsive' : 'pain';
  if (selfCheck === 'responded') return 'voice';
  return 'alert';
}

/**
 * Synthetic population baseline of healthy trekking physiology, spanning rest → strenuous
 * climbing and sea level → ~4,500 m. Labelled crisis data for remote tourism does not exist
 * (report §2.2-A.1), which is exactly why an unsupervised model is used: it only needs
 * examples of normal variability.
 */
export function generateHealthyBaseline(count = 4000, seed = 7): FeatureVector[] {
  const rng = createRng(seed);
  const gauss = () => {
    const u = Math.max(rng(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const rows: FeatureVector[] = [];
  for (let i = 0; i < count; i++) {
    const resting = rng() < 0.25;
    const exertion = resting ? rng() * 0.1 : 0.15 + rng() * 0.85; // 0 = rest, 1 = steep climb
    const altitude = rng(); // 0 = sea level, 1 ≈ 4,500 m (acclimatised)
    const fitness = rng(); // fitter trekkers have lower HR and higher HRV

    const hr = clamp(58 + 85 * exertion + 8 * altitude - 10 * fitness + 6 * gauss(), 46, 172);
    const deltaHr = (3 + 6 * exertion) * gauss();
    const spo2 = clamp(98.2 - 7 * altitude - 1.2 * exertion + 0.9 * gauss(), 88, 100);
    const hrv = clamp(62 - 34 * exertion - 10 * altitude + 15 * fitness + 7 * gauss(), 10, 120);
    const temp = clamp(36.55 + 0.6 * exertion + 0.2 * gauss(), 35.9, 37.7);
    const mobility = resting
      ? clamp(0.01 + 0.015 * Math.abs(gauss()), 0, 0.06)
      : clamp(0.08 + 0.45 * exertion + 0.06 * gauss(), 0.03, 0.9);

    rows.push([hr, deltaHr, spo2, hrv, temp, mobility]);
  }
  return rows;
}

/** The population forest the server ships to phones (t = 100, ψ = 256). The accuracy evaluation scores the same model. */
export function trainPopulationForest(): SerializedForest {
  return trainIsolationForest(generateHealthyBaseline(4000, 7), { numTrees: 100, subsampleSize: 256, seed: 42 });
}
