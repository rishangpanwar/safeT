import { ObjectId } from 'mongodb';
import { getCollections } from '../config/database';
import {
  trainIsolationForest, anomalyScore, SerializedForest, FeatureVector,
  ANOMALY_WATCH, ANOMALY_CRITICAL, TERRAIN_SENSITIVITY_SHIFT,
} from '../health/isolationForest';
import { generateHealthyBaseline, extractWindowFeatures, inferAvpu, trainPopulationForest, VitalSample, SelfCheckOutcome } from '../health/features';
import { assessClinicalState, ClinicalAssessment, TerrainContext } from '../health/triage';
import { TIER_ADVISORY, TriageTier } from '../health/mews';
import { pointInZone, HYPOXIA_ALTITUDE_M } from '../health/geoMedical';
import { computeDispatchPlan, generateEFir } from './rescueNetworkService';
import healthRegistryService from './healthRegistryService';

interface RealtimeBridge {
  broadcastToAuthorities(event: string, data: any): void;
  sendToTourist(touristId: string, event: string, data: any): void;
}

export type IncidentTrigger = 'fall' | 'vital_anomaly' | 'manual_sos' | 'server_escalation';

export interface IncidentReport {
  trigger: IncidentTrigger;
  occurredAt?: string; // device time — may be well in the past if the packet was buffered offline
  location?: { lat: number; lng: number; altitude?: number; accuracy?: number };
  selfCheck?: 'expired' | 'bypassed' | 'manual';
  offlineBuffered?: boolean;
  fallEvent?: Record<string, number | boolean>;
  vitalsTrend?: VitalSample[]; // last 15 min from the device buffer
  deviceAssessment?: { tier?: string; mews?: number; anomalyScore?: number | null };
}

const CACHE_MS = 15 * 60_000; // live window cache (the role Redis plays in the report's Tier 4b)
const SERVER_ESCALATION_MS = 90_000; // backstop if the phone never reports the self-check outcome
const SELF_CHECK_COOLDOWN_MS = 10 * 60_000; // matches the phone: an "I'm OK" suppresses re-checks this long
const PERSONAL_RETRAIN_EVERY = 300;
const INCIDENT_DEDUPE_MS = 30 * 60_000;
const RISK_CATEGORIES = ['high_altitude', 'avalanche', 'landslide', 'medical_dead_zone'];

const SANE: Record<string, [number, number]> = {
  hr: [0, 250], spo2: [50, 100], skinTemp: [25, 45], hrvRmssd: [0, 300], mobility: [0, 16], altitude: [-500, 9000],
};

class HealthMonitoringService {
  private population: SerializedForest;
  private personal = new Map<string, SerializedForest>();
  private greenHistory = new Map<string, FeatureVector[]>();
  private windows = new Map<string, VitalSample[]>();
  private selfChecks = new Map<string, { outcome: SelfCheckOutcome; at: number }>();
  private escalations = new Map<string, NodeJS.Timeout>();
  private zoneCache: { at: number; zones: any[] } = { at: 0, zones: [] };
  private realtime?: RealtimeBridge;

  constructor() {
    const started = Date.now();
    this.population = trainPopulationForest();
    console.log(`🧠 Isolation Forest trained (t=100, ψ=256) in ${Date.now() - started} ms`);
    setInterval(() => this.sweep(), 10 * 60_000).unref();
  }

  attachRealtime(bridge: RealtimeBridge) {
    this.realtime = bridge;
  }

  /** Model shipped to the edge so phones can score offline (report Tier 2b). */
  getEdgeModel() {
    return {
      forest: this.population,
      thresholds: { watch: ANOMALY_WATCH, critical: ANOMALY_CRITICAL, terrainShift: TERRAIN_SENSITIVITY_SHIFT },
      windowSeconds: 60,
      hypoxiaAltitudeM: HYPOXIA_ALTITUDE_M,
    };
  }

