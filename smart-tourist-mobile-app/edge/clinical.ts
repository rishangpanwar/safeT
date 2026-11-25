/**
 * Edge clinical engine (report Tier 2): scores the 60 s feature window with the Isolation
 * Forest downloaded from GET /api/health/model, computes MEWS, and applies the same fusion
 * rules as the server so triage keeps working with no signal.
 *
 * Mirrors smart-tourist-server/src/health/{isolationForest,features,triage,geoMedical}.ts —
 * edge/parity.test.ts checks both sides agree.
 */
import { Avpu, computeMews, MewsResult, tierForScore, TriageTier } from './mews';

// ------------------------------------------------------------------ Isolation Forest scorer

export type ITreeNode = { s: number } | { q: number; p: number; l: ITreeNode; r: ITreeNode };

/** HR ≈ intercept + slope · mobility, learned by the server on healthy windows (model version 2). */
export interface HrActivityCoupling {
  intercept: number;
  slope: number;
}

export interface EdgeModel {
  forest: { numTrees: number; subsampleSize: number; trees: ITreeNode[]; trainedAt: string; coupling?: HrActivityCoupling };
  thresholds: { watch: number; critical: number; terrainShift: number };
  windowSeconds: number;
  hypoxiaAltitudeM: number;
}

export function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}

function pathLength(x: number[], node: ITreeNode, depth = 0): number {
  if ('s' in node) return depth + averagePathLength(node.s);
  return pathLength(x, x[node.q] < node.p ? node.l : node.r, depth + 1);
}

/** X → [X, HR − (a + b·Mobility)]: the trees also split on heart rate the activity does not explain. */
export function augmentWithCoupling(x: number[], coupling?: HrActivityCoupling): number[] {
  if (!coupling) return x;
  return [...x, x[0] - (coupling.intercept + coupling.slope * x[5])];
}

/** s(x, n) = 2^(−E(h(x)) / c(ψ)) */
export function anomalyScore(model: EdgeModel, x: number[]): number {
  const point = augmentWithCoupling(x, model.forest.coupling);
  let total = 0;
  for (const tree of model.forest.trees) total += pathLength(point, tree);
  return Math.pow(2, -(total / model.forest.trees.length) / averagePathLength(model.forest.subsampleSize));
}

// ------------------------------------------------------------------ feature window

export interface VitalSample {
  t: number;
  hr?: number;
  spo2?: number;
  skinTemp?: number;
  hrvRmssd?: number;
  mobility?: number;
  altitude?: number;
  lat?: number;
  lng?: number;
}

export interface WindowFeatures {
  vector: number[];
  named: { hr: number; deltaHr: number; spo2: number; hrvRmssd: number; skinTemp: number; mobility: number };
  sampleCount: number;
  /** Seconds continuously motionless, looking back over every sample passed in. */
  stillSeconds: number;
}

export const IMMOBILE_MOBILITY = 0.02;

/** Length of the motionless run that ends at the newest sample (samples in time order). */
export function stillnessSeconds(samples: VitalSample[]): number {
  const end = samples.length ? samples[samples.length - 1].t : 0;
  let start = end;
  for (let i = samples.length - 1; i >= 0; i--) {
    const m = samples[i].mobility;
    if (typeof m !== 'number' || m >= IMMOBILE_MOBILITY) break;
    start = samples[i].t;
  }
  return (end - start) / 1000;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);
const nums = (xs: (number | undefined)[]) => xs.filter((v): v is number => typeof v === 'number');

export function extractWindowFeatures(samples: VitalSample[], windowMs = 60_000): WindowFeatures | null {
  if (!samples.length) return null;
  const end = samples[samples.length - 1].t;
  const win = samples.filter((s) => s.t > end - windowMs);
  const hrs = nums(win.map((s) => s.hr));
  const head = hrs.slice(0, Math.min(10, hrs.length));
  const tail = hrs.slice(-Math.min(10, hrs.length));
  const named = {
    hr: mean(hrs) ?? 75,
    deltaHr: hrs.length >= 2 ? (mean(tail) ?? 0) - (mean(head) ?? 0) : 0,
    spo2: mean(nums(win.map((s) => s.spo2))) ?? 97,
    hrvRmssd: mean(nums(win.map((s) => s.hrvRmssd))) ?? 45,
    skinTemp: mean(nums(win.map((s) => s.skinTemp))) ?? 36.7,
    mobility: mean(nums(win.map((s) => s.mobility))) ?? 0.1,
  };
  return {
    vector: [named.hr, named.deltaHr, named.spo2, named.hrvRmssd, named.skinTemp, named.mobility],
    named,
    sampleCount: win.length,
    stillSeconds: stillnessSeconds(samples),
  };
}

export function inferAvpu(selfCheck: 'none' | 'responded' | 'expired', mobility: number): Avpu {
  if (selfCheck === 'expired') return mobility < IMMOBILE_MOBILITY ? 'unresponsive' : 'pain';
  if (selfCheck === 'responded') return 'voice';
  return 'alert';
}

// ------------------------------------------------------------------ geo-medical terrain

export interface CachedZone {
  _id: string;
  name: string;
  riskLevel?: string;
  geometry: { type: 'Polygon' | 'Circle'; coordinates: number[][] | number[]; radius?: number };
  metadata?: { category?: string };
}

