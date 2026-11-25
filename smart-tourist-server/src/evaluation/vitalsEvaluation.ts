/**
 * Accuracy evaluation of the clinical detection pipeline (report §2.2-A, §2.2-C and their fusion).
 *
 * Simulated trekkers (src/demo/physiology.ts) are streamed at 1 Hz through the real 60 s feature
 * window, Isolation Forest, MEWS and fusion code, exactly as the server and the phone run them.
 * Four detectors are compared (an ablation study):
 *   • mews       — MEWS tier alone (report §2.2-C)
 *   • iforest    — Isolation Forest score alone (report §2.2-A)
 *   • fusedBasic — the original fusion: MEWS tier, raised by a critical forest score
 *   • fused      — the production rule in health/triage.ts (adds the kinematic context)
 * Passing a forest trained with `coupling: false` reproduces the original model.
 *
 * The scenario generator is independent of the forest's training baseline (generateHealthyBaseline
 * in features.ts), so the forest is never scored on the data it was trained on. Every number is
 * measured on synthetic physiology: it shows how the algorithms behave, not clinical validity.
 */

import { anomalyScore, createRng, SerializedForest } from '../health/isolationForest';
import { extractWindowFeatures, trainPopulationForest, VitalSample } from '../health/features';
import { assessClinicalState } from '../health/triage';
import { HYPOXIA_ALTITUDE_M } from '../health/geoMedical';
import { sampleAt, Scenario } from '../demo/physiology';
import type { TriageTier } from '../health/mews';

export const DETECTORS = ['mews', 'iforest', 'fusedBasic', 'fused'] as const;
export type DetectorName = (typeof DETECTORS)[number];

export const EPISODE_SCENARIOS = ['ams', 'cardiac', 'hypothermia', 'heatstroke', 'fall'] as const;
export type EpisodeScenario = (typeof EPISODE_SCENARIOS)[number];

/** Altitudes where each pathology is plausible (no altitude sickness in Jaipur, no heatstroke on a glacier). */
const ALTITUDE_BAND: Record<Scenario, [number, number]> = {
  normal: [200, 4800],
  ams: [2800, 4800],
  cardiac: [200, 4500],
  hypothermia: [2500, 4800],
  heatstroke: [100, 1500],
  fall: [300, 4500],
};

/** After a false alarm is answered with "I'm OK", the app suppresses re-checks this long. */
const ALARM_COOLDOWN_S = 600;
/** An episode window counts as established pathology (a positive label) from this fraction of onset. */
const ESTABLISHED_PROGRESS = 0.6;
/** physiology.ts: a fall casualty is down from 20 s; give the 60 s window 30 s more to fill. */
const FALL_POSITIVE_FROM_S = 50;
const WINDOW_SAMPLES = 60;
/** Samples handed to feature extraction: the 60 s window plus history for the stillness timer. */
const HISTORY_SAMPLES = 300;

export interface VitalsEvalOptions {
  seed?: number;
  /** Episode sessions per pathology. */
  sessionsPerScenario?: number;
  /** Healthy trekking sessions (no pathology at all). */
  normalSessions?: number;
  /** Healthy tourists resting the whole time (lunch break, camp): the stillness rule's false-alarm risk. */
  restingSessions?: number;
  normalMinutes?: number;
  /** Healthy minutes before each episode starts (also scored as negatives). */
  preRollSeconds?: number;
  episodeSeconds?: number;
  /** Seconds between assessments; the window always holds the last 60 samples. */
  stepSeconds?: number;
  forest?: SerializedForest;
}

export interface BinaryCounts { tp: number; fp: number; tn: number; fn: number }
export interface BinaryMetrics extends BinaryCounts {
  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
  f1: number;
}