  /**
   * Accepts either `{ samples: VitalSample[] }` or the store-and-forward delta encoding
   * `{ encoding: 'delta-v1', fields, base, deltas }`, where each delta row is the
   * element-wise difference from the previous row.
   */
  decodeBatch(body: any): VitalSample[] {
    if (body?.encoding === 'delta-v1') {
      const fields: string[] = body.fields;
      let row: (number | null)[] = body.base;
      const out = [row];
      for (const d of body.deltas as (number | null)[][]) {
        row = row.map((v, i) => (v == null || d[i] == null ? d[i] ?? v : (v as number) + (d[i] as number)));
        out.push(row);
      }
      return out.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i] ?? undefined])) as unknown as VitalSample);
    }
    return Array.isArray(body?.samples) ? body.samples : [];
  }

  private sanitize(s: VitalSample): VitalSample | null {
    if (typeof s?.t !== 'number' || !Number.isFinite(s.t)) return null;
    const clean: any = { t: Math.round(s.t) };
    for (const [k, [lo, hi]] of Object.entries(SANE)) {
      const v = (s as any)[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) clean[k] = v;
    }
    if (Array.isArray(s.rr)) clean.rr = s.rr.filter((x) => typeof x === 'number' && x > 200 && x < 2500);
    return clean;
  }

  private async terrainContext(lat?: number, lng?: number, altitude?: number): Promise<TerrainContext> {
    if (Date.now() - this.zoneCache.at > 30_000) {
      const { geoFences } = await getCollections();
      this.zoneCache = {
        at: Date.now(),
        zones: await geoFences.find({
          isActive: true,
          $or: [{ 'metadata.category': { $in: RISK_CATEGORIES } }, { riskLevel: { $in: ['high', 'critical'] } }],
        }).toArray(),
      };
    }
    const zones = lat == null || lng == null ? [] : this.zoneCache.zones.filter((z) => pointInZone(lat, lng, z.geometry));
    const highAltitude = (altitude ?? 0) >= HYPOXIA_ALTITUDE_M;
    return {
      zones: zones.map((z) => ({ name: z.name, riskLevel: z.riskLevel, category: z.metadata?.category })),
      altitude,
      escalationOffset: zones.length > 0 || highAltitude ? 1 : 0,
    };
  }

  private async loadWindow(digitalId: string): Promise<VitalSample[]> {
    const cached = this.windows.get(digitalId);
    if (cached) return cached;
    const { healthTelemetry } = await getCollections();
    const docs = await healthTelemetry.find({ touristId: digitalId, t: { $gte: Date.now() - CACHE_MS } }).sort({ t: 1 }).toArray();
    const samples = docs.map(({ _id, touristId, receivedAt, buffered, ...s }: any) => s as VitalSample);
    this.windows.set(digitalId, samples);
    return samples;
  }

  private scoreFor(digitalId: string, vector: FeatureVector): number {
    return anomalyScore(this.personal.get(digitalId) ?? this.population, vector);
  }

  /** Personalisation: retrain on this tourist's own Green-tier windows mixed with the population baseline. */
  private learnBaseline(digitalId: string, vector: FeatureVector) {
    const hist = this.greenHistory.get(digitalId) ?? [];
    hist.push(vector);
    if (hist.length > 1000) hist.shift();
    this.greenHistory.set(digitalId, hist);
    if (hist.length % PERSONAL_RETRAIN_EVERY === 0) {
      const mix = hist.concat(generateHealthyBaseline(1000, hist.length));
      this.personal.set(digitalId, trainIsolationForest(mix, { seed: hist.length }));
      console.log(`[Health] Personalised Isolation Forest retrained for ${digitalId} on ${hist.length} windows`);
    }
  }

  async ingest(digitalId: string, rawSamples: VitalSample[], ctx: { location?: { lat: number; lng: number; altitude?: number } } = {}) {
    const { tourists, healthTelemetry, alerts } = await getCollections();
    const tourist = await tourists.findOne({ digitalId }, { projection: { digitalId: 1, kyc: 1, personalInfo: 1, health: 1, currentLocation: 1 } });
    if (!tourist) throw Object.assign(new Error('Tourist not found'), { status: 404 });

    const samples = rawSamples.map((s) => this.sanitize(s)).filter((s): s is VitalSample => !!s);
    if (samples.length === 0) throw Object.assign(new Error('No valid samples'), { status: 400 });

    const now = Date.now();
    await healthTelemetry.insertMany(
      samples.map((s) => ({ ...s, touristId: digitalId, receivedAt: new Date(), buffered: s.t < now - 120_000 }))
    );

    const window = await this.loadWindow(digitalId);
    window.push(...samples);
    window.sort((a, b) => a.t - b.t);
    const newest = window[window.length - 1].t;
    while (window.length && window[0].t < newest - CACHE_MS) window.shift();

    const features = extractWindowFeatures(window)!;
    const score = this.scoreFor(digitalId, features.vector);
    const loc = ctx.location ?? (tourist.currentLocation
      ? { lat: tourist.currentLocation.latitude, lng: tourist.currentLocation.longitude, altitude: (tourist.currentLocation as any).altitude }
      : undefined);
    const terrain = await this.terrainContext(loc?.lat, loc?.lng, features.latest.altitude ?? loc?.altitude);

    const sc = this.selfChecks.get(digitalId);
    const selfCheck: SelfCheckOutcome = sc && now - sc.at < 10 * 60_000 ? sc.outcome : 'none';
    const assessment = assessClinicalState({ features, anomalyScore: score, avpu: inferAvpu(selfCheck, features.named.mobility), terrain });

    if (assessment.tier === 'green') this.learnBaseline(digitalId, features.vector);

    const prevTier: TriageTier | undefined = (tourist as any).health?.tier;
    const activeAlerts = await alerts.countDocuments({ touristId: digitalId, status: { $in: ['active', 'acknowledged'] } });
    const health = this.summarise(assessment, features.latest, newest);

    await tourists.updateOne(
      { digitalId },
      {
        $set: {
          health,
          ...(activeAlerts === 0 ? { safetyStatus: assessment.tier === 'red' ? 'Danger' : assessment.tier === 'yellow' ? 'Alert' : 'Normal' } : {}),
        },
      }
    );

    const name = (tourist as any).kyc?.name || (tourist as any).personalInfo?.fullName;
    this.realtime?.broadcastToAuthorities('health_update', { digitalId, name, location: loc, ...health });

    let advisory: string | undefined;
    if (assessment.tier !== 'green' && assessment.tier !== prevTier) {
      advisory = TIER_ADVISORY[assessment.tier];
      this.realtime?.sendToTourist(digitalId, 'health_advisory', { tier: assessment.tier, message: advisory, reasons: assessment.reasons });
    }
    if (assessment.tier === 'red' && prevTier !== 'red' && activeAlerts === 0) this.scheduleServerEscalation(digitalId);
    if (assessment.tier !== 'red') this.cancelServerEscalation(digitalId);

    return { accepted: samples.length, buffered: samples.filter((s) => s.t < now - 120_000).length, assessment: health, advisory };
  }

  private summarise(a: ClinicalAssessment, latest: { hr?: number; spo2?: number; skinTemp?: number; altitude?: number }, sampleTime: number) {
    return {
      tier: a.tier,
      mews: a.mews.total,
      mewsComponents: a.mews.components,
      mewsThresholds: a.mews.thresholds,
      anomalyScore: Math.round((a.anomalyScore ?? 0) * 1000) / 1000,
      anomalyLevel: a.anomalyLevel,
      reasons: a.reasons,
      vitals: {
        hr: Math.round(a.vitals.hr),
        spo2: Math.round(a.vitals.spo2 * 10) / 10,
        skinTemp: Math.round(a.vitals.skinTemp * 10) / 10,
        hrvRmssd: Math.round(a.vitals.hrvRmssd),
        mobility: Math.round(a.vitals.mobility * 1000) / 1000,
        deltaHr: Math.round(a.vitals.deltaHr),
        altitude: latest.altitude != null ? Math.round(latest.altitude) : undefined,
      },
      terrain: a.terrain,
      requiresSelfCheck: a.requiresSelfCheck,
      lastSampleAt: new Date(sampleTime),
      updatedAt: new Date(),
    };
  }

  private recentlyConfirmedOk(digitalId: string) {
    const sc = this.selfChecks.get(digitalId);
    return sc?.outcome === 'responded' && Date.now() - sc.at < SELF_CHECK_COOLDOWN_MS;
  }

  private scheduleServerEscalation(digitalId: string) {
    this.cancelServerEscalation(digitalId);
    if (this.recentlyConfirmedOk(digitalId)) return;
    const timer = setTimeout(async () => {
      this.escalations.delete(digitalId);
      if (this.recentlyConfirmedOk(digitalId)) return;
      try {
        console.warn(`[Health] No self-check outcome from ${digitalId} — escalating server-side`);
        await this.reportIncident(digitalId, { trigger: 'server_escalation', selfCheck: 'expired' });
      } catch (error) {
        console.error('[Health] Server escalation failed:', error);
      }
    }, SERVER_ESCALATION_MS);
    timer.unref();
    this.escalations.set(digitalId, timer);
  }

  private cancelServerEscalation(digitalId: string) {
    const t = this.escalations.get(digitalId);
    if (t) clearTimeout(t);
    this.escalations.delete(digitalId);
  }

  async recordSelfCheck(digitalId: string, outcome: 'responded' | 'expired', reason?: string) {
    this.selfChecks.set(digitalId, { outcome, at: Date.now() });
    if (outcome === 'responded') this.cancelServerEscalation(digitalId);
    const { tourists } = await getCollections();
    await tourists.updateOne({ digitalId }, { $set: { 'health.selfCheck': { outcome, reason, at: new Date() } } });
    this.realtime?.broadcastToAuthorities('health_selfcheck', { digitalId, outcome, reason, at: new Date() });
    return { recorded: true, outcome };
  }

  /** Phase 4–5: incident packet → triage → dispatch plan → E-FIR → command dashboard. */
  async reportIncident(digitalId: string, report: IncidentReport) {
    const { tourists, alerts } = await getCollections();
    const tourist: any = await tourists.findOne({ digitalId });
    if (!tourist) throw Object.assign(new Error('Tourist not found'), { status: 404 });
    this.cancelServerEscalation(digitalId);

    if (report.vitalsTrend?.length) {
      // Packets buffered offline carry the samples the server never saw.
      const known = new Set((await this.loadWindow(digitalId)).map((s) => s.t));
      const missing = report.vitalsTrend.map((s) => this.sanitize(s)).filter((s): s is VitalSample => !!s && !known.has(s.t));
      if (missing.length) await this.ingest(digitalId, missing, { location: report.location });
    }

    const location = report.location ?? (tourist.currentLocation
      ? { lat: tourist.currentLocation.latitude, lng: tourist.currentLocation.longitude, altitude: tourist.currentLocation.altitude }
      : null);
    if (!location) throw Object.assign(new Error('No location available for this tourist'), { status: 422 });

    const window = await this.loadWindow(digitalId);
    const features = extractWindowFeatures(window);
    const terrain = await this.terrainContext(location.lat, location.lng, location.altitude);
    const avpu = report.selfCheck === 'expired' || report.selfCheck === 'bypassed' ? inferAvpu('expired', features?.named.mobility ?? 0) : 'alert';
    const assessment = features
      ? assessClinicalState({ features, anomalyScore: this.scoreFor(digitalId, features.vector), avpu, terrain })
      : null;
    const clinical = {
      tier: report.trigger === 'manual_sos' && !assessment ? 'red' : assessment?.tier ?? 'red',
      mews: assessment?.mews.total ?? report.deviceAssessment?.mews ?? null,
      mewsComponents: assessment?.mews.components,
      anomalyScore: assessment?.anomalyScore ?? report.deviceAssessment?.anomalyScore ?? null,
      reasons: [
        ...(report.trigger === 'fall' ? ['Four-stage fall detector: free fall → impact → immobile lying posture'] : []),
        ...(report.selfCheck === 'expired' ? ['No response to 30 s on-device self-check'] : []),
        ...(assessment?.reasons ?? []),
      ],
      avpu,
      vitals: assessment?.vitals,
      fallEvent: report.fallEvent,
      terrain,
      vitalsTrend: this.downsample(window, 90),
    };

    const plan = await computeDispatchPlan({ lat: location.lat, lng: location.lng, elevation: location.altitude });
    const occurredAt = report.occurredAt ? new Date(report.occurredAt) : new Date();
    const titles: Record<IncidentTrigger, string> = {
      fall: 'Traumatic fall detected — tourist unresponsive',
      vital_anomaly: 'Critical health anomaly — tourist unresponsive',
      manual_sos: 'Manual SOS distress signal',
      server_escalation: 'Critical vitals with no response from device',
    };

    // De-duplicate: fold repeat triggers into the open incident.
    const open = await alerts.findOne({
      touristId: digitalId,
      'metadata.source': 'health_monitor',
      status: { $in: ['active', 'acknowledged'] },
      'timeline.createdAt': { $gte: new Date(Date.now() - INCIDENT_DEDUPE_MS) },
    });

    let alertId: ObjectId;
    if (open) {
      alertId = open._id;
      await alerts.updateOne(
        { _id: alertId },
        {
          $set: { clinical, dispatch: plan, location: { latitude: location.lat, longitude: location.lng, altitude: location.altitude }, 'timeline.updatedAt': new Date() },
          $push: { updates: { at: new Date(), trigger: report.trigger, tier: clinical.tier } } as any,
        }
      );
    } else {
      alertId = new ObjectId();
      const efir = generateEFir({
        alertId: alertId.toHexString(),
        trigger: report.trigger,
        occurredAt,
        tourist,
        location,
        assessment: { tier: clinical.tier, mews: { total: clinical.mews ?? 0 }, anomalyScore: clinical.anomalyScore, reasons: clinical.reasons },
        plan,
      });
      await alerts.insertOne({
        _id: alertId,
        touristId: digitalId,
        type: report.trigger === 'fall' ? 'fall_detected' : report.trigger === 'manual_sos' ? 'emergency' : 'health_emergency',
        status: 'active',
        priority: 'critical',
        title: titles[report.trigger],
        message: `${titles[report.trigger]}. ${clinical.reasons.slice(0, 3).join('; ')}`,
        location: { latitude: location.lat, longitude: location.lng, altitude: location.altitude, address: `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` },
        timeline: { createdAt: new Date(), updatedAt: new Date(), occurredAt, createdBy: 'health_ai' },
        metadata: { source: 'health_monitor', trigger: report.trigger, selfCheck: report.selfCheck, offlineBuffered: !!report.offlineBuffered, deviceAssessment: report.deviceAssessment },
        clinical,
        dispatch: plan,
        efir,
        escalationLevel: 0,
      });
    }

    await tourists.updateOne({ digitalId }, { $set: { safetyStatus: 'Danger', 'health.tier': 'red', 'health.activeIncidentId': alertId } });
    if (tourist.healthProfile?.tokenId) {
      healthRegistryService.updateSafetyStatus(tourist.healthProfile.tokenId, 2).catch(() => undefined);
    }

    const incident = await alerts.findOne({ _id: alertId });
    const name = tourist.kyc?.name || tourist.personalInfo?.fullName;
    this.realtime?.broadcastToAuthorities('health_incident', { ...incident, touristName: name, isUpdate: !!open });
    this.realtime?.broadcastToAuthorities('emergency_alert', {
      touristId: digitalId,
      location: { latitude: location.lat, longitude: location.lng },
      message: incident?.message,
      timestamp: new Date(),
      alertId,
    });
    this.realtime?.sendToTourist(digitalId, 'incident_ack', {
      alertId,
      unit: plan.recommended?.unit.name,
      mode: plan.recommended?.mode,
      etaMinutes: plan.recommended?.etaMinutes,
      destination: plan.destinationFacility?.name,
    });

    return { alertId, isUpdate: !!open, clinical: { tier: clinical.tier, mews: clinical.mews, reasons: clinical.reasons }, dispatch: plan, efir: incident?.efir };
  }

  private downsample(samples: VitalSample[], max: number): VitalSample[] {
    if (samples.length <= max) return samples;
    const step = samples.length / max;
    return Array.from({ length: max }, (_, i) => samples[Math.floor(i * step)]);
  }

  async getVitals(digitalId: string, minutes = 60) {
    const { healthTelemetry } = await getCollections();
    const docs = await healthTelemetry
      .find({ touristId: digitalId, t: { $gte: Date.now() - minutes * 60_000 } }, { projection: { _id: 0, touristId: 0, receivedAt: 0 } })
      .sort({ t: 1 })
      .toArray();
    return this.downsample(docs as unknown as VitalSample[], 240);
  }

  async getTriageBoard() {
    const { tourists } = await getCollections();
    const rank: Record<string, number> = { red: 0, yellow: 1, green: 2 };
    const docs = await tourists
      .find({ isActive: true }, { projection: { digitalId: 1, kyc: 1, personalInfo: 1, health: 1, currentLocation: 1, safetyStatus: 1, 'healthProfile.tokenId': 1, 'healthProfile.sbt': 1 } })
      .toArray();
    return docs
      .map((t: any) => ({
        digitalId: t.digitalId,
        name: t.kyc?.name || t.personalInfo?.fullName || 'Unknown',
        nationality: t.kyc?.nationality || t.personalInfo?.nationality,
        safetyStatus: t.safetyStatus,
        location: t.currentLocation ? { lat: t.currentLocation.latitude, lng: t.currentLocation.longitude, altitude: t.currentLocation.altitude } : null,
        health: t.health ?? null,
        hasHealthId: !!t.healthProfile?.tokenId,
        sbtNetwork: t.healthProfile?.sbt?.network,
      }))
      .sort((a, b) =>
        (rank[a.health?.tier ?? 'green'] - rank[b.health?.tier ?? 'green']) ||
        ((b.health?.mews ?? -1) - (a.health?.mews ?? -1)) ||
        ((b.health?.anomalyScore ?? 0) - (a.health?.anomalyScore ?? 0))
      );
  }

  private sweep() {
    const cutoff = Date.now() - 60 * 60_000;
    for (const [id, w] of this.windows) if (!w.length || w[w.length - 1].t < cutoff) this.windows.delete(id);
  }
}

const healthMonitoringService = new HealthMonitoringService();
export default healthMonitoringService;
