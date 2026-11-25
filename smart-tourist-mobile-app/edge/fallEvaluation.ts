/**
 * Accuracy evaluation of the four-stage fall detector (report §2.2-B).
 *
 * Synthetic 50 Hz accelerometer (g) + gyroscope (°/s) traces are generated for incapacitating
 * falls and for the everyday movements that fool naive threshold detectors. Every trace gets a
 * random phone orientation (pocket, chest, armband, hand…), so the detector's orientation-free
 * tilt reference is exercised too. Each trace is run through the real FallDetector.
 *
 * Positives are falls that leave the person down: a trip/slip, a fall from height, and a
 * syncope-style collapse. Negatives include a fall the person gets up from, because the
 * detector's job is "fall with incapacitation". All traces are synthetic: the numbers show how
 * the algorithm behaves, not field accuracy.
 */
import { FALL_THRESHOLDS, FallDetector, MotionSample } from './fallDetection';

type Vec = [number, number, number];
interface Frame {
  a: Vec; // specific force in the body frame (z = up when standing), g
  w: number; // angular speed, °/s
}

const DT = 20; // ms → 50 Hz

export const POSITIVE_CLASSES = ['trip_fall', 'fall_from_height', 'collapse'] as const;
export const NEGATIVE_CLASSES = [
  'walking', 'running', 'jumping', 'sit_down_hard', 'lie_down_to_rest', 'flop_down_to_rest', 'phone_drop', 'fall_then_recover',
] as const;
export type MotionClass = (typeof POSITIVE_CLASSES)[number] | (typeof NEGATIVE_CLASSES)[number];

export const CLASS_LABELS: Record<MotionClass, string> = {
  trip_fall: 'Trip / slip fall, stays down',
  fall_from_height: 'Fall from height, stays down',
  collapse: 'Collapse (syncope), stays down',
  walking: 'Walking',
  running: 'Running',
  jumping: 'Jumping',
  sit_down_hard: 'Sitting down hard',
  lie_down_to_rest: 'Lying down to rest',
  flop_down_to_rest: 'Flopping down to rest (awake)',
  phone_drop: 'Phone dropped on the ground',
  fall_then_recover: 'Fall, then gets up',
};

