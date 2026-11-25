// Mirror of smart-tourist-server/src/health/mews.ts — kept identical (see edge/parity.test.ts).

/**
 * Modified Early Warning Score (Subbe et al., 2001), adapted per report §2.2-C.
 *
 *   MEWS_Total = Score(HR) + Score(SpO2) + Score(SkinTemp) + Score(PulsePress) + Score(AVPU)   (Eq. 2.6)
 *
 * Table 2.1 defines bands for HR, SpO2, temperature and AVPU. It defines no bands for
 * pulse pressure, and consumer wearables cannot measure blood pressure, so that term
 * contributes 0 here.
 */

export type Avpu = 'alert' | 'voice' | 'pain' | 'unresponsive';
export type TriageTier = 'green' | 'yellow' | 'red';

export interface MewsInput {
  hr?: number | null;
  spo2?: number | null;
  skinTemp?: number | null;
  avpu?: Avpu | null;
}

export interface MewsResult {
  total: number;
  tier: TriageTier;
  components: { hr: number; spo2: number; skinTemp: number; pulsePressure: number; avpu: number };
  /** Red tier with an unresponsive patient skips the 30 s self-check (report §2.2-C.3). */
  bypassConfirmation: boolean;
  thresholds: { yellow: number; red: number };
}

export function scoreHeartRate(hr?: number | null): number {
  if (hr == null || Number.isNaN(hr)) return 0;
  if (hr <= 40) return 3;
  if (hr <= 50) return 2;
  if (hr <= 100) return 0;
  if (hr <= 110) return 1;
  if (hr < 130) return 2;
  return 3;
}

export function scoreSpO2(spo2?: number | null): number {
  if (spo2 == null || Number.isNaN(spo2)) return 0;
  if (spo2 < 85) return 3;
  if (spo2 <= 90) return 2;
  if (spo2 <= 94) return 1;
  return 0;
}

export function scoreSkinTemp(temp?: number | null): number {
  if (temp == null || Number.isNaN(temp)) return 0;
  if (temp < 35.0) return 2; // hypothermia
  if (temp < 36.0) return 1;
  if (temp <= 37.5) return 0;
  if (temp < 38.5) return 1;
  if (temp < 40.0) return 2; // fever
  return 3; // heatstroke
}

export function scoreAvpu(avpu?: Avpu | null): number {
  switch (avpu) {
    case 'voice': return 1;
    case 'pain': return 2;
    case 'unresponsive': return 3;
    default: return 0;
  }
}

/**
 * @param escalationOffset How many points earlier to escalate. Geo-medical risk zones
 *   (e.g. hypoxia corridors >3,000 m ASL) pass 1 so Yellow starts at 2 and Red at 4,
 *   implementing "dynamically lowering physiological alert thresholds" (Objective 3).
 */
export function computeMews(input: MewsInput, escalationOffset = 0): MewsResult {
  const components = {
    hr: scoreHeartRate(input.hr),
    spo2: scoreSpO2(input.spo2),
    skinTemp: scoreSkinTemp(input.skinTemp),
    pulsePressure: 0,
    avpu: scoreAvpu(input.avpu),
  };
  const total = components.hr + components.spo2 + components.skinTemp + components.pulsePressure + components.avpu;

  const thresholds = { yellow: Math.max(1, 3 - escalationOffset), red: Math.max(2, 5 - escalationOffset) };
  const tier = tierForScore(total, thresholds);

  return {
    total,
    tier,
    components,
    bypassConfirmation: tier === 'red' && input.avpu === 'unresponsive',
    thresholds,
  };
}

/** Green 0–2 / Yellow 3–4 / Red ≥ 5 (shifted by the escalation offset). */
export function tierForScore(score: number, thresholds: { yellow: number; red: number }): TriageTier {
  return score >= thresholds.red ? 'red' : score >= thresholds.yellow ? 'yellow' : 'green';
}

export const TIER_ADVISORY: Record<TriageTier, string> = {
  green: 'Normal physiological baseline.',
  yellow: 'Moderate physiological distress detected. Hydrate, rest and reduce ascent pace.',
  red: 'Acute clinical decompensation. Emergency response initiated.',
};
