/**
 * Isolation Forest (Liu, Ting & Zhou, ICDM 2008) — unsupervised anomaly detection
 * over the multi-modal physiological feature vector
 *   X = [HR, ΔHR, SpO2, HRV_RMSSD, Temp, KinematicMobility]
 *
 * Report §2.2-A:
 *   c(n)    = 2(ln(n − 1) + γ) − 2(n − 1)/n                 (Eq. 2.1)
 *   s(x, n) = 2^( −E(h(x)) / c(n) )                          (Eq. 2.2)
 *   t = 100 trees, ψ = 256 sub-sample, h_max = ⌈log2 ψ⌉
 *
 * The trained forest serialises to plain JSON so the cloud can train it and the
 * mobile edge can score with it offline (see GET /api/health/model).
 *
 * Cardio-kinematic coupling: axis-parallel splits isolate values that are extreme on ONE
 * feature, but "motionless with a heart rate of 110" is only abnormal as a combination: 110 bpm
 * is ordinary for a walker, and stillness is ordinary at rest. The accuracy evaluation showed
 * the plain forest scoring such post-fall casualties as normal (s ≈ 0.5). Training therefore
 * fits HR ≈ a + b·Mobility by least squares on the healthy data and gives every tree one extra
 * dimension: the heart rate the current activity does not explain. X itself is unchanged, and
 * Eq. 2.1–2.2 still apply to the augmented point.
 */

export const FEATURE_NAMES = ['hr', 'deltaHr', 'spo2', 'hrvRmssd', 'skinTemp', 'mobility'] as const;
export type FeatureVector = number[]; // ordered as FEATURE_NAMES

const EULER_GAMMA = 0.5772156649;

/**
 * Decision thresholds on s(x, n), calibrated on the synthetic baseline:
 * normal trekking p99 ≈ 0.58, simulated collapses (hypoxia, syncope, heatstroke) ≈ 0.68–0.71.
 */
export const ANOMALY_WATCH = 0.6;
export const ANOMALY_CRITICAL = 0.66;
/** Geo-medical risk zones make the detector this much more sensitive. */
export const TERRAIN_SENSITIVITY_SHIFT = 0.03;

export type ITreeNode =
  | { s: number } // external node: size of the sample that reached it
  | { q: number; p: number; l: ITreeNode; r: ITreeNode }; // internal node: split attribute q at value p

/** HR ≈ intercept + slope · mobility, fitted on healthy training windows. */
export interface HrActivityCoupling {
  intercept: number;
  slope: number;
}

export interface SerializedForest {
  version: 1 | 2;
  features: readonly string[];
  numTrees: number;
  subsampleSize: number;
  trainedAt: string;
  trainingSize: number;
  /** Version 2: trees split on X plus the HR-activity residual (feature index 6). */
  coupling?: HrActivityCoupling;
  trees: ITreeNode[];
}

const HR = FEATURE_NAMES.indexOf('hr');
const MOBILITY = FEATURE_NAMES.indexOf('mobility');

/** Least-squares fit of heart rate on mobility (σ of SVM, g). */
export function fitHrActivityCoupling(data: FeatureVector[]): HrActivityCoupling {
  const n = data.length;
  const meanM = data.reduce((a, x) => a + x[MOBILITY], 0) / n;
  const meanHr = data.reduce((a, x) => a + x[HR], 0) / n;
  let cov = 0;
  let varM = 0;
  for (const x of data) {
    cov += (x[MOBILITY] - meanM) * (x[HR] - meanHr);
    varM += (x[MOBILITY] - meanM) ** 2;
  }
  const slope = varM > 0 ? cov / varM : 0;
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return { intercept: round(meanHr - slope * meanM), slope: round(slope) };
}

/** X → [X, HR − (a + b·Mobility)]: heart rate in excess of (or below) what the activity explains. */
export function augmentWithCoupling(x: FeatureVector, coupling?: HrActivityCoupling): FeatureVector {
  if (!coupling) return x;
  return [...x, x[HR] - (coupling.intercept + coupling.slope * x[MOBILITY])];
}