/** mulberry32 — the same seedable PRNG the server uses. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gen {
  frames: Frame[] = [];
  constructor(private r: () => number) {}
  u(lo: number, hi: number) { return lo + (hi - lo) * this.r(); }
  n(sd: number) { return (this.r() + this.r() + this.r() - 1.5) * sd * 1.4; }
  count(ms: number) { return Math.max(1, Math.round(ms / DT)); }

  /** Gravity direction for a body tilted θ° from upright, towards azimuth φ. */
  posture(thetaDeg: number, phi = this.u(0, 2 * Math.PI)): Vec {
    const t = (thetaDeg * Math.PI) / 180;
    return [Math.sin(t) * Math.cos(phi), Math.sin(t) * Math.sin(phi), Math.cos(t)];
  }

  still(ms: number, g: Vec, sd = 0.006, w = 2) {
    for (let i = 0; i < this.count(ms); i++) this.frames.push({ a: [g[0] + this.n(sd), g[1] + this.n(sd), g[2] + this.n(sd)], w: Math.abs(this.n(w)) });
  }

  walk(ms: number) {
    const f = this.u(1.6, 2.1); // steps per second
    const amp = this.u(0.2, 0.4);
    const w0 = this.u(20, 60);
    const p = this.u(0, 6.28);
    for (let i = 0; i < this.count(ms); i++) {
      const t = (i * DT) / 1000;
      this.frames.push({
        a: [0.15 * Math.sin(Math.PI * f * t + p) + this.n(0.03), 0.1 * Math.sin(Math.PI * f * t + 1 + p) + this.n(0.03), 1 + amp * Math.sin(2 * Math.PI * f * t + p) + this.n(0.04)],
        w: w0 * (0.6 + 0.4 * Math.abs(Math.sin(Math.PI * f * t))) + Math.abs(this.n(5)),
      });
    }
  }

  /** Each stride: a short flight phase (< 0.5 g, like a free fall) and a hard landing. */
  run(ms: number) {
    const stepMs = 1000 / this.u(2.6, 3.0);
    const w0 = this.u(80, 260);
    let left = ms;
    while (left > 0) {
      const flight = this.u(60, 115);
      for (let i = 0; i < this.count(flight); i++) this.frames.push({ a: [this.n(0.05), this.n(0.05), this.u(0.15, 0.4)], w: w0 * this.u(0.7, 1) });
      const peak = this.u(2.4, 3.6);
      [1, 0.7, 0.45].forEach((k) => this.frames.push({ a: [this.n(0.2), this.n(0.2), peak * k], w: w0 * this.u(0.8, 1.1) }));
      for (let i = 0; i < this.count(stepMs - flight - 60); i++) this.frames.push({ a: [0.3 * Math.sin(i) + this.n(0.05), this.n(0.08), 1.25 + this.n(0.15)], w: w0 * this.u(0.5, 0.9) });
      left -= stepMs;
    }
  }

  /** Free fall (|a| ≈ 0) while tumbling, then an impact spike. */
  fall(freeFallMs: number, impactG: number, omega: number, ffLevel = this.u(0.05, 0.4)) {
    for (let i = 0; i < this.count(freeFallMs); i++) {
      this.frames.push({ a: [this.n(0.04) + ffLevel * 0.3, this.n(0.04), ffLevel], w: omega * this.u(0.85, 1.1) });
    }
    this.impact(impactG, omega);
  }

  impact(impactG: number, omega: number) {
    const d = this.posture(45);
    [1, 0.55, 0.3].forEach((k, i) => this.frames.push({ a: [d[0] * impactG * k, d[1] * impactG * k, d[2] * impactG * k + 0.2], w: omega * (i === 0 ? 1.05 : 0.6) }));
  }

  /** Decaying oscillation while the body settles into its new posture. */
  settle(ms: number, g: Vec, amp = 0.5) {
    const n = this.count(ms);
    for (let i = 0; i < n; i++) {
      const k = 1 - i / n;
      this.frames.push({ a: [g[0] + amp * k * Math.sin(i * 1.7), g[1] + amp * k * Math.cos(i * 1.3), g[2] + amp * k * Math.sin(i)], w: 150 * k + Math.abs(this.n(5)) });
    }
  }

  /** Slow change of posture (lying down, getting up) with small jolts. */
  transition(ms: number, from: Vec, to: Vec) {
    const n = this.count(ms);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const g: Vec = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
      const len = Math.hypot(...g) || 1;
      const mag = this.u(0.85, 1.2);
      this.frames.push({ a: [(g[0] / len) * mag + this.n(0.05), (g[1] / len) * mag + this.n(0.05), (g[2] / len) * mag + this.n(0.05)], w: this.u(20, 60) });
    }
  }
}

const UP: Vec = [0, 0, 1];

