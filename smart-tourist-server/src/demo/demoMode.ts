/**
 * Live demo mode (DEMO_MODE=true, or `npm run demo`).
 *
 * Streams a cohort of simulated wearers through the *real* pipeline — telemetry ingestion,
 * Isolation Forest + MEWS triage, self-check, incident, Dijkstra dispatch, E-FIR — so the
 * command portal looks and behaves like a live deployment during a presentation.
 *
 * Each tourist walks (or drives) a real route at a realistic pace; altitude along the route
 * drives the SpO₂ baseline. A director periodically starts a health episode on one tourist:
 *   mild   → the tier reaches Watch, the tourist answers the 30 s self-check "I'm OK", recovers
 *   severe → the tier reaches Critical, the self-check expires, the phone raises an incident;
 *            if no operator confirms dispatch the duty officer does, the unit "arrives" and
 *            the patient is handed over at the destination facility, then later rejoins.
 * Operators can resolve or dispatch from the portal at any time and the cohort reacts.
 */

import { ObjectId } from 'mongodb';
import { getCollections } from '../config/database';
import healthMonitoringService from '../services/healthMonitoringService';
import { issueHealthIdentity, renewPermitIfExpiring } from '../services/healthIdentityService';
import { AuthService } from '../services/authService';
import { Scenario, sampleAt } from './physiology';

interface Realtime {
  broadcastToAuthorities(event: string, data: any): void;
  handleRestLocation(touristId: string, loc: { latitude: number; longitude: number; altitude?: number }): void;
}

type Region = 'kedarnath' | 'rohtang' | 'jaipur';
type Waypoint = [lat: number, lng: number, altitude: number];
type Phase = 'roaming' | 'episode' | 'incident' | 'hospital';

const TICK_MS = 5_000;
const SELF_CHECK_MS = 30_000; // the phone's "ARE YOU OK?" countdown
const MILD_RESPONSE_MS = 12_000; // a mildly unwell tourist taps "I'm OK" after ~12 s
const AUTO_DISPATCH_MS = 3 * 60_000; // duty officer confirms the recommended unit if nobody else does
const MAX_TRANSIT_MS = 3 * 60_000; // demo cap on the unit's travel time (real ETA is still shown)
const HOSPITAL_STAY_MS = 8 * 60_000;
const MAX_CONCURRENT_EPISODES = 2;
const TELEMETRY_RETENTION_MS = 2 * 60 * 60_000;

const ROUTES: Record<Region, { waypoints: Waypoint[]; speedMps: [number, number] }> = {
  // Gaurikund → Kedarnath base (16 km trek, 1,982 → 3,583 m)
  kedarnath: {
    waypoints: [[30.6526, 79.0247, 1982], [30.669, 79.03, 2400], [30.686, 79.036, 2700], [30.712, 79.048, 3000], [30.7265, 79.0595, 3400], [30.7346, 79.0669, 3583]],
    speedMps: [0.7, 1.1],
  },
  // Manali → Rohtang Pass by road (2,050 → 3,978 m), stop-start traffic
  rohtang: {
    waypoints: [[32.2432, 77.1892, 2050], [32.317, 77.194, 2500], [32.329, 77.205, 2900], [32.353, 77.228, 3300], [32.3716, 77.2466, 3978]],
    speedMps: [4, 7],
  },
  // Jaipur heritage circuit: Hawa Mahal → City Palace → Jantar Mantar → Jal Mahal → Amer Fort
  jaipur: {
    waypoints: [[26.9239, 75.8267, 431], [26.9258, 75.8237, 431], [26.9248, 75.8246, 431], [26.9535, 75.8463, 430], [26.9855, 75.8513, 520]],
    speedMps: [1.0, 2.5],
  },
};

/** Episode mix per region: altitude illness dominates the Himalaya, heat dominates Jaipur. */
const EPISODES: Record<Region, [Scenario, number][]> = {
  kedarnath: [['ams', 0.4], ['hypothermia', 0.2], ['fall', 0.25], ['cardiac', 0.15]],
  rohtang: [['ams', 0.45], ['hypothermia', 0.3], ['cardiac', 0.25]],
  jaipur: [['heatstroke', 0.5], ['cardiac', 0.25], ['fall', 0.25]],
};

