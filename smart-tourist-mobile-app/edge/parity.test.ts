/**
 * The phone must reach the same triage decision as the server when it is offline.
 * This imports the server's implementation directly and checks both sides agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as edgeMews from './mews';
import { anomalyScore as edgeScore, assess, extractWindowFeatures as edgeFeatures, EdgeModel } from './clinical';
import * as serverMews from '../../smart-tourist-server/src/health/mews';
import { trainIsolationForest, anomalyScore as serverScore, ANOMALY_WATCH, ANOMALY_CRITICAL, TERRAIN_SENSITIVITY_SHIFT } from '../../smart-tourist-server/src/health/isolationForest';
import { generateHealthyBaseline, extractWindowFeatures as serverFeatures } from '../../smart-tourist-server/src/health/features';
import { assessClinicalState } from '../../smart-tourist-server/src/health/triage';

test('MEWS: edge copy is identical to server', () => {
  for (let hr = 30; hr <= 190; hr += 3)
    for (let spo2 = 70; spo2 <= 100; spo2 += 2)
      for (const temp of [33.5, 35.4, 36.5, 37.9, 39, 40.5])
        for (const avpu of ['alert', 'voice', 'pain', 'unresponsive'] as const)
          for (const offset of [0, 1])
            assert.deepEqual(
              edgeMews.computeMews({ hr, spo2, skinTemp: temp, avpu }, offset),
              serverMews.computeMews({ hr, spo2, skinTemp: temp, avpu }, offset)
            );
});

test('Isolation Forest: edge scorer reproduces server scores; fusion agrees', () => {
  const forest = trainIsolationForest(generateHealthyBaseline(2000, 3), { numTrees: 100, subsampleSize: 256 });
  const model: EdgeModel = {
    forest: JSON.parse(JSON.stringify(forest)), // as shipped over HTTP
    thresholds: { watch: ANOMALY_WATCH, critical: ANOMALY_CRITICAL, terrainShift: TERRAIN_SENSITIVITY_SHIFT },
    windowSeconds: 60,
    hypoxiaAltitudeM: 3000,
  };

  for (let k = 0; k < 300; k++) {
    const t0 = 1_700_000_000_000;
    const hr = 40 + Math.random() * 140;
    const spo2 = 70 + Math.random() * 30;
    const samples = Array.from({ length: 60 }, (_, i) => ({
      t: t0 + i * 1000, hr: hr + Math.random() * 6, spo2, skinTemp: 34 + Math.random() * 6.5,
      hrvRmssd: 10 + Math.random() * 80, mobility: Math.random() * 0.6,
    }));
    const fe = edgeFeatures(samples)!;
    const fs = serverFeatures(samples)!;
    assert.deepEqual(fe.vector, fs.vector);

    const se = edgeScore(model, fe.vector);
    const ss = serverScore(forest, fs.vector);
    assert.ok(Math.abs(se - ss) < 1e-12);

    const offset = k % 2;
    const zones = offset ? ['Test corridor'] : [];
    const edge = assess({ features: fe, anomalyScore: se, avpu: 'alert', zones, thresholds: model.thresholds });
    const server = assessClinicalState({
      features: fs, anomalyScore: ss, avpu: 'alert',
      terrain: { zones: zones.map((name) => ({ name })), escalationOffset: offset },
    });
    assert.equal(edge.tier, server.tier);
    assert.equal(edge.anomalyLevel, server.anomalyLevel);
    assert.deepEqual(edge.reasons, server.reasons);
  }
});

test('Kinematic context (exertion discount, resting tachycardia) agrees on phone and server', () => {
  const thresholds = { watch: ANOMALY_WATCH, critical: ANOMALY_CRITICAL, terrainShift: TERRAIN_SENSITIVITY_SHIFT };
  for (let k = 0; k < 300; k++) {
    const t0 = 1_700_000_000_000;
    const hr = 40 + Math.random() * 120;
    const walking = k % 3 === 0;
    const stillFrom = Math.floor(Math.random() * 240); // motionless from this sample on
    const samples = Array.from({ length: 240 }, (_, i) => ({
      t: t0 + i * 1000, hr: hr + Math.random() * 4, spo2: 85 + Math.random() * 13, skinTemp: 36 + Math.random() * 2,
      hrvRmssd: 20 + Math.random() * 40, mobility: walking ? 0.15 + Math.random() * 0.3 : i >= stillFrom ? 0.004 : 0.2,
    }));
    const fe = edgeFeatures(samples)!;
    const fs = serverFeatures(samples)!;
    assert.equal(fe.stillSeconds, fs.stillSeconds);

    const score = Math.random() < 0.5 ? 0.45 : 0.3 + Math.random() * 0.45;
    const offset = k % 2;
    const zones = offset ? ['Test corridor'] : [];
    const edge = assess({ features: fe, anomalyScore: score, avpu: 'alert', zones, thresholds });
    const server = assessClinicalState({ features: fs, anomalyScore: score, avpu: 'alert', terrain: { zones: zones.map((name) => ({ name })), escalationOffset: offset } });
    assert.equal(edge.tier, server.tier);
    assert.deepEqual(edge.reasons, server.reasons);
  }
});
