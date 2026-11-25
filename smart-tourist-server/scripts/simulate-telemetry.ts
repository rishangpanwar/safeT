/**
 * Wearable telemetry simulator — streams 1 Hz vitals for a tourist through the real API,
 * so the triage pipeline and command dashboard can be demonstrated without hardware.
 *
 *   npm run simulate -- --tourist TID-trek-kedarnath-01 --scenario ams --duration 240 --speed 10
 *
 * Scenarios: normal | ams | cardiac | hypothermia | heatstroke | fall
 * --speed N sends N simulated seconds per real second (timestamps stay 1 s apart).
 * --offline S buffers the first S seconds locally and burst-syncs them (store-and-forward demo).
 * --incident posts an Emergency Distress Event at the end if the tier reached red.
 */

import { Scenario, sampleAt } from '../src/demo/physiology';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, [])
);

const API = (args.api || process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const TOURIST = args.tourist || 'TID-trek-kedarnath-01';
const SCENARIO = (args.scenario || 'normal') as Scenario;
const DURATION = Number(args.duration || 180);
const SPEED = Math.max(1, Number(args.speed || 5));
const OFFLINE_S = Number(args.offline || 0);
const ALTITUDE = Number(args.altitude || 3200);

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}/api/health/${TOURIST}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.message ?? res.statusText}`);
  return json.data;
}

/** Store-and-forward delta encoding (each row = difference from the previous row). */
function deltaEncode(samples: Record<string, number>[]) {
  const fields = ['t', 'hr', 'spo2', 'skinTemp', 'hrvRmssd', 'mobility', 'altitude'];
  const rows = samples.map((s) => fields.map((f) => s[f] ?? null));
  return {
    encoding: 'delta-v1',
    fields,
    base: rows[0],
    deltas: rows.slice(1).map((r, i) => r.map((v, j) => (v == null || rows[i][j] == null ? v : Math.round(((v as number) - (rows[i][j] as number)) * 1000) / 1000))),
  };
}

async function main() {
  console.log(`▶ ${SCENARIO} for ${TOURIST}: ${DURATION}s simulated at ${SPEED}× → ${API}`);
  const start = Date.now() - OFFLINE_S * 1000; // buffered samples are genuinely in the past
  const offline: Record<string, number>[] = [];
  let lastTier = '';

  for (let s = 0; s < DURATION; s++) {
    const sample = sampleAt(SCENARIO, s, start + s * 1000, { altitude: ALTITUDE, onsetSeconds: DURATION * 0.7 });

    if (s < OFFLINE_S) {
      offline.push(sample);
      if (s === OFFLINE_S - 1) {
        const r = await post('/telemetry', deltaEncode(offline));
        console.log(`  ⇪ burst-synced ${r.accepted} buffered samples (${r.buffered} flagged as late)`);
      }
      continue;
    }

    const r = await post('/telemetry', { samples: [sample] });
    const a = r.assessment;
    if (a.tier !== lastTier || s % 15 === 0) {
      console.log(
        `  t=${String(s).padStart(4)}s  HR ${String(sample.hr).padStart(3)}  SpO₂ ${sample.spo2.toFixed(1)}  T ${sample.skinTemp.toFixed(1)}  ` +
          `MEWS ${a.mews}  s=${a.anomalyScore.toFixed(2)} (${a.anomalyLevel})  → ${a.tier.toUpperCase()}${r.advisory ? `  "${r.advisory}"` : ''}`
      );
      lastTier = a.tier;
    }
    await new Promise((res) => setTimeout(res, 1000 / SPEED));
  }

  if (args.incident && lastTier === 'red') {
    const r = await post('/incident', {
      trigger: SCENARIO === 'fall' ? 'fall' : 'vital_anomaly',
      selfCheck: 'expired',
      occurredAt: new Date().toISOString(),
    });
    console.log(`  🚨 incident ${r.alertId}: ${r.dispatch.recommended?.mode} unit from ${r.dispatch.recommended?.unit.name}, ETA ${r.dispatch.recommended?.etaMinutes} min`);
    console.log(`     E-FIR ${r.efir?.firNumber} → ${r.dispatch.destinationFacility?.name}`);
  }
}

main().catch((e) => {
  console.error('✖', e.message);
  process.exit(1);
});