export function binaryMetrics(c: BinaryCounts): BinaryMetrics {
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

/** Area under the ROC curve via the Mann–Whitney U statistic (ties get the average rank). */
export function rocAuc(scores: number[], positive: boolean[]): number {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rankSum = 0;
  let nPos = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (positive[order[k]]) { rankSum += rank; nPos++; }
    i = j + 1;
  }
  const nNeg = order.length - nPos;
  if (nPos === 0 || nNeg === 0) return NaN;
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

interface Session {
  scenario: Scenario;
  altitude: number;
  onset: number;
  preRoll: number;
  duration: number;
  resting: boolean;
  baseline: { hr: number; spo2: number; skinTemp: number; hrv: number; phase: number };
}

type Config = Required<Omit<VitalsEvalOptions, 'forest'>>;

function makeSession(scenario: Scenario, rng: () => number, o: Config, resting = false): Session {
  const u = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const [lo, hi] = ALTITUDE_BAND[scenario];
  const healthy = scenario === 'normal';
  return {
    scenario,
    altitude: Math.round(u(lo, hi)),
    onset: scenario === 'fall' ? 60 : Math.round(u(120, 480)),
    preRoll: healthy ? 0 : o.preRollSeconds,
    duration: healthy ? o.normalMinutes * 60 : o.preRollSeconds + o.episodeSeconds,
    resting,
    // Per-person offsets: unfit or fit trekkers, small sensor biases, walking rhythm.
    baseline: { hr: u(-10, 10), spo2: u(-1, 1), skinTemp: u(-0.2, 0.2), hrv: u(-8, 8), phase: u(0, 250) },
  };
}

function simulate(session: Session, rng: () => number): VitalSample[] {
  const t0 = Date.UTC(2026, 0, 1);
  const samples: VitalSample[] = [];
  for (let s = 0; s < session.duration; s++) {
    const inEpisode = session.scenario !== 'normal' && s >= session.preRoll;
    samples.push(
      sampleAt(inEpisode ? session.scenario : 'normal', inEpisode ? s - session.preRoll : s, t0 + s * 1000, {
        altitude: session.altitude,
        onsetSeconds: session.onset,
        // Shift the walking rhythm so it stays continuous when the episode clock restarts at 0.
        baseline: { ...session.baseline, phase: session.baseline.phase + (inEpisode ? session.preRoll : 0) },
        resting: session.resting,
        rng,
      })
    );
  }
  return samples;
}

type Label = 'negative' | 'positive' | 'ambiguous';

/** Ground truth for the window ending at second `s`. Developing pathology is left unlabelled. */
function windowLabel(session: Session, s: number): Label {
  if (session.scenario === 'normal' || s < session.preRoll) return 'negative';
  const ep = s - session.preRoll;
  if (session.scenario === 'fall') return ep >= FALL_POSITIVE_FROM_S ? 'positive' : 'ambiguous';
  return ep / session.onset >= ESTABLISHED_PROGRESS ? 'positive' : 'ambiguous';
}

export interface ScenarioResult {
  sessions: number;
  detected: number;
  sensitivity: number;
  /** Seconds from episode start to the first Red tier. */
  medianLatencyS: number | null;
  p90LatencyS: number | null;
  /** Seconds from episode start to the first Yellow-or-Red tier. */
  medianEarlyWarningS: number | null;
}

export interface DetectorReport {
  /** Episode session reaches Red = TP; healthy session raises no Red alarm = TN. */
  session: BinaryMetrics;
  /** Per 60 s window: Red tier against the established-pathology label. */
  window: BinaryMetrics;
  /** Red alarms during healthy trekking per trekker-hour (10 min "I'm OK" cooldown after each). */
  falseAlarmsPerHour: number;
  /** Share of healthy windows shown as Yellow or Red. */
  healthyNonGreenFraction: number;
  perScenario: Record<EpisodeScenario, ScenarioResult>;
}

export interface VitalsEvalReport {
  generatedAt: string;
  config: Config & { healthyHours: number; windowsScored: number; episodeSessions: number };
  /** Isolation Forest score as a continuous classifier of established pathology. */
  iforestRocAuc: number;
  detectors: Record<DetectorName, DetectorReport>;
}

interface Accumulator {
  session: BinaryCounts;
  window: BinaryCounts;
  falseAlarms: number;
  healthyNonGreen: number;
  perScenario: Map<EpisodeScenario, { sessions: number; latencies: number[]; early: number[] }>;
}

export function evaluateVitalsPipeline(options: VitalsEvalOptions = {}): VitalsEvalReport {
  const o: Config = {
    seed: options.seed ?? 2026,
    sessionsPerScenario: options.sessionsPerScenario ?? 60,
    normalSessions: options.normalSessions ?? 120,
    restingSessions: options.restingSessions ?? 40,
    normalMinutes: options.normalMinutes ?? 30,
    preRollSeconds: options.preRollSeconds ?? 300,
    episodeSeconds: options.episodeSeconds ?? 900,
    stepSeconds: options.stepSeconds ?? 5,
  };
  const forest = options.forest ?? trainPopulationForest();
  const rng = createRng(o.seed);

  const sessions: Session[] = [];
  for (let i = 0; i < o.normalSessions; i++) sessions.push(makeSession('normal', rng, o));
  for (let i = 0; i < o.restingSessions; i++) sessions.push(makeSession('normal', rng, o, true));
  for (const scenario of EPISODE_SCENARIOS) {
    for (let i = 0; i < o.sessionsPerScenario; i++) sessions.push(makeSession(scenario, rng, o));
  }

  const acc = {} as Record<DetectorName, Accumulator>;
  for (const d of DETECTORS) {
    acc[d] = { session: { tp: 0, fp: 0, tn: 0, fn: 0 }, window: { tp: 0, fp: 0, tn: 0, fn: 0 }, falseAlarms: 0, healthyNonGreen: 0, perScenario: new Map() };
  }
  const aucScores: number[] = [];
  const aucLabels: boolean[] = [];
  let negativeWindows = 0;
  let windowsScored = 0;

  for (const session of sessions) {
    const samples = simulate(session, rng);
    const escalationOffset = session.altitude >= HYPOXIA_ALTITUDE_M ? 1 : 0;
    const state = {} as Record<DetectorName, { cooldownUntil: number; falseAlarms: number; detectedAt: number | null; earlyAt: number | null }>;
    for (const d of DETECTORS) state[d] = { cooldownUntil: -Infinity, falseAlarms: 0, detectedAt: null, earlyAt: null };

    for (let s = WINDOW_SAMPLES - 1; s < samples.length; s += o.stepSeconds) {
      const features = extractWindowFeatures(samples.slice(Math.max(0, s - HISTORY_SAMPLES + 1), s + 1))!;
      const score = anomalyScore(forest, features.vector);
      // AVPU stays "alert": these are the assessments made before any self-check is shown.
      const a = assessClinicalState({
        features,
        anomalyScore: score,
        avpu: 'alert',
        terrain: { zones: [], altitude: session.altitude, escalationOffset },
      });
      const tiers: Record<DetectorName, TriageTier> = {
        mews: a.mews.tier,
        iforest: a.anomalyLevel === 'critical' ? 'red' : a.anomalyLevel === 'watch' ? 'yellow' : 'green',
        fusedBasic: a.anomalyLevel === 'critical' ? (a.mews.total > 0 ? 'red' : 'yellow') : a.mews.tier,
        fused: a.tier,
      };

      const label = windowLabel(session, s);
      windowsScored++;
      if (label === 'negative') negativeWindows++;
      if (label !== 'ambiguous') {
        aucScores.push(score);
        aucLabels.push(label === 'positive');
      }
      const episodeTime = session.scenario !== 'normal' && s >= session.preRoll ? s - session.preRoll : null;

      for (const d of DETECTORS) {
        const tier = tiers[d];
        const st = state[d];
        const A = acc[d];
        if (label === 'negative' && tier !== 'green') A.healthyNonGreen++;
        if (label !== 'ambiguous') {
          const red = tier === 'red';
          if (label === 'positive') red ? A.window.tp++ : A.window.fn++;
          else red ? A.window.fp++ : A.window.tn++;
        }
        if (episodeTime !== null) {
          if (tier !== 'green' && st.earlyAt === null) st.earlyAt = episodeTime;
          if (tier === 'red' && st.detectedAt === null) st.detectedAt = episodeTime;
        } else if (tier === 'red' && s >= st.cooldownUntil) {
          st.falseAlarms++;
          st.cooldownUntil = s + ALARM_COOLDOWN_S;
        }
      }
    }

    for (const d of DETECTORS) {
      const st = state[d];
      const A = acc[d];
      A.falseAlarms += st.falseAlarms;
      if (session.scenario === 'normal') {
        st.falseAlarms > 0 ? A.session.fp++ : A.session.tn++;
        continue;
      }
      const scenario = session.scenario as EpisodeScenario;
      const ps = A.perScenario.get(scenario) ?? { sessions: 0, latencies: [], early: [] };
      A.perScenario.set(scenario, ps);
      ps.sessions++;
      if (st.earlyAt !== null) ps.early.push(st.earlyAt);
      if (st.detectedAt !== null) {
        ps.latencies.push(st.detectedAt);
        A.session.tp++;
      } else {
        A.session.fn++;
      }
    }
  }

  const healthyHours = (negativeWindows * o.stepSeconds) / 3600;
  const detectors = {} as Record<DetectorName, DetectorReport>;
  for (const d of DETECTORS) {
    const A = acc[d];
    const perScenario = {} as Record<EpisodeScenario, ScenarioResult>;
    for (const scenario of EPISODE_SCENARIOS) {
      const ps = A.perScenario.get(scenario) ?? { sessions: 0, latencies: [], early: [] };
      perScenario[scenario] = {
        sessions: ps.sessions,
        detected: ps.latencies.length,
        sensitivity: ps.sessions ? ps.latencies.length / ps.sessions : 0,
        medianLatencyS: percentile(ps.latencies, 0.5),
        p90LatencyS: percentile(ps.latencies, 0.9),
        medianEarlyWarningS: percentile(ps.early, 0.5),
      };
    }
    detectors[d] = {
      session: binaryMetrics(A.session),
      window: binaryMetrics(A.window),
      falseAlarmsPerHour: healthyHours ? A.falseAlarms / healthyHours : 0,
      healthyNonGreenFraction: negativeWindows ? A.healthyNonGreen / negativeWindows : 0,
      perScenario,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    config: { ...o, healthyHours, windowsScored, episodeSessions: sessions.length - o.normalSessions - o.restingSessions },
    iforestRocAuc: rocAuc(aucScores, aucLabels),
    detectors,
  };
}
