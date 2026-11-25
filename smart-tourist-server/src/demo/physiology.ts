/**
 * Synthetic wearable physiology shared by the CLI simulator (scripts/simulate-telemetry.ts)
 * and the live demo cohort (src/demo/demoMode.ts). Values follow the 1 Hz sample shape the
 * phone uploads, so everything downstream (Isolation Forest, MEWS, escalation) is the real pipeline.
 */

export type Scenario = 'normal' | 'ams' | 'cardiac' | 'hypothermia' | 'heatstroke' | 'fall';
export const SCENARIOS: Scenario[] = ['normal', 'ams', 'cardiac', 'hypothermia', 'heatstroke', 'fall'];

export interface PhysiologyOptions {
  altitude: number;
  /** Seconds the pathology takes to fully develop (p = s / onsetSeconds). */
  onsetSeconds: number;
  /** Per-person offsets so a cohort does not move in lock-step. */
  baseline?: { hr?: number; spo2?: number; skinTemp?: number; hrv?: number; phase?: number };
  /** Lying or sitting still (e.g. recovering in hospital): no walking bouts. */
  resting?: boolean;
  /** Random source in [0, 1). Defaults to Math.random; the accuracy evaluation passes a seeded one. */
  rng?: () => number;
}

export type Sample = {
  t: number;
  hr: number;
  spo2: number;
  skinTemp: number;
  hrvRmssd: number;
  mobility: number;
  altitude: number;
};

const noiseFrom = (rng: () => number) => (sd: number) => (rng() + rng() + rng() - 1.5) * sd * 1.4;
const lerp = (a: number, b: number, p: number) => a + (b - a) * Math.min(1, Math.max(0, p));

/** Vitals `s` seconds into a scenario. */
export function vitalsAt(scenario: Scenario, s: number, o: PhysiologyOptions) {
  const noise = noiseFrom(o.rng ?? Math.random);
  const b = o.baseline ?? {};
  const walking = !o.resting && Math.sin((s + (b.phase ?? 0)) / 40) > -0.6;
  // SpO₂ ≈ 97.5 % up to 1,500 m, ≈ 93.5 % at 2,500 m, then about −1 % per 600 m on acclimatised trekkers.
  const altitudeSpo2 = o.altitude > 2500 ? 93.5 - (o.altitude - 2500) / 600 : 97.5 - (4 * Math.max(0, o.altitude - 1500)) / 1000;
  const base = {
    hr: (walking ? 112 : 84) + (b.hr ?? 0) + noise(4),
    spo2: altitudeSpo2 + (b.spo2 ?? 0) + noise(0.6),
    skinTemp: 36.8 + (b.skinTemp ?? 0) + (walking ? 0.3 : 0) + noise(0.1),
    hrvRmssd: (walking ? 30 : 52) + (b.hrv ?? 0) + noise(4),
    mobility: walking ? 0.28 + noise(0.05) : 0.015 + Math.abs(noise(0.005)),
  };
  const p = s / Math.max(60, o.onsetSeconds);
  switch (scenario) {
    case 'ams':
      return { ...base, spo2: lerp(base.spo2, 72, p) + noise(0.8), hr: lerp(base.hr, 152, p) + noise(3), hrvRmssd: lerp(base.hrvRmssd, 11, p), mobility: lerp(base.mobility, 0.004, p * 1.3) };
    case 'cardiac': {
      const arrest = p > 0.75;
      return { ...base, hr: arrest ? 34 + noise(6) : lerp(base.hr, 188, p / 0.75) + noise(10), spo2: lerp(base.spo2, 79, p) + noise(1), hrvRmssd: arrest ? 140 + noise(30) : lerp(base.hrvRmssd, 8, p), mobility: arrest ? 0.002 : base.mobility };
    }
    case 'hypothermia':
      return { ...base, skinTemp: lerp(36.6, 34.1, p) + noise(0.05), hr: lerp(base.hr, 46, p) + noise(2), mobility: lerp(base.mobility, 0.05, p) + Math.abs(noise(0.02)) };
    case 'heatstroke':
      return { ...base, skinTemp: lerp(37.2, 40.6, p) + noise(0.05), hr: lerp(base.hr, 158, p) + noise(3), spo2: lerp(base.spo2, 92, p), mobility: lerp(base.mobility, 0.01, p) };
    case 'fall':
      return s < 20 ? base : { ...base, hr: 138 - Math.min(30, (s - 20) / 4) + noise(3), spo2: base.spo2 - 1.5 + noise(0.5), mobility: 0.003 + Math.abs(noise(0.001)) };
    default:
      return base;
  }
}

/** Rounded, clamped sample in the exact shape POST /api/health/:id/telemetry accepts. */
export function sampleAt(scenario: Scenario, s: number, t: number, o: PhysiologyOptions): Sample {
  const v = vitalsAt(scenario, s, o);
  return {
    t,
    hr: Math.round(Math.max(25, v.hr)),
    spo2: Math.round(Math.min(100, v.spo2) * 10) / 10,
    skinTemp: Math.round(v.skinTemp * 100) / 100,
    hrvRmssd: Math.round(Math.max(3, v.hrvRmssd)),
    mobility: Math.round(Math.max(0, v.mobility) * 1000) / 1000,
    altitude: o.altitude,
  };
}
