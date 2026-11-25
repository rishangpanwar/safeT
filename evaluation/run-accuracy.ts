/**
 * Full accuracy evaluation of both detectors. Run from smart-tourist-server:
 *
 *   npm run evaluate            (≈ 30 s)
 *   npm run evaluate -- --quick (reduced run for a quick look)
 *
 * Writes evaluation/results/accuracy.json (shown on the portal's Model Accuracy page through
 * GET /api/health/evaluation) and evaluation/results/ACCURACY.md (tables for the project report).
 *
 * "original" is the system as first built: the plain Isolation Forest, the MEWS + critical-score
 * fusion and the four-stage fall detector. "final" adds the HR-activity coupling, the kinematic
 * fusion context and the low-energy collapse path. Both run on identical simulated data.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateVitalsPipeline, DETECTORS, EPISODE_SCENARIOS, DetectorName, VitalsEvalReport,
} from '../smart-tourist-server/src/evaluation/vitalsEvaluation';
import { generateHealthyBaseline } from '../smart-tourist-server/src/health/features';
import { trainIsolationForest } from '../smart-tourist-server/src/health/isolationForest';
import { evaluateFallDetector, FallEvalReport, MotionClass } from '../smart-tourist-mobile-app/edge/fallEvaluation';

const SEEDS = [1, 2, 3, 4, 5];
const quick = process.argv.includes('--quick');
const size = quick ? { sessionsPerScenario: 12, normalSessions: 24, restingSessions: 8 } : {};
const outDir = path.resolve(__dirname, 'results');

export interface Spread { mean: number; min: number; max: number }
const spread = (v: number[]): Spread => ({ mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) });

const HEADLINE = {
  sessionAccuracy: 'Session accuracy',
  sensitivity: 'Sensitivity (episodes detected)',
  specificity: 'Specificity (healthy sessions alarm-free)',
  windowF1: 'Window F1 (Red vs established pathology)',
  falseAlarmsPerHour: 'False Red alarms per trekker-hour',
  healthyFlagged: 'Healthy time shown Yellow/Red',
  rocAuc: 'Isolation Forest ROC-AUC',
} as const;
type HeadlineKey = keyof typeof HEADLINE;

function headline(r: VitalsEvalReport, d: DetectorName): Record<HeadlineKey, number> {
  const x = r.detectors[d];
  return {
    sessionAccuracy: x.session.accuracy,
    sensitivity: x.session.recall,
    specificity: x.session.specificity,
    windowF1: x.window.f1,
    falseAlarmsPerHour: x.falseAlarmsPerHour,
    healthyFlagged: x.healthyNonGreenFraction,
    rocAuc: r.iforestRocAuc,
  };
}

function main() {
  const started = Date.now();
  const plainForest = trainIsolationForest(generateHealthyBaseline(4000, 7), { numTrees: 100, subsampleSize: 256, seed: 42, coupling: false });

  const runs = SEEDS.map((seed) => {
    process.stdout.write(`  vitals pipeline, seed ${seed}/${SEEDS.length}…\r`);
    return { seed, original: evaluateVitalsPipeline({ ...size, seed, forest: plainForest }), final: evaluateVitalsPipeline({ ...size, seed }) };
  });
  const summarise = (system: 'original' | 'final') => {
    const rows = runs.map((r) => headline(r[system], system === 'original' ? 'fusedBasic' : 'fused'));
    return Object.fromEntries((Object.keys(HEADLINE) as HeadlineKey[]).map((k) => [k, spread(rows.map((row) => row[k]))])) as Record<HeadlineKey, Spread>;
  };

  process.stdout.write('  fall detector…                       \r');
  const falls = evaluateFallDetector(quick ? { tracesPerClass: 40 } : {});

  const report = {
    generatedAt: new Date().toISOString(),
    quick,
    note:
      'All results are on synthetic data (simulated physiology and motion). They measure how the algorithms behave and ' +
      'compare versions fairly; they are not clinical validation.',
    vitals: {
      seeds: SEEDS,
      config: runs[0].final.config,
      headlineLabels: HEADLINE,
      summary: { original: summarise('original'), final: summarise('final') },
      /** Full reports for the first seed. */
      detail: { original: runs[0].original, final: runs[0].final },
    },
    falls,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'accuracy.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'ACCURACY.md'), markdown(report.vitals.summary, runs[0].original, runs[0].final, falls, report.generatedAt));

  const s = report.vitals.summary;
  console.log(`\n✅ Accuracy evaluation done in ${((Date.now() - started) / 1000).toFixed(1)} s${quick ? ' (quick)' : ''}`);
  console.log(`   Vitals  — session accuracy ${pct(s.original.sessionAccuracy.mean)} → ${pct(s.final.sessionAccuracy.mean)}, sensitivity ${pct(s.original.sensitivity.mean)} → ${pct(s.final.sensitivity.mean)}, specificity ${pct(s.original.specificity.mean)} → ${pct(s.final.specificity.mean)}`);
  console.log(`   Falls   — accuracy ${pct(falls.overall.fourStage.accuracy)} → ${pct(falls.overall.final.accuracy)}, recall ${pct(falls.overall.fourStage.recall)} → ${pct(falls.overall.final.recall)}`);
  console.log(`   Written to ${path.relative(process.cwd(), outDir)}${path.sep}accuracy.json and ACCURACY.md`);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number | null) => (x == null ? '–' : String(x));