const COHORT: { id: string; name: string; nationality: string; region: Region; age: number; blood: string; allergies: string[]; conditions: string[]; meds: string[]; contact: [string, string, string] }[] = [
  { id: 'TID-demo-ked-01', name: 'Rohan Iyer', nationality: 'Indian', region: 'kedarnath', age: 34, blood: 'O+', allergies: [], conditions: [], meds: [], contact: ['Priya Iyer', '+91-9810000101', 'Spouse'] },
  { id: 'TID-demo-ked-02', name: 'Sunita Rawat', nationality: 'Indian', region: 'kedarnath', age: 58, blood: 'A+', allergies: ['Sulfa drugs'], conditions: ['Type 2 diabetes'], meds: ['Metformin 500 mg'], contact: ['Vikram Rawat', '+91-9810000102', 'Son'] },
  { id: 'TID-demo-ked-03', name: 'Lukas Becker', nationality: 'German', region: 'kedarnath', age: 27, blood: 'B+', allergies: [], conditions: [], meds: [], contact: ['Anna Becker', '+49-1510000103', 'Mother'] },
  { id: 'TID-demo-ked-04', name: 'Meera Joshi', nationality: 'Indian', region: 'kedarnath', age: 41, blood: 'AB+', allergies: ['Penicillin'], conditions: ['Asthma'], meds: ['Budesonide inhaler'], contact: ['Arjun Joshi', '+91-9810000104', 'Spouse'] },
  { id: 'TID-demo-ked-05', name: 'Kenji Watanabe', nationality: 'Japanese', region: 'kedarnath', age: 63, blood: 'A-', allergies: [], conditions: ['Hypertension', 'Atrial fibrillation'], meds: ['Apixaban 5 mg', 'Losartan 50 mg'], contact: ['Yui Watanabe', '+81-9000000105', 'Daughter'] },
  { id: 'TID-demo-roh-01', name: 'Harpreet Gill', nationality: 'Indian', region: 'rohtang', age: 45, blood: 'B-', allergies: [], conditions: ['Hypertension'], meds: ['Amlodipine 5 mg'], contact: ['Jaspreet Gill', '+91-9810000201', 'Spouse'] },
  { id: 'TID-demo-roh-02', name: 'Olivia Martin', nationality: 'Australian', region: 'rohtang', age: 31, blood: 'O-', allergies: ['Latex'], conditions: [], meds: [], contact: ['Jack Martin', '+61-4000000202', 'Brother'] },
  { id: 'TID-demo-roh-03', name: 'Ananya Sharma', nationality: 'Indian', region: 'rohtang', age: 22, blood: 'A+', allergies: [], conditions: [], meds: [], contact: ['Ramesh Sharma', '+91-9810000203', 'Father'] },
  { id: 'TID-demo-jpr-01', name: 'Carlos Mendes', nationality: 'Brazilian', region: 'jaipur', age: 52, blood: 'O+', allergies: ['Ibuprofen'], conditions: ['Coronary artery disease'], meds: ['Aspirin 75 mg', 'Atorvastatin 20 mg'], contact: ['Lucia Mendes', '+55-1100000301', 'Spouse'] },
  { id: 'TID-demo-jpr-02', name: 'Fatima Khan', nationality: 'Indian', region: 'jaipur', age: 67, blood: 'B+', allergies: [], conditions: ['Chronic kidney disease'], meds: ['Furosemide 20 mg'], contact: ['Imran Khan', '+91-9810000302', 'Son'] },
  { id: 'TID-demo-jpr-03', name: 'Sophie Laurent', nationality: 'French', region: 'jaipur', age: 29, blood: 'A+', allergies: [], conditions: [], meds: [], contact: ['Marc Laurent', '+33-6000000303', 'Partner'] },
  { id: 'TID-demo-jpr-04', name: 'David Okafor', nationality: 'Nigerian', region: 'jaipur', age: 38, blood: 'O+', allergies: ['Shellfish'], conditions: ['Sickle cell trait'], meds: [], contact: ['Grace Okafor', '+234-8000000304', 'Spouse'] },
];

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: [T, number][]): T => {
  let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[xs.length - 1][0];
};

