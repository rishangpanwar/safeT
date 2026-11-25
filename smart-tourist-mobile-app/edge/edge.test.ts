import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FallDetector, FallEvent, MotionSample } from './fallDetection';
import { parseHeartRateMeasurement, parsePlxContinuous, parseTemperatureMeasurement, sfloat, base64ToBytes } from './wearable';

// ------------------------------------------------------------------ synthetic 50 Hz motion

const DT = 20; // ms
const jitter = (sd: number) => (Math.random() - 0.5) * 2 * sd;

function phase(t0: number, ms: number, f: (i: number) => Omit<MotionSample, 't'>): MotionSample[] {
  return Array.from({ length: Math.round(ms / DT) }, (_, i) => ({ t: t0 + i * DT, ...f(i) }));
}
const upright = (sd = 0.02) => () => ({ ax: jitter(sd), ay: 1 + jitter(sd), az: jitter(sd), gx: jitter(5), gy: jitter(5), gz: jitter(5) });
const freeFall = () => ({ ax: 0.1 + jitter(0.05), ay: 0.15 + jitter(0.05), az: 0.1 + jitter(0.05), gx: 320, gy: 90, gz: 40 });
const lyingStill = () => ({ ax: jitter(0.005), ay: jitter(0.005), az: 1 + jitter(0.005), gx: jitter(1), gy: jitter(1), gz: jitter(1) });
const walking = (i: number) => ({ ax: 0.3 * Math.sin(i / 3), ay: 1 + 0.4 * Math.sin(i / 2), az: 0.2 * Math.cos(i / 3), gx: 40, gy: 30, gz: 20 });

function run(stream: MotionSample[]) {
  const events: FallEvent[] = [];
  const d = new FallDetector((e) => events.push(e));
  for (const s of stream) d.push(s);
  return events;
}

function sequence(parts: [number, (i: number) => Omit<MotionSample, 't'>][]): MotionSample[] {
  let t = 0;
  const out: MotionSample[] = [];
  for (const [ms, f] of parts) {
    const p = phase(t, ms, f);
    out.push(...p);
    t += p.length * DT;
  }
  return out;
}

const impact = (peak: number, omega = 300) => (i: number) =>
  i === 0 ? { ax: 0.5, ay: peak, az: 1.2, gx: omega, gy: 80, gz: 60 } : { ax: 0.3, ay: 1.8 - i * 0.1, az: 0.8, gx: 120, gy: 40, gz: 20 };

test('real fall: free fall → impact → lying motionless → confirmed', () => {
  const events = run(sequence([[2000, upright()], [260, freeFall], [100, impact(4.5)], [600, (i) => ({ ax: 0.2 * Math.sin(i), ay: 0.3, az: 1 + 0.3 * Math.cos(i), gx: 30, gy: 10, gz: 5 })], [11000, lyingStill]]));
  assert.equal(events.length, 1);
  const e = events[0];
  assert.ok(e.peakSvm >= 3.2, `peak ${e.peakSvm}`);
  assert.ok(e.peakOmega > 250);
  assert.ok(e.tiltDeg > 60 && e.tiltDeg < 120, `tilt ${e.tiltDeg}`);
  assert.ok(e.svmVariance < 0.02);
  assert.equal(e.fallFromHeight, false);
});

test('fall from height (>400 ms free fall) is flagged', () => {
  const events = run(sequence([[2000, upright()], [700, freeFall], [100, impact(6)], [600, lyingStill], [11000, lyingStill]]));
  assert.equal(events.length, 1);
  assert.equal(events[0].fallFromHeight, true);
});

test('jumping over a puddle (60 ms weightless) is not a fall', () => {
  assert.equal(run(sequence([[2000, upright()], [60, freeFall], [100, impact(3.5)], [12000, walking]])).length, 0);
});

test('fall followed by getting up and walking is not escalated', () => {
  assert.equal(run(sequence([[2000, upright()], [260, freeFall], [100, impact(4.5)], [600, lyingStill], [3000, lyingStill], [8000, walking]])).length, 0);
});

test('dropped phone without body rotation does not pass Stage 2', () => {
  assert.equal(run(sequence([[2000, upright()], [300, () => ({ ...freeFall(), gx: 20, gy: 10, gz: 5 })], [100, impact(4, 60)], [12000, lyingStill]])).length, 0);
});

