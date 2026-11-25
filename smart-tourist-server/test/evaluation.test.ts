/**
 * Accuracy regression guard: a reduced run of the evaluation (`npm run evaluate` runs the full
 * one). If a change to the forest, MEWS or fusion makes detection worse, these floors fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVitalsPipeline, rocAuc, binaryMetrics } from '../src/evaluation/vitalsEvaluation';

test('metric helpers: ROC-AUC and confusion-matrix metrics', () => {
  assert.equal(rocAuc([0.1, 0.2, 0.8, 0.9], [false, false, true, true]), 1);
  assert.equal(rocAuc([0.9, 0.8, 0.2, 0.1], [false, false, true, true]), 0);
  assert.equal(rocAuc([0.5, 0.5], [false, true]), 0.5);
  const m = binaryMetrics({ tp: 8, fp: 2, tn: 88, fn: 2 });
  assert.equal(m.accuracy, 0.96);
  assert.equal(m.precision, 0.8);
  assert.equal(m.recall, 0.8);
  assert.ok(Math.abs(m.f1 - 0.8) < 1e-12);
});

test('clinical pipeline keeps its accuracy on simulated trekkers', () => {
  const r = evaluateVitalsPipeline({ seed: 11, sessionsPerScenario: 12, normalSessions: 24, restingSessions: 8 });
  const { fused, fusedBasic, mews } = r.detectors;

  assert.ok(r.iforestRocAuc > 0.93, `iForest ROC-AUC ${r.iforestRocAuc}`);
  assert.ok(fused.session.recall >= 0.95, `sensitivity ${fused.session.recall}`);
  // 32 healthy sessions: one false alarm moves specificity 3 points, so the floor leaves room.
  assert.ok(fused.session.specificity >= 0.9, `specificity ${fused.session.specificity}`);
  assert.ok(fused.perScenario.fall.sensitivity >= 0.9, `post-fall incapacitation ${fused.perScenario.fall.sensitivity}`);

  // The kinematic context must beat the original fusion and MEWS alone.
  assert.ok(fused.window.f1 > fusedBasic.window.f1, `F1 ${fused.window.f1} vs ${fusedBasic.window.f1}`);
  assert.ok(fused.falseAlarmsPerHour <= fusedBasic.falseAlarmsPerHour, `false alarms ${fused.falseAlarmsPerHour}/h`);
  assert.ok(fused.healthyNonGreenFraction < mews.healthyNonGreenFraction / 2, `healthy time flagged ${fused.healthyNonGreenFraction}`);
});