function haversineM(a: Waypoint, b: Waypoint) {
  const R = 6371e3, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLng = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

class Path {
  readonly cumulative: number[] = [0];
  constructor(readonly waypoints: Waypoint[]) {
    for (let i = 1; i < waypoints.length; i++) this.cumulative.push(this.cumulative[i - 1] + haversineM(waypoints[i - 1], waypoints[i]));
  }
  get length() {
    return this.cumulative[this.cumulative.length - 1];
  }
  at(d: number): Waypoint {
    const x = Math.min(this.length, Math.max(0, d));
    let i = 1;
    while (i < this.cumulative.length - 1 && this.cumulative[i] < x) i++;
    const seg = this.cumulative[i] - this.cumulative[i - 1] || 1;
    const p = (x - this.cumulative[i - 1]) / seg;
    const [a, b] = [this.waypoints[i - 1], this.waypoints[i]];
    return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
  }
}

interface Episode {
  scenario: Scenario;
  severe: boolean;
  s: number; // seconds into the episode
  onset: number;
  startedAt: number;
  selfCheckAt?: number; // when the phone's self-check countdown started
}

interface Wearer {
  id: string;
  name: string;
  region: Region;
  path: Path;
  d: number; // metres along the path
  dir: 1 | -1;
  speed: number;
  baseline: { hr: number; spo2: number; skinTemp: number; hrv: number; phase: number };
  lastT: number;
  idleS: number; // seconds of the resting/normal stream (for the walking rhythm)
  phase: Phase;
  episode?: Episode;
  incidentId?: ObjectId;
  incidentAt?: number;
  arrivalAt?: number;
  hospital?: { lat: number; lng: number; altitude: number; until: number };
  lastHistoryAt: number;
  ticks: number;
  tier?: string;
}

class DemoMode {
  private wearers: Wearer[] = [];
  private realtime?: Realtime;
  private nextEpisodeAt = Date.now() + 60_000;
  private everyMs = Number(process.env.DEMO_EPISODE_EVERY_S || 240) * 1000;
  private running = false;
  private startedAt = 0;
  private episodesStarted = 0;

  get enabled() {
    return this.startedAt > 0;
  }

  async start(realtime: Realtime) {
    this.realtime = realtime;
    await this.ensureDemoLogin();
    await this.ensureCohort();
    await this.closeStaleIncidents();
    this.startedAt = Date.now();
    const timer = setInterval(() => this.tick().catch((e) => console.error('[Demo] Tick failed:', e)), TICK_MS);
    timer.unref?.();
    const prune = setInterval(() => this.prune().catch(() => undefined), 10 * 60_000);
    prune.unref?.();
    console.log(`🎬 Demo mode: ${this.wearers.length} simulated wearers streaming every ${TICK_MS / 1000}s; first health episode in ~60 s, then every ~${Math.round(this.everyMs / 60_000)} min`);
  }

  status() {
    return {
      enabled: this.enabled,
      wearers: this.wearers.length,
      startedAt: this.startedAt ? new Date(this.startedAt) : null,
      episodesStarted: this.episodesStarted,
      nextEpisodeInSeconds: Math.max(0, Math.round((this.nextEpisodeAt - Date.now()) / 1000)),
      active: this.wearers
        .filter((w) => w.phase === 'episode' || w.phase === 'incident')
        .map((w) => ({ digitalId: w.id, name: w.name, scenario: w.episode?.scenario, severe: w.episode?.severe, phase: w.phase })),
    };
  }

  /** Presenter control: start an episode now (optionally on a chosen tourist / scenario). */
  trigger(opts: { digitalId?: string; scenario?: Scenario; severe?: boolean } = {}) {
    if (!this.enabled) throw Object.assign(new Error('Demo mode is not running'), { status: 409 });
    const free = this.wearers.filter((w) => w.phase === 'roaming' && (!opts.digitalId || w.id === opts.digitalId));
    if (!free.length) throw Object.assign(new Error(opts.digitalId ? 'That tourist is already in an episode or in hospital' : 'Every simulated tourist is busy — try again shortly'), { status: 409 });
    // A requested scenario goes to someone it is plausible for (no altitude sickness in Jaipur).
    const plausible = opts.scenario ? free.filter((w) => EPISODES[w.region].some(([s]) => s === opts.scenario)) : free;
    const candidates = plausible.length ? plausible : free;
    const w = candidates[Math.floor(Math.random() * candidates.length)];
    const scenario = opts.scenario && opts.scenario !== 'normal' ? opts.scenario : pick(EPISODES[w.region]);
    this.beginEpisode(w, scenario, opts.severe ?? true);
    return { digitalId: w.id, name: w.name, scenario, severe: w.episode!.severe };
  }

  // ------------------------------------------------------------------ setup

  /** The same account POST /api/auth/create-sample-gov creates, so the portal works out of the box. */
  private async ensureDemoLogin() {
    const { users } = await getCollections();
    if (await users.findOne({ username: 'gov_admin' }, { projection: { _id: 1 } })) return;
    const r = await new AuthService().registerGovernmentOfficial({
      username: 'gov_admin',
      email: 'admin@government.in',
      password: 'GovAdmin@123',
      governmentId: 'GOV-ADMIN001',
      profile: {
        fullName: 'Government Administrator',
        department: 'Tourism Safety Department',
        phone: '+91-9876543210',
        address: { street: '123 Government Complex', city: 'New Delhi', state: 'Delhi', country: 'India', zipCode: '110001' },
      },
    });
    if (!r.success) console.warn(`[Demo] Could not create the demo login: ${r.message}`);
  }

  private async ensureCohort() {
    const { tourists } = await getCollections();
    for (const c of COHORT) {
      const route = ROUTES[c.region];
      const path = new Path(route.waypoints);
      const d = rand(0.05, 0.9) * path.length;
      const [lat, lng, altitude] = path.at(d);
      if (!(await tourists.findOne({ digitalId: c.id }, { projection: { _id: 1 } }))) {
        const validUntil = new Date(Date.now() + 10 * 864e5);
        const healthProfile = await issueHealthIdentity({
          fullName: c.name,
          validUntil,
          input: {
            nationalId: `DEMO-${c.id}`, age: c.age, bloodGroup: c.blood, allergies: c.allergies, chronicConditions: c.conditions,
            medications: c.meds, emergencyContacts: [{ name: c.contact[0], phone: c.contact[1], relationship: c.contact[2] }], consent: true,
          },
        });
        await tourists.insertOne({
          digitalId: c.id,
          kyc: { name: c.name, nationality: c.nationality, passportNumber: `DEMO${c.id.slice(-6).replace('-', '')}`, phoneNumber: c.contact[1], emergencyContact: [c.contact[1]] },
          itinerary: { destinations: [{ kedarnath: 'Kedarnath Temple', rohtang: 'Rohtang Pass', jaipur: 'Amer Fort' }[c.region]] },
          safetyStatus: 'Normal',
          isActive: true,
          registeredAt: new Date().toISOString(),
          validUntil: validUntil.toISOString(),
          currentLocation: { latitude: lat, longitude: lng, altitude, timestamp: new Date() },
          lastLocationUpdate: new Date(),
          healthProfile,
          metadata: { demo: true },
        } as any);
      } else {
        await renewPermitIfExpiring(c.id, 10);
        await tourists.updateOne({ digitalId: c.id }, { $set: { isActive: true, safetyStatus: 'Normal' }, $unset: { 'health.activeIncidentId': '' } });
      }
      this.wearers.push({
        id: c.id, name: c.name, region: c.region, path, d,
        dir: Math.random() < 0.7 ? 1 : -1,
        speed: rand(...route.speedMps),
        baseline: { hr: rand(-8, 8) + (c.age > 55 ? -4 : 0), spo2: rand(-0.8, 0.6), skinTemp: rand(-0.2, 0.2), hrv: rand(-8, 10) - (c.age > 55 ? 8 : 0), phase: rand(0, 250) },
        lastT: Date.now() - 60_000, // backfill one window so the first assessment is meaningful
        idleS: 0,
        phase: 'roaming',
        lastHistoryAt: 0,
        ticks: 0,
      });
    }
  }

  /** Incidents left open by a previous run have no simulation driving them any more. */
  private async closeStaleIncidents() {
    const { alerts } = await getCollections();
    const r = await alerts.updateMany(
      { touristId: { $in: COHORT.map((c) => c.id) }, status: { $in: ['active', 'acknowledged'] } },
      { $set: { status: 'resolved', 'timeline.resolvedAt': new Date(), 'timeline.resolvedBy': 'demo', 'timeline.notes': 'Closed when the demo restarted' } }
    );
    if (r.modifiedCount) console.log(`[Demo] Closed ${r.modifiedCount} incident(s) left open by the previous run`);
  }

  private async prune() {
    const { healthTelemetry, locationHistory } = await getCollections();
    const ids = COHORT.map((c) => c.id);
    await healthTelemetry.deleteMany({ touristId: { $in: ids }, t: { $lt: Date.now() - TELEMETRY_RETENTION_MS } });
    await locationHistory.deleteMany({ touristId: { $in: ids }, timestamp: { $lt: new Date(Date.now() - TELEMETRY_RETENTION_MS) } } as any);
  }

  // ------------------------------------------------------------------ simulation

  private async tick() {
    if (this.running) return; // a slow database must not pile up overlapping ticks
    this.running = true;
    try {
      this.direct();
      await Promise.all(this.wearers.map((w) => this.step(w).catch((e) => console.error(`[Demo] ${w.id}:`, e.message))));
    } finally {
      this.running = false;
    }
  }

  private direct() {
    const now = Date.now();
    if (now < this.nextEpisodeAt) return;
    const busy = this.wearers.filter((w) => w.phase === 'episode' || w.phase === 'incident').length;
    const candidates = this.wearers.filter((w) => w.phase === 'roaming' && (w.tier ?? 'green') === 'green');
    if (busy >= MAX_CONCURRENT_EPISODES || !candidates.length) return;
    const w = candidates[Math.floor(Math.random() * candidates.length)];
    this.beginEpisode(w, pick(EPISODES[w.region]), Math.random() < 0.7);
    this.nextEpisodeAt = now + this.everyMs * rand(0.75, 1.25);
  }

  private beginEpisode(w: Wearer, scenario: Scenario, severe: boolean) {
    // Falls are always followed by an unanswered self-check — that is what makes them incidents.
    const isFall = scenario === 'fall';
    w.phase = 'episode';
    w.episode = { scenario, severe: isFall || severe, s: 0, onset: isFall ? 60 : rand(100, 160), startedAt: Date.now() };
    this.episodesStarted++;
    console.log(`[Demo] ${w.name} (${w.id}): ${w.episode.severe ? 'severe' : 'mild'} ${scenario} episode begins`);
  }

  private async step(w: Wearer) {
    const now = Date.now();
    w.ticks++;
    const e = w.episode;

    // Movement: tourists stop once an episode takes hold; a fall stops them immediately.
    const incapacitated = !!e && (e.scenario === 'fall' ? e.s >= 20 : e.s > e.onset * 0.5);
    if (w.phase === 'roaming' || (w.phase === 'episode' && !incapacitated)) {
      const slow = w.phase === 'episode' ? 0.4 : 1;
      w.d += w.dir * w.speed * slow * (TICK_MS / 1000);
      if (w.d >= w.path.length) { w.d = w.path.length; w.dir = -1; }
      if (w.d <= 0) { w.d = 0; w.dir = 1; }
    }
    const [lat, lng, altitude] = w.phase === 'hospital' && w.hospital ? [w.hospital.lat, w.hospital.lng, w.hospital.altitude] : w.path.at(w.d);

    // 1 Hz samples since the last tick, in the exact shape the phone uploads.
    const samples = [];
    while (w.lastT + 1000 <= now) {
      w.lastT += 1000;
      const scenario: Scenario = e ? e.scenario : 'normal';
      // A mild episode never progresses past ~40 % — enough for Watch, not Critical.
      const s = e ? (e.severe ? e.s : Math.min(e.s, e.onset * 0.4)) : w.idleS;
      samples.push(sampleAt(scenario, s, w.lastT, { altitude: Math.round(altitude), onsetSeconds: e?.onset ?? 120, baseline: w.baseline, resting: w.phase === 'hospital' }));
      if (e) e.s++; else w.idleS++;
    }
    if (!samples.length) return;

    await this.moveTo(w, lat, lng, altitude, now);
    const r = await healthMonitoringService.ingest(w.id, samples, { location: { lat, lng, altitude } });
    w.tier = r.assessment.tier;

    if (w.phase === 'episode') await this.episodeLogic(w, lat, lng, altitude, now);
    else if (w.phase === 'incident') await this.incidentLogic(w, now);
    else if (w.phase === 'hospital' && w.hospital && now > w.hospital.until) this.discharge(w);
  }

  private async moveTo(w: Wearer, lat: number, lng: number, altitude: number, now: number) {
    const { tourists, locationHistory } = await getCollections();
    const currentLocation = { latitude: lat, longitude: lng, altitude: Math.round(altitude), timestamp: new Date(now) };
    await tourists.updateOne({ digitalId: w.id }, { $set: { currentLocation, lastLocationUpdate: new Date(now) } });
    if (now - w.lastHistoryAt > 30_000) {
      w.lastHistoryAt = now;
      await locationHistory.insertOne({ touristId: w.id, location: { latitude: lat, longitude: lng, altitude: Math.round(altitude), accuracy: 8 }, timestamp: new Date(now), isEmergency: w.phase === 'incident', source: 'mobile_app' } as any);
    }
    // Every third tick also runs the geo-fence / geo-medical zone checks (entry & exit are de-duplicated).
    if (w.ticks % 3 === 0) this.realtime?.handleRestLocation(w.id, { latitude: lat, longitude: lng, altitude });
    else this.realtime?.broadcastToAuthorities('tourist_location_update', { touristId: w.id, location: { latitude: lat, longitude: lng, altitude }, timestamp: new Date(now) });
  }

  /** What the phone would do: show the self-check, then either cancel (I'm OK) or raise an incident. */
  private async episodeLogic(w: Wearer, lat: number, lng: number, altitude: number, now: number) {
    const e = w.episode!;
    const isFall = e.scenario === 'fall';

    if (!e.selfCheckAt) {
      const due = isFall ? e.s >= 20 : e.severe ? w.tier === 'red' : w.tier === 'yellow' || w.tier === 'red';
      if (due) e.selfCheckAt = now;
      else if (!e.severe && now - e.startedAt > 5 * 60_000) return this.recover(w); // mild episode that never escalated
      return;
    }

    if (!e.severe) {
      if (now - e.selfCheckAt >= MILD_RESPONSE_MS) {
        await healthMonitoringService.recordSelfCheck(w.id, 'responded', `Tourist confirmed OK during mild ${e.scenario}`);
        console.log(`[Demo] ${w.name} answered the self-check: I'm OK`);
        this.recover(w);
      }
      return;
    }

    if (now - e.selfCheckAt < SELF_CHECK_MS) return;
    await healthMonitoringService.recordSelfCheck(w.id, 'expired', isFall ? 'No response after fall' : 'No response to critical-vitals alarm');
    const r = await healthMonitoringService.reportIncident(w.id, {
      trigger: isFall ? 'fall' : 'vital_anomaly',
      selfCheck: 'expired',
      occurredAt: new Date(e.selfCheckAt).toISOString(),
      location: { lat, lng, altitude: Math.round(altitude), accuracy: 8 },
      ...(isFall ? { fallEvent: { freeFallMs: 380, peakSvmG: 3.7, peakJerkGps: 94, peakOmegaDps: 412, tiltDeg: 81, immobileS: 30, confirmed: true } } : {}),
    });
    w.phase = 'incident';
    w.incidentId = r.alertId;
    w.incidentAt = now;
    console.log(`[Demo] ${w.name}: incident ${r.alertId} → ${r.dispatch.recommended?.unit.name ?? 'no unit'} (ETA ${r.dispatch.recommended?.etaMinutes ?? '?'} min)`);
  }

  private async incidentLogic(w: Wearer, now: number) {
    const { alerts, medicalFacilities } = await getCollections();
    const inc: any = await alerts.findOne({ _id: w.incidentId });
    if (!inc || inc.status === 'resolved' || inc.status === 'false_alarm') {
      // Closed by an operator from the portal.
      return this.recover(w);
    }

    if (!inc.dispatch?.dispatchedAt && now - (w.incidentAt ?? now) > AUTO_DISPATCH_MS && inc.dispatch?.recommended) {
      const updated = await alerts.findOneAndUpdate(
        { _id: inc._id, 'dispatch.dispatchedAt': { $exists: false } },
        { $set: { status: 'acknowledged', 'dispatch.dispatchedUnit': inc.dispatch.recommended.unit.nodeId, 'dispatch.dispatchedAt': new Date(), 'dispatch.dispatchedBy': 'demo-duty-officer', 'timeline.acknowledgedAt': new Date(), 'timeline.acknowledgedBy': 'demo-duty-officer', 'timeline.updatedAt': new Date() } },
        { returnDocument: 'after' }
      );
      if (updated) this.realtime?.broadcastToAuthorities('health_incident', { ...updated, touristName: w.name, isUpdate: true });
      return;
    }

    if (inc.dispatch?.dispatchedAt && !w.arrivalAt) {
      const etaMs = (inc.dispatch.recommended?.etaMinutes ?? 20) * 60_000;
      w.arrivalAt = new Date(inc.dispatch.dispatchedAt).getTime() + Math.min(etaMs, MAX_TRANSIT_MS);
    }
    if (!w.arrivalAt || now < w.arrivalAt) return;

    // Unit on scene → patient handed over at the destination facility.
    const dest = inc.dispatch?.destinationFacility;
    const facility: any = dest ? await medicalFacilities.findOne({ nodeId: dest.nodeId }) : null;
    const handover = facility?.name ?? 'the nearest medical post';
    const resolved = await alerts.findOneAndUpdate(
      { _id: inc._id },
      { $set: { status: 'resolved', 'timeline.resolvedAt': new Date(), 'timeline.resolvedBy': 'demo-rescue-unit', 'timeline.updatedAt': new Date(), 'timeline.notes': `Patient stabilised on scene and handed over at ${handover}` } },
      { returnDocument: 'after' }
    );
    if (resolved) this.realtime?.broadcastToAuthorities('health_incident', { ...resolved, touristName: w.name, isUpdate: true });
    const { tourists } = await getCollections();
    await tourists.updateOne({ digitalId: w.id }, { $set: { safetyStatus: 'Normal' }, $unset: { 'health.activeIncidentId': '' } });
    console.log(`[Demo] ${w.name}: rescued, handed over at ${handover}`);

    w.episode = undefined;
    w.incidentId = w.arrivalAt = w.incidentAt = undefined;
    w.phase = 'hospital';
    const [lat, lng] = facility?.location?.coordinates ? [facility.location.coordinates[1], facility.location.coordinates[0]] : w.path.at(w.d);
    w.hospital = { lat, lng, altitude: facility?.elevation ?? w.path.at(w.d)[2], until: Date.now() + HOSPITAL_STAY_MS };
  }

  private recover(w: Wearer) {
    w.episode = undefined;
    w.incidentId = w.arrivalAt = w.incidentAt = undefined;
    w.phase = 'roaming';
  }

  /** Discharged: the tourist starts the route again from the trailhead. */
  private discharge(w: Wearer) {
    w.phase = 'roaming';
    w.hospital = undefined;
    w.d = 0;
    w.dir = 1;
    console.log(`[Demo] ${w.name} discharged and back on the route`);
  }
}

const demoMode = new DemoMode();
export default demoMode;