function scenario(cls: MotionClass, g: Gen): void {
  const lying = () => g.posture(g.u(65, 115));
  switch (cls) {
    case 'trip_fall': {
      g.walk(g.u(2000, 4000));
      const down = lying();
      g.fall(g.u(120, 380), g.u(3.3, 8), g.u(260, 520));
      g.settle(500, down);
      g.still(12_000, down, g.u(0.003, 0.008));
      return;
    }
    case 'fall_from_height': {
      g.walk(g.u(1500, 3000));
      const down = lying();
      g.fall(g.u(420, 900), g.u(5, 12), g.u(260, 600));
      g.settle(500, down);
      g.still(12_000, down, g.u(0.003, 0.008));
      return;
    }
    case 'collapse': {
      // Knees buckle: the body is only partly unloaded (0.55–0.8 g), never in true free fall.
      g.still(g.u(2000, 3000), UP, 0.03, 5);
      const down = lying();
      for (let i = 0; i < g.count(g.u(250, 600)); i++) g.frames.push({ a: [g.n(0.05), g.n(0.05), g.u(0.55, 0.8)], w: g.u(120, 320) });
      g.impact(g.u(1.8, 3.2), g.u(120, 320));
      g.settle(500, down, 0.3);
      g.still(22_000, down, g.u(0.003, 0.008));
      return;
    }
    case 'walking':
      g.walk(15_000);
      return;
    case 'running':
      g.run(15_000);
      return;
    case 'jumping': {
      g.still(1500, UP, 0.02, 5);
      for (let i = 0; i < g.count(250); i++) g.frames.push({ a: [g.n(0.05), g.n(0.05), 0.8], w: 30 });
      for (let i = 0; i < g.count(150); i++) g.frames.push({ a: [g.n(0.05), g.n(0.05), 2], w: 60 });
      g.fall(g.u(250, 450), g.u(3, 6), g.u(40, 300), g.u(0.05, 0.25));
      g.settle(300, UP, 0.3);
      if (g.u(0, 1) < 0.5) g.still(12_000, UP, 0.02, 5);
      else g.walk(12_000);
      return;
    }
    case 'sit_down_hard': {
      g.still(1500, UP, 0.02, 5);
      for (let i = 0; i < g.count(g.u(300, 500)); i++) g.frames.push({ a: [g.n(0.05), g.n(0.05), g.u(0.6, 0.85)], w: g.u(60, 180) });
      const seated = g.posture(g.u(10, 35));
      g.impact(g.u(1.8, 2.8), g.u(60, 180));
      g.settle(300, seated, 0.2);
      g.still(12_000, seated, 0.008);
      return;
    }
    case 'lie_down_to_rest': {
      g.still(1500, UP, 0.02, 5);
      const down = g.posture(g.u(75, 100));
      g.transition(g.u(2000, 4000), UP, down);
      g.still(15_000, down, 0.004);
      return;
    }
    case 'flop_down_to_rest': {
      // Drops onto the grass like a collapse, but is awake: settles in and shifts every few seconds.
      g.still(1500, UP, 0.02, 5);
      for (let i = 0; i < g.count(g.u(200, 400)); i++) g.frames.push({ a: [g.n(0.05), g.n(0.05), g.u(0.6, 0.85)], w: g.u(80, 200) });
      let posture = g.posture(g.u(70, 100));
      g.impact(g.u(1.8, 2.6), g.u(100, 220));
      g.settle(400, posture, 0.25);
      for (let left = 22_000; left > 0; ) {
        const ms = Math.min(left, g.u(3000, 12_000));
        g.still(ms, posture, 0.01, 3);
        left -= ms;
        if (left <= 0) break;
        const next = g.posture(g.u(70, 100));
        g.transition(600, posture, next);
        posture = next;
        left -= 600;
      }
      return;
    }
    case 'phone_drop': {
      // Hand-held, falls 0.3–1 m (250–450 ms), tumbles, bounces, lands in any orientation.
      g.still(1500, UP, 0.03, 8);
      g.fall(g.u(250, 450), g.u(4, 10), g.u(30, 700), g.u(0.01, 0.1));
      g.impact(g.u(1.5, 3), g.u(30, 300));
      const landed = g.posture((Math.acos(g.u(-1, 1)) * 180) / Math.PI);
      g.settle(200, landed, 0.2);
      g.still(13_000, landed, 0.002, 0.5);
      return;
    }
    case 'fall_then_recover': {
      g.walk(g.u(2000, 4000));
      const down = lying();
      g.fall(g.u(120, 380), g.u(3.3, 8), g.u(260, 520));
      g.settle(500, down);
      g.still(g.u(2000, 6000), down, 0.008);
      g.transition(2000, down, UP);
      g.walk(9000);
      return;
    }
  }
}

/** Random rotation (uniform on SO(3), Shoemake's method). */
function randomRotation(r: () => number): [Vec, Vec, Vec] {
  const [u1, u2, u3] = [r(), r(), r()];
  const x = Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2);
  const y = Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2);
  const z = Math.sqrt(u1) * Math.sin(2 * Math.PI * u3);
  const w = Math.sqrt(u1) * Math.cos(2 * Math.PI * u3);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/** One trace in device coordinates, with sensor noise. */
