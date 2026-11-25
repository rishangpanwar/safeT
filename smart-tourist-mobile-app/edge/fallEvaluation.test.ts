/**
 * Accuracy regression guard for the fall detector: a reduced run of edge/fallEvaluation.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFallDetector, NEGATIVE_CLASSES } from './fallEvaluation';

test('fall detector keeps its accuracy on synthetic motion traces', () => {
  const r = evaluateFallDetector({ seed: 11, tracesPerClass: 40 });
  const { final, fourStage } = r.overall;

  assert.ok(final.recall >= 0.95, `recall ${final.recall}`);
  assert.ok(r.perClass.collapse.flagRate.final >= 0.9, `collapse ${r.perClass.collapse.flagRate.final}`);
  assert.equal(r.perClass.collapse.flagRate.fourStage, 0); // what the collapse path is for
  // Everyday movement must never be confirmed as an incapacitating fall.
  for (const cls of ['walking', 'running', 'jumping', 'sit_down_hard', 'lie_down_to_rest', 'flop_down_to_rest'] as const) {
    assert.equal(r.perClass[cls].flagRate.final, 0, cls);
  }
  // The collapse path adds recall without adding false alarms.
  assert.ok(final.specificity >= fourStage.specificity);
  assert.ok(final.f1 > fourStage.f1);
  assert.equal(Object.keys(r.perClass).length, 3 + NEGATIVE_CLASSES.length);
});