const RISK_CATEGORIES = ['high_altitude', 'avalanche', 'landslide', 'medical_dead_zone'];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray casting (Eq. 2.7) behind a bounding-box pre-filter. Coordinates are [lng, lat]. */
export function pointInPolygon(x0: number, y0: number, poly: number[][]): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (x0 < minX || x0 > maxX || y0 < minY || y0 > maxY) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (((yi <= y0 && y0 < yj) || (yj <= y0 && y0 < yi)) && x0 < xi + ((xj - xi) / (yj - yi)) * (y0 - yi)) inside = !inside;
  }
  return inside;
}

export function zonesAt(lat: number, lng: number, zones: CachedZone[]): CachedZone[] {
  return zones.filter((z) => {
    const risky = RISK_CATEGORIES.includes(z.metadata?.category ?? '') || z.riskLevel === 'high' || z.riskLevel === 'critical';
    if (!risky) return false;
    if (z.geometry.type === 'Circle') {
      const [cLng, cLat] = z.geometry.coordinates as number[];
      return haversineKm(lat, lng, cLat, cLng) * 1000 <= (z.geometry.radius ?? 1000);
    }
    return pointInPolygon(lng, lat, z.geometry.coordinates as number[][]);
  });
}

// ------------------------------------------------------------------ fusion

export type AnomalyLevel = 'normal' | 'watch' | 'critical';

/** Mirrors server triage.ts: kinematic context for MEWS escalation. */
export const AMBULATORY_MOBILITY = 0.15;
export const TACHYCARDIA_BPM = 100;
export const STILLNESS_ALERT_S = 120;

export interface EdgeAssessment {
  tier: TriageTier;
  mews: MewsResult;
  anomalyScore: number | null;
  anomalyLevel: AnomalyLevel;
  reasons: string[];
  requiresSelfCheck: boolean;
  escalationOffset: number;
  zones: string[];
  vitals: WindowFeatures['named'];
}

export function assess(params: {
  features: WindowFeatures;
  anomalyScore: number | null;
  avpu: Avpu;
  zones: string[];
  altitude?: number;
  thresholds: { watch: number; critical: number; terrainShift: number };
  hypoxiaAltitudeM?: number;
}): EdgeAssessment {
  const { features, anomalyScore, avpu, zones, altitude, thresholds } = params;
  const v = features.named;
  const escalationOffset = zones.length > 0 || (altitude ?? 0) >= (params.hypoxiaAltitudeM ?? 3000) ? 1 : 0;
  const mews = computeMews({ hr: v.hr, spo2: v.spo2, skinTemp: v.skinTemp, avpu }, escalationOffset);

  const shift = escalationOffset > 0 ? thresholds.terrainShift : 0;
  const anomalyLevel: AnomalyLevel =
    anomalyScore == null ? 'normal'
      : anomalyScore >= thresholds.critical - shift ? 'critical'
      : anomalyScore >= thresholds.watch - shift ? 'watch'
      : 'normal';

  const exertional = mews.components.hr > 0 && v.hr > TACHYCARDIA_BPM && v.mobility >= AMBULATORY_MOBILITY && anomalyLevel === 'normal';
  const restingTachycardia = v.hr > TACHYCARDIA_BPM && features.stillSeconds >= STILLNESS_ALERT_S;

  let tier = exertional ? tierForScore(mews.total - mews.components.hr, mews.thresholds) : mews.tier;
  if (anomalyLevel === 'critical') tier = mews.total > 0 ? 'red' : 'yellow';
  if (restingTachycardia) tier = 'red';

  const reasons: string[] = [];
  if (restingTachycardia) {
    reasons.push(`Heart rate ${Math.round(v.hr)} bpm while motionless for ${Math.floor(features.stillSeconds / 60)} min: possible incapacitation`);
  }
  if (exertional) reasons.push(`Heart rate ${Math.round(v.hr)} bpm matches walking effort (Isolation Forest normal): not escalated`);
  else if (mews.components.hr) reasons.push(`Heart rate ${Math.round(v.hr)} bpm (MEWS +${mews.components.hr})`);
  if (mews.components.spo2) reasons.push(`SpO₂ ${v.spo2.toFixed(0)}% (MEWS +${mews.components.spo2})`);
  if (mews.components.skinTemp) reasons.push(`Temperature ${v.skinTemp.toFixed(1)} °C (MEWS +${mews.components.skinTemp})`);
  if (mews.components.avpu) reasons.push(`Responsiveness: ${avpu} (MEWS +${mews.components.avpu})`);
  if (anomalyLevel !== 'normal') reasons.push(`Isolation Forest anomaly s = ${anomalyScore!.toFixed(2)} (${anomalyLevel})`);
  if (escalationOffset > 0) reasons.push(`Geo-medical risk zone (${zones.join(', ') || `altitude ${Math.round(altitude ?? 0)} m`}): alert thresholds lowered`);

  return {
    tier,
    mews,
    anomalyScore,
    anomalyLevel,
    reasons,
    requiresSelfCheck: tier === 'red' && !mews.bypassConfirmation,
    escalationOffset,
    zones,
    vitals: v,
  };
}
