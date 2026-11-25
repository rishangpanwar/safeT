import { ANOMALY_CRITICAL, ANOMALY_WATCH, TERRAIN_SENSITIVITY_SHIFT } from './isolationForest';
import { Avpu, computeMews, MewsResult, tierForScore, TriageTier } from './mews';
import { WindowFeatures } from './features';

export type AnomalyLevel = 'normal' | 'watch' | 'critical';

/** Window-mean mobility (σ of SVM, g) from which the wearer counts as walking or climbing. */
export const AMBULATORY_MOBILITY = 0.15;
/** Clinical definition of tachycardia (bpm). */
export const TACHYCARDIA_BPM = 100;
/** Continuous stillness after which a resting tachycardia is treated as possible incapacitation. */
export const STILLNESS_ALERT_S = 120;

export interface TerrainContext {
  zones: { name: string; riskLevel?: string; category?: string }[];
  altitude?: number;
  /** Points by which MEWS escalates earlier (0 normally, 1 in geo-medical risk zones). */
  escalationOffset: number;
}

export interface ClinicalAssessment {
  tier: TriageTier;
  mews: MewsResult;
  anomalyScore: number | null;
  anomalyLevel: AnomalyLevel;
  reasons: string[];
  requiresSelfCheck: boolean;
  terrain: TerrainContext;
  vitals: WindowFeatures['named'];
  assessedAt: string;
}

/**
 * Fuses the unsupervised anomaly score with the MEWS clinical matrix:
 *   • MEWS sets the clinical tier (Green 0–2 / Yellow 3–4 / Red ≥5, shifted in risk zones).
 *   • A critical Isolation Forest score on top of any MEWS deviation escalates to Red —
 *     this is how "silent" patterns that MEWS alone under-scores still raise an alarm.
 *   • A critical score with a normal MEWS puts the tourist on Yellow "elevated watch".
 *
 * Kinematic context. MEWS was designed for patients at rest; the accuracy evaluation showed it
 * flagging a third of healthy trekking time Yellow and missing motionless casualties. So:
 *   • Exertional tachycardia: while walking (mobility ≥ 0.15 g) with a normal forest score,
 *     the heart-rate points are not escalated. The forest learned how heart rate follows
 *     activity, so a rate out of proportion to the effort is not "normal" and still counts.
 *     Bradycardia is never discounted.
 *   • Resting tachycardia: HR > 100 bpm after ≥ 2 min of complete stillness is treated as
 *     possible incapacitation (post-fall shock, pain, hypoxia) and raises the 30 s self-check.
 * The MEWS total itself is reported unchanged (Table 2.1); only the escalation decision differs.
 */
export function assessClinicalState(params: {
  features: WindowFeatures;
  anomalyScore: number | null;
  avpu: Avpu;
  terrain: TerrainContext;
}): ClinicalAssessment {
  const { features, anomalyScore, avpu, terrain } = params;
  const v = features.named;
  const mews = computeMews({ hr: v.hr, spo2: v.spo2, skinTemp: v.skinTemp, avpu }, terrain.escalationOffset);

  const shift = terrain.escalationOffset > 0 ? TERRAIN_SENSITIVITY_SHIFT : 0;
  const anomalyLevel: AnomalyLevel =
    anomalyScore == null ? 'normal'
      : anomalyScore >= ANOMALY_CRITICAL - shift ? 'critical'
      : anomalyScore >= ANOMALY_WATCH - shift ? 'watch'
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
  if (terrain.escalationOffset > 0) {
    const where = terrain.zones.map((z) => z.name).join(', ') || `altitude ${Math.round(terrain.altitude ?? 0)} m`;
    reasons.push(`Geo-medical risk zone (${where}): alert thresholds lowered`);
  }

  return {
    tier,
    mews,
    anomalyScore,
    anomalyLevel,
    reasons,
    requiresSelfCheck: tier === 'red' && !mews.bypassConfirmation,
    terrain,
    vitals: v,
    assessedAt: new Date().toISOString(),
  };
}
