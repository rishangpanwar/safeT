import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averagePathLength, trainIsolationForest, anomalyScore, ANOMALY_WATCH } from '../src/health/isolationForest';
import { generateHealthyBaseline, extractWindowFeatures, rmssd, inferAvpu, trainPopulationForest, stillnessSeconds, VitalSample } from '../src/health/features';
import { assessClinicalState } from '../src/health/triage';
import { computeMews, scoreHeartRate, scoreSpO2, scoreSkinTemp } from '../src/health/mews';
import { pointInPolygon, pointInPolygonPruned, haversineKm, pointInZone, LngLat } from '../src/health/geoMedical';
import { planEvacuation, RescueNode, RescueEdge } from '../src/health/routing';
import {
  computeTokenId, computeClinicalHash, issueEmergencyToken, verifyEmergencyToken, ClinicalProfile,
} from '../src/health/healthIdentity';

test('Eq. 2.1 — c(n) normalisation factor', () => {
  assert.equal(averagePathLength(1), 0);
  assert.equal(averagePathLength(2), 1);
  assert.ok(Math.abs(averagePathLength(256) - 10.2448) < 1e-3);
});

test('Isolation Forest separates silent incapacitation from normal trekking', () => {
  const forest = trainIsolationForest(generateHealthyBaseline(4000, 7), { numTrees: 100, subsampleSize: 256 });
  const holdout = generateHealthyBaseline(500, 99);
  const normalScores = holdout.map((x) => anomalyScore(forest, x));
  const meanNormal = normalScores.reduce((a, b) => a + b, 0) / normalScores.length;
  const p95 = normalScores.slice().sort((a, b) => a - b)[Math.floor(normalScores.length * 0.95)];

  // SpO2 96 → 74 % with HR spiking to 165 bpm (report §2.2-A.2 example), motionless.
  const hypoxicCollapse = anomalyScore(forest, [165, 45, 74, 9, 36.9, 0.005]);
  // Bradycardic syncope, cold, no movement.
  const syncope = anomalyScore(forest, [38, -40, 90, 95, 34.6, 0.004]);

  assert.ok(meanNormal < 0.5, `normal mean ${meanNormal}`);
  assert.ok(p95 < 0.6, `normal p95 ${p95}`);
  assert.ok(hypoxicCollapse > 0.65, `hypoxic collapse ${hypoxicCollapse}`);
  assert.ok(syncope > 0.65, `syncope ${syncope}`);
  for (const s of [...normalScores, hypoxicCollapse, syncope]) assert.ok(s > 0 && s < 1);
});