function fmt(key: HeadlineKey, s: Spread) {
  const f = key === 'falseAlarmsPerHour' ? (x: number) => x.toFixed(3) : key === 'rocAuc' ? (x: number) => x.toFixed(3) : pct;
  return `${f(s.mean)} (${f(s.min)}–${f(s.max)})`;
}

const DETECTOR_LABELS: Record<DetectorName, string> = {
  mews: 'MEWS alone',
  iforest: 'Isolation Forest alone',
  fusedBasic: 'Original fusion',
  fused: 'Final fusion (kinematic context)',
};

function markdown(
  summary: Record<'original' | 'final', Record<HeadlineKey, Spread>>,
  original: VitalsEvalReport,
  final: VitalsEvalReport,
  falls: FallEvalReport,
  generatedAt: string
): string {
  const c = final.config;
  const lines: string[] = [];
  lines.push('# Accuracy evaluation', '');
  lines.push(`Generated ${generatedAt} by \`npm run evaluate\` (smart-tourist-server). All data is synthetic: these numbers compare algorithm versions, they are not clinical validation.`, '');

  lines.push('## 1. Clinical detection pipeline (vital signs)', '');
  lines.push(
    `Each seed simulates ${c.normalSessions} healthy trekking sessions and ${c.restingSessions} healthy resting sessions of ${c.normalMinutes} min, plus ${c.sessionsPerScenario} episodes each of ` +
      `${EPISODE_SCENARIOS.join(', ')} (${c.preRollSeconds / 60} min healthy, then ${c.episodeSeconds / 60} min of pathology). Vitals stream at 1 Hz through the real ` +
      `feature window, Isolation Forest, MEWS and fusion code; an assessment is made every ${c.stepSeconds} s (${c.windowsScored.toLocaleString('en')} per seed, ` +
      `${c.healthyHours.toFixed(0)} healthy trekker-hours). The forest is trained on a different generator (features.ts) than the one tested on (physiology.ts).`,
    ''
  );
  lines.push(`### Headline: mean (min–max) over ${SEEDS.length} seeds`, '');
  lines.push('| Metric | Original system | Final system |', '|---|---|---|');
  for (const k of Object.keys(HEADLINE) as HeadlineKey[]) lines.push(`| ${HEADLINE[k]} | ${fmt(k, summary.original[k])} | ${fmt(k, summary.final[k])} |`);
  lines.push('', 'Original = plain Isolation Forest + MEWS/critical-score fusion. Final = forest with HR-activity coupling + kinematic fusion context.', '');

  lines.push('### Ablation (seed 1, final forest)', '');
  lines.push('| Detector | Session acc. | Sensitivity | Specificity | Window acc. | Precision | Recall | F1 | False alarms/h | Healthy flagged |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const d of DETECTORS) {
    const x = final.detectors[d];
    lines.push(`| ${DETECTOR_LABELS[d]} | ${pct(x.session.accuracy)} | ${pct(x.session.recall)} | ${pct(x.session.specificity)} | ${pct(x.window.accuracy)} | ${pct(x.window.precision)} | ${pct(x.window.recall)} | ${pct(x.window.f1)} | ${x.falseAlarmsPerHour.toFixed(3)} | ${pct(x.healthyNonGreenFraction)} |`);
  }
  lines.push('', `Isolation Forest ROC-AUC (seed 1): ${original.iforestRocAuc.toFixed(3)} plain → ${final.iforestRocAuc.toFixed(3)} with HR-activity coupling.`, '');

  lines.push('### Per pathology (seed 1)', '');
  lines.push('| Pathology | Original: detected | Final: detected | Final: median s to Red | Final: 90th pct s | Final: median s to first warning |', '|---|---|---|---|---|---|');
  for (const sc of EPISODE_SCENARIOS) {
    const o = original.detectors.fusedBasic.perScenario[sc];
    const f = final.detectors.fused.perScenario[sc];
    lines.push(`| ${sc} | ${o.detected}/${o.sessions} (${pct(o.sensitivity)}) | ${f.detected}/${f.sessions} (${pct(f.sensitivity)}) | ${num(f.medianLatencyS)} | ${num(f.p90LatencyS)} | ${num(f.medianEarlyWarningS)} |`);
  }
  lines.push('', 'Latency counts from the moment the pathology starts developing (it reaches its full severity over 2–8 min).', '');

  lines.push('## 2. Fall detector (50 Hz motion)', '');
  lines.push(`${falls.config.tracesPerClass} synthetic traces per class, each with a random phone orientation and sensor noise. A trace counts as flagged if the detector confirms an incapacitating fall.`, '');
  lines.push('| Movement | Should alarm? | Four-stage (report) | Final (with collapse path) |', '|---|---|---|---|');
  for (const [cls, r] of Object.entries(falls.perClass) as [MotionClass, FallEvalReport['perClass'][MotionClass]][]) {
    lines.push(`| ${r.label} | ${r.positive ? 'yes' : 'no'} | ${pct(r.flagRate.fourStage)} | ${pct(r.flagRate.final)} |`);
  }
  lines.push('', '| Variant | Accuracy | Precision | Recall | Specificity | F1 |', '|---|---|---|---|---|---|');
  for (const [v, m] of Object.entries(falls.overall)) {
    lines.push(`| ${v === 'final' ? 'Final' : 'Four-stage (report)'} | ${pct(m.accuracy)} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.specificity)} | ${pct(m.f1)} |`);
  }
  lines.push('', 'Pooled metrics use equal traces per class, so they depend on that mix; the per-class rates do not.', '');

  lines.push('## 3. What changed, and why', '');
  lines.push(
    '- **HR-activity coupling (Isolation Forest).** Axis-parallel isolation could not see that "motionless at 110 bpm" is abnormal: each value is ordinary on its own axis. Training now fits HR ≈ a + b·Mobility on healthy data and adds the unexplained heart rate as a split dimension. X and Eq. 2.1–2.2 are unchanged.',
    '- **Kinematic fusion context.** MEWS was designed for patients at rest. While walking with a normal forest score, exertional tachycardia is not escalated (bradycardia always is); HR > 100 bpm after ≥ 2 min of complete stillness raises the 30 s self-check. The MEWS total is still reported per Table 2.1.',
    '- **Low-energy collapse path (fall detector).** A faint has no free fall below 0.5 g, so the four-stage path missed every collapse. Partial unloading (< 0.85 g) then an impact ≥ 1.8 g with rotation ≥ 100 °/s now also opens Stage 3–4, which then requires 20 s motionless with no voluntary rotation (< 20 °/s).',
    '',
    '## 4. Known limitations',
    '',
    '- Synthetic data only; thresholds need validation on real wearable recordings before clinical use.',
    '- A dropped phone that lands still is flagged by both fall-detector variants. The 30 s self-check exists for exactly this: the owner picks the phone up and taps "I\'m OK".',
    '- Remaining false Red alarms come from trekkers walking above ~4,500 m with SpO₂ ≤ 90 %, where the hypoxia-corridor rule deliberately asks for a self-check.',
    ''
  );
  return lines.join('\n');
}

main();