// Low-energy collapse: knees buckle (|a| ≈ 0.7 g, never < 0.5 g), soft impact, then motionless.
const buckle = () => ({ ax: jitter(0.05), ay: 0.7 + jitter(0.05), az: jitter(0.05), gx: 150, gy: 50, gz: 30 });
const softImpact = (i: number) => (i === 0 ? { ax: 0.4, ay: 2.4, az: 1.0, gx: 200, gy: 80, gz: 60 } : { ax: 0.2, ay: 0.6, az: 0.9, gx: 4, gy: 2, gz: 1 });

test('collapse without free fall (syncope) is confirmed after 20 s motionless', () => {
  const events = run(sequence([[2000, upright()], [400, buckle], [400, softImpact], [21_000, lyingStill]]));
  assert.equal(events.length, 1);
  assert.equal(events[0].lowEnergy, true);
  assert.equal(events[0].freeFallMs, 0);
});

test('flopping down to rest and shifting position is not a collapse', () => {
  const shift = () => ({ ax: 0.3 + jitter(0.1), ay: jitter(0.1), az: 0.9 + jitter(0.1), gx: 40, gy: 20, gz: 10 });
  assert.equal(run(sequence([[2000, upright()], [400, buckle], [400, softImpact], [6000, lyingStill], [600, shift], [8000, lyingStill], [600, shift], [8000, lyingStill]])).length, 0);
});

test('running (flight phases + hard landings) never confirms a fall', () => {
  const stride = (i: number) => {
    const k = i % 17; // ~340 ms stride: 100 ms flight, hard landing, stance
    if (k < 5) return { ax: jitter(0.05), ay: 0.3, az: jitter(0.05), gx: 200, gy: 60, gz: 30 };
    if (k === 5) return { ax: 0.3, ay: 3.4, az: 0.5, gx: 240, gy: 80, gz: 40 };
    return { ax: 0.3 * Math.sin(i), ay: 1.25 + jitter(0.15), az: jitter(0.1), gx: 120, gy: 40, gz: 20 };
  };
  assert.equal(run(sequence([[2000, upright()], [20_000, stride]])).length, 0);
});

// ------------------------------------------------------------------ GATT decoding

test('Heart Rate Measurement 0x2A37 — uint8 HR with RR intervals', () => {
  // flags: RR present (0x10) + contact supported & detected (0x06); HR 72; RR 1024 → 1000 ms, 820 → 801 ms
  const bytes = Uint8Array.from([0x16, 72, 0x00, 0x04, 0x34, 0x03]);
  assert.deepEqual(parseHeartRateMeasurement(bytes), { hr: 72, rr: [1000, 801], contact: true });
  // uint16 HR (flag 0x01) = 300 → bytes 0x2C 0x01
  assert.equal(parseHeartRateMeasurement(Uint8Array.from([0x01, 0x2c, 0x01])).hr, 300);
});

test('PLX 0x2A5F and Temperature 0x2A1C — IEEE-11073 SFLOAT/FLOAT', () => {
  assert.equal(sfloat(0x0062), 98); // exponent 0, mantissa 98
  assert.ok(Math.abs(sfloat(0xf3d5) - 98.1) < 1e-9); // exponent -1, mantissa 981
  assert.ok(Number.isNaN(sfloat(0x07ff)));
  const plx = parsePlxContinuous(Uint8Array.from([0x00, 0x60, 0x00, 0x48, 0x00])); // SpO2 96, PR 72
  assert.deepEqual(plx, { spo2: 96, pulseRate: 72 });
  // 36.7 °C = mantissa 367, exponent -1 → 0x6F 0x01 0x00 0xFF
  assert.ok(Math.abs(parseTemperatureMeasurement(Uint8Array.from([0x00, 0x6f, 0x01, 0x00, 0xff])) - 36.7) < 1e-9);
  // 98.6 °F flag → 37 °C
  assert.ok(Math.abs(parseTemperatureMeasurement(Uint8Array.from([0x01, 0xda, 0x03, 0x00, 0xff])) - 37) < 1e-9);
  assert.deepEqual(Array.from(base64ToBytes('FkgABDQD')), [0x16, 72, 0x00, 0x04, 0x34, 0x03]);
});