test('Table 2.1 — MEWS bands and tiers', () => {
  assert.deepEqual([40, 41, 50, 51, 100, 101, 110, 111, 129, 130].map(scoreHeartRate), [3, 2, 2, 0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual([84, 85, 90, 91, 94, 95].map(scoreSpO2), [3, 2, 2, 1, 1, 0]);
  assert.deepEqual([34.9, 35.0, 35.9, 36.0, 37.5, 37.6, 38.4, 38.5, 39.9, 40.0].map(scoreSkinTemp), [2, 1, 1, 0, 0, 1, 1, 2, 2, 3]);

  assert.equal(computeMews({ hr: 80, spo2: 97, skinTemp: 36.8, avpu: 'alert' }).tier, 'green');
  assert.equal(computeMews({ hr: 105, spo2: 92, skinTemp: 37.8 }).tier, 'yellow'); // 1 + 1 + 1
  const red = computeMews({ hr: 135, spo2: 82, skinTemp: 36.8, avpu: 'unresponsive' });
  assert.equal(red.total, 9);
  assert.equal(red.tier, 'red');
  assert.equal(red.bypassConfirmation, true);

  // Hypoxia corridor lowers thresholds by one point.
  assert.equal(computeMews({ hr: 105, spo2: 93 }).tier, 'green');
  assert.equal(computeMews({ hr: 105, spo2: 93 }, 1).tier, 'yellow');
});

test('Feature window + kinematic AVPU', () => {
  assert.ok(Math.abs(rmssd([800, 810, 790, 805])! - Math.sqrt((100 + 400 + 225) / 3)) < 1e-9);
  const t0 = Date.now();
  const samples = Array.from({ length: 90 }, (_, i) => ({ t: t0 + i * 1000, hr: i < 60 ? 80 : 140, spo2: 96, skinTemp: 36.7, mobility: 0.2 }));
  const f = extractWindowFeatures(samples)!;
  assert.equal(f.sampleCount, 60); // only the last 60 s
  assert.ok(f.named.deltaHr > 0);
  assert.equal(inferAvpu('expired', 0.001), 'unresponsive');
  assert.equal(inferAvpu('expired', 0.3), 'pain');
  assert.equal(inferAvpu('responded', 0.3), 'voice');
  assert.equal(inferAvpu('none', 0), 'alert');
});

test('Eq. 2.7 — ray casting with MBB pruning', () => {
  const square: LngLat[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(15, 5, square), false);
  // Concave "U" shape: the notch is outside.
  const u: LngLat[] = [[0, 0], [9, 0], [9, 9], [6, 9], [6, 3], [3, 3], [3, 9], [0, 9]];
  assert.equal(pointInPolygon(4.5, 6, u), false);
  assert.equal(pointInPolygon(1.5, 6, u), true);
  assert.equal(pointInPolygonPruned(50, 50, u), false);
  assert.equal(pointInZone(30.7346, 79.0669, { type: 'Circle', coordinates: [79.0669, 30.7346], radius: 10 }), true);
});

test('Eq. 2.8 — Haversine distance', () => {
  const delhiMumbai = haversineKm(28.6139, 77.209, 19.076, 72.8777);
  assert.ok(Math.abs(delhiMumbai - 1153) < 5, `${delhiMumbai}`);
});

test('Evacuation routing picks the fastest asset and a definitive-care facility', () => {
  const nodes: RescueNode[] = [
    { nodeId: 'sar', name: 'SAR base', kind: 'sar_base', lat: 30.63, lng: 79.0, elevation: 1800 },
    { nodeId: 'camp', name: 'Trail camp', kind: 'medical_post', lat: 30.70, lng: 79.04, elevation: 3000 },
    { nodeId: 'heli', name: 'Heli base', kind: 'helipad', lat: 30.52, lng: 79.08, elevation: 1300, airAmbulance: true },
    { nodeId: 'hosp', name: 'Trauma centre', kind: 'trauma_center', lat: 30.28, lng: 78.98, elevation: 900, traumaLevel: 2 },
  ];
  const edges: RescueEdge[] = [
    { from: 'sar', to: 'camp', terrain: 'trail', passable: true },
    { from: 'sar', to: 'heli', terrain: 'road', passable: true },
    { from: 'heli', to: 'hosp', terrain: 'road', passable: true },
  ];
  const victim = { lat: 30.72, lng: 79.05, elevation: 3300 };

  const withAir = planEvacuation(victim, { nodes, edges });
  assert.equal(withAir.recommended?.mode, 'air'); // on-foot climb from the SAR base is slow
  assert.ok(withAir.options.some((o) => o.mode === 'ground'));
  assert.equal(withAir.destinationFacility?.nodeId, 'hosp');
  assert.equal(withAir.nearestMedicalPost?.nodeId, 'camp');

  const groundOnly = planEvacuation(victim, { nodes, edges }, { airEvacuationPossible: false });
  assert.equal(groundOnly.recommended?.mode, 'ground');
  assert.ok(groundOnly.recommended!.route.length >= 2);
  assert.ok(groundOnly.recommended!.etaMinutes > withAir.recommended!.etaMinutes);
});

test('Eq. 2.9 — health identity token: sign, verify, decrypt, detect tampering', () => {
  const profile: ClinicalProfile = {
    fullName: 'Asha Rao', age: 34, bloodGroup: 'B+', allergies: ['Penicillin'], chronicConditions: ['Type 1 diabetes'],
    medications: ['Insulin'], emergencyContacts: [{ name: 'Ravi Rao', phone: '+91 98765 43210' }],
  };
  const tokenId = computeTokenId('a1234567');
  assert.equal(tokenId, computeTokenId(' A1234567 '));
  assert.match(tokenId, /^[0-9a-f]{64}$/);

  const salt = 'abcd';
  const clinicalHash = computeClinicalHash(profile, salt);
  assert.notEqual(clinicalHash, computeClinicalHash({ ...profile, bloodGroup: 'O-' }, salt));

  const token = issueEmergencyToken(
    { tid: tokenId, did: 'TID-1', exp: Math.floor(Date.now() / 1000) + 3600 },
    { profile, clinicalHash, privateSalt: salt }
  );
  const verified = verifyEmergencyToken(token);
  assert.equal(verified.profile.bloodGroup, 'B+');
  assert.equal(verified.hashConsistent, true);
  assert.equal(verified.expired, false);
  assert.ok(!token.includes('Penicillin')); // nothing readable without the responder key

  const parts = token.split('.');
  const forgedHeader = Buffer.from(JSON.stringify({ ...verified.header, did: 'TID-2' })).toString('base64url');
  assert.throws(() => verifyEmergencyToken([parts[0], forgedHeader, parts[2], parts[3]].join('.')), /Signature/);
});

// ------------------------------------------------------------------ accuracy improvements

const steady = (n: number, v: Partial<VitalSample>, t0 = Date.UTC(2026, 0, 1)): VitalSample[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + i * 1000, hr: 80, spo2: 97, skinTemp: 36.9, hrvRmssd: 40, mobility: 0.2, ...v }));