export function generateTrace(cls: MotionClass, r: () => number): MotionSample[] {
  const g = new Gen(r);
  scenario(cls, g);
  const R = randomRotation(r);
  const axis = (() => { const v: Vec = [r() - 0.5, r() - 0.5, r() - 0.5]; const l = Math.hypot(...v) || 1; return v.map((c) => c / l) as Vec; })();
  const noise = () => (r() + r() + r() - 1.5) * 0.014;
  return g.frames.map(({ a, w }, i) => ({
    t: i * DT,
    ax: R[0][0] * a[0] + R[0][1] * a[1] + R[0][2] * a[2] + noise(),
    ay: R[1][0] * a[0] + R[1][1] * a[1] + R[1][2] * a[2] + noise(),
    az: R[2][0] * a[0] + R[2][1] * a[1] + R[2][2] * a[2] + noise(),
    gx: axis[0] * w + noise() * 100,
    gy: axis[1] * w + noise() * 100,
    gz: axis[2] * w + noise() * 100,
  }));
}

/**
 * Detector variants compared on identical traces:
 *   fourStage — the report's four-stage path alone (§2.2-B)
 *   final     — as shipped: plus the low-energy collapse path and the early abort
 */
export const FALL_VARIANTS = {
  fourStage: { collapseImpactSvm: Infinity, abortVariance: Infinity },
  final: {},
} satisfies Record<string, Partial<typeof FALL_THRESHOLDS>>;
export type FallVariant = keyof typeof FALL_VARIANTS;

export interface FallClassResult {
  label: string;
  positive: boolean;
  traces: number;
  /** Traces flagged as an incapacitating fall, per variant. */
  flagged: Record<FallVariant, number>;
  flagRate: Record<FallVariant, number>;
}

export interface FallMetrics {
  tp: number; fp: number; tn: number; fn: number;
  accuracy: number; precision: number; recall: number; specificity: number; f1: number;
}

export interface FallEvalReport {
  generatedAt: string;
  config: { seed: number; tracesPerClass: number; sampleRateHz: number };
  perClass: Record<MotionClass, FallClassResult>;
  /** Pooled over all classes (equal traces per class, so the mix is a choice, not a prevalence). */
  overall: Record<FallVariant, FallMetrics>;
}

function metrics(c: { tp: number; fp: number; tn: number; fn: number }): FallMetrics {
  const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  return {
    ...c,
    accuracy: ratio(c.tp + c.tn, c.tp + c.fp + c.tn + c.fn),
    precision,
    recall,
    specificity: ratio(c.tn, c.tn + c.fp),
    f1: ratio(2 * precision * recall, precision + recall),
  };
}

export function evaluateFallDetector(options: { seed?: number; tracesPerClass?: number } = {}): FallEvalReport {
  const seed = options.seed ?? 2026;
  const tracesPerClass = options.tracesPerClass ?? 200;
  const r = createRng(seed);
  const variants = Object.keys(FALL_VARIANTS) as FallVariant[];
  const perClass = {} as Record<MotionClass, FallClassResult>;
  const counts = Object.fromEntries(variants.map((v) => [v, { tp: 0, fp: 0, tn: 0, fn: 0 }])) as Record<FallVariant, { tp: number; fp: number; tn: number; fn: number }>;

  for (const cls of [...POSITIVE_CLASSES, ...NEGATIVE_CLASSES] as MotionClass[]) {
    const positive = (POSITIVE_CLASSES as readonly string[]).includes(cls);
    const flagged = Object.fromEntries(variants.map((v) => [v, 0])) as Record<FallVariant, number>;
    for (let k = 0; k < tracesPerClass; k++) {
      const trace = generateTrace(cls, r);
      for (const v of variants) {
        let events = 0;
        const detector = new FallDetector(() => events++, undefined, FALL_VARIANTS[v]);
        for (const s of trace) detector.push(s);
        const hit = events > 0;
        if (hit) flagged[v]++;
        const c = counts[v];
        if (positive && hit) c.tp++;
        else if (positive) c.fn++;
        else if (hit) c.fp++;
        else c.tn++;
      }
    }
    perClass[cls] = {
      label: CLASS_LABELS[cls],
      positive,
      traces: tracesPerClass,
      flagged,
      flagRate: Object.fromEntries(variants.map((v) => [v, flagged[v] / tracesPerClass])) as Record<FallVariant, number>,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    config: { seed, tracesPerClass, sampleRateHz: 1000 / DT },
    perClass,
    overall: Object.fromEntries(variants.map((v) => [v, metrics(counts[v])])) as Record<FallVariant, FallMetrics>,
  };
}