/** Eq. 2.1 — average path length of an unsuccessful BST search over n points. */
export function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + EULER_GAMMA) - (2 * (n - 1)) / n;
}

/** Small seedable PRNG (mulberry32) so trained forests are reproducible. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTree(data: FeatureVector[], depth: number, heightLimit: number, rng: () => number): ITreeNode {
  // Termination: (i) height limit, (ii) |X| ≤ 1
  if (depth >= heightLimit || data.length <= 1) return { s: data.length };

  const dims = data[0].length;
  // Only split on attributes that still vary; (iii) all-identical data terminates.
  const candidates: number[] = [];
  for (let q = 0; q < dims; q++) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of data) {
      if (row[q] < min) min = row[q];
      if (row[q] > max) max = row[q];
    }
    if (max > min) candidates.push(q);
  }
  if (candidates.length === 0) return { s: data.length };

  const q = candidates[Math.floor(rng() * candidates.length)];
  let min = Infinity;
  let max = -Infinity;
  for (const row of data) {
    if (row[q] < min) min = row[q];
    if (row[q] > max) max = row[q];
  }
  // Rounded to 3 dp: no effect on isolation, but keeps the JSON model small for the phone.
  const p = Math.round((min + rng() * (max - min)) * 1000) / 1000;

  const left: FeatureVector[] = [];
  const right: FeatureVector[] = [];
  for (const row of data) (row[q] < p ? left : right).push(row);

  return {
    q,
    p,
    l: buildTree(left, depth + 1, heightLimit, rng),
    r: buildTree(right, depth + 1, heightLimit, rng),
  };
}

/** h(x): edges from root to the terminating node, plus c(size) for unresolved leaves. */
export function pathLength(x: FeatureVector, node: ITreeNode, depth = 0): number {
  if ('s' in node) return depth + averagePathLength(node.s);
  return pathLength(x, x[node.q] < node.p ? node.l : node.r, depth + 1);
}

export function trainIsolationForest(
  rows: FeatureVector[],
  options: { numTrees?: number; subsampleSize?: number; seed?: number; coupling?: boolean } = {}
): SerializedForest {
  if (rows.length < 2) throw new Error('Isolation Forest needs at least 2 training samples');
  const numTrees = options.numTrees ?? 100;
  const subsampleSize = Math.min(options.subsampleSize ?? 256, rows.length);
  const heightLimit = Math.ceil(Math.log2(subsampleSize));
  const rng = createRng(options.seed ?? 42);
  const coupling = options.coupling === false ? undefined : fitHrActivityCoupling(rows);
  const data = rows.map((x) => augmentWithCoupling(x, coupling));

  const trees: ITreeNode[] = [];
  for (let t = 0; t < numTrees; t++) {
    // Sample ψ points without replacement (partial Fisher–Yates).
    const pool = data.slice();
    for (let i = 0; i < subsampleSize; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    trees.push(buildTree(pool.slice(0, subsampleSize), 0, heightLimit, rng));
  }

  return {
    version: coupling ? 2 : 1,
    features: FEATURE_NAMES,
    numTrees,
    subsampleSize,
    trainedAt: new Date().toISOString(),
    trainingSize: data.length,
    ...(coupling ? { coupling } : {}),
    trees,
  };
}

/** Eq. 2.2 — s → 1 critical anomaly, s ≈ 0.5 normal variability, s → 0 tightly clustered. */
export function anomalyScore(forest: SerializedForest, x: FeatureVector): number {
  const point = augmentWithCoupling(x, forest.coupling);
  let total = 0;
  for (const tree of forest.trees) total += pathLength(point, tree);
  const expected = total / forest.trees.length;
  return Math.pow(2, -expected / averagePathLength(forest.subsampleSize));
}