test('HR-activity coupling: the forest learns that heart rate follows movement', () => {
  const plain = trainIsolationForest(generateHealthyBaseline(4000, 7), { numTrees: 100, subsampleSize: 256, seed: 42, coupling: false });
  const coupled = trainPopulationForest();
  assert.equal(plain.coupling, undefined);
  assert.ok(coupled.coupling && coupled.coupling.slope > 50, JSON.stringify(coupled.coupling)); // HR rises with mobility

  // Lying motionless with 118 bpm: ordinary on either axis alone, abnormal together.
  const casualty = [118, -10, 96, 35, 37.0, 0.003];
  assert.ok(anomalyScore(coupled, casualty) > anomalyScore(plain, casualty), 'coupling raises the casualty score');

  // The healthy score distribution stays below the watch threshold the thresholds were calibrated for.
  const holdout = generateHealthyBaseline(2000, 99).map((x) => anomalyScore(coupled, x)).sort((a, b) => a - b);
  assert.ok(holdout[Math.floor(holdout.length * 0.99)] < ANOMALY_WATCH, `p99 ${holdout[Math.floor(holdout.length * 0.99)]}`);
});

test('Stillness timer counts the motionless run ending at the newest sample', () => {
  const moving = steady(30, { mobility: 0.3 });
  const still = steady(200, { mobility: 0.004 }, moving[29].t + 1000);
  assert.equal(stillnessSeconds([...moving, ...still]), 199);
  assert.equal(stillnessSeconds(moving), 0);
  assert.equal(extractWindowFeatures([...moving, ...still])!.stillSeconds, 199);
});

test('Kinematic context: exertional tachycardia is not escalated, bradycardia and watch scores are', () => {
  const terrain = { zones: [], altitude: 3600, escalationOffset: 1 }; // Yellow ≥ 2, Red ≥ 4
  const climbing = extractWindowFeatures(steady(60, { hr: 118, spo2: 91, mobility: 0.28 }))!; // HR +2, SpO₂ +1

  const healthy = assessClinicalState({ features: climbing, anomalyScore: 0.45, avpu: 'alert', terrain });
  assert.equal(healthy.mews.total, 3); // Table 2.1 score is reported unchanged
  assert.equal(healthy.tier, 'green'); // only the SpO₂ point escalates
  assert.ok(healthy.reasons.some((r) => r.includes('matches walking effort')));

  // A forest "watch" score means the heart rate is out of proportion to the effort: it counts again.
  assert.equal(assessClinicalState({ features: climbing, anomalyScore: 0.62, avpu: 'alert', terrain }).tier, 'yellow');

  // Bradycardia while walking is never discounted.
  const brady = extractWindowFeatures(steady(60, { hr: 45, spo2: 91, mobility: 0.28 }))!;
  assert.equal(assessClinicalState({ features: brady, anomalyScore: 0.45, avpu: 'alert', terrain }).tier, 'yellow');
});

test('Kinematic context: resting tachycardia after 2 min of stillness raises the self-check', () => {
  const terrain = { zones: [], escalationOffset: 0 };
  const short = extractWindowFeatures(steady(100, { hr: 112, mobility: 0.003 }))!; // 99 s still
  const long = extractWindowFeatures(steady(200, { hr: 112, mobility: 0.003 }))!; // 199 s still

  assert.equal(assessClinicalState({ features: short, anomalyScore: 0.5, avpu: 'alert', terrain }).tier, 'green'); // MEWS 2
  const down = assessClinicalState({ features: long, anomalyScore: 0.5, avpu: 'alert', terrain });
  assert.equal(down.tier, 'red');
  assert.equal(down.requiresSelfCheck, true);
  assert.ok(down.reasons[0].includes('motionless for 3 min'), down.reasons[0]);

  // A healthy resting heart rate never trips it, however long the rest.
  const nap = extractWindowFeatures(steady(600, { hr: 72, mobility: 0.003 }))!;
  assert.equal(assessClinicalState({ features: nap, anomalyScore: 0.5, avpu: 'alert', terrain }).tier, 'green');
});
