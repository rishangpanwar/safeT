import { Vibration } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { API } from '../constants/config';
import { FallDetector, FallEvent, FallStage, MotionSample } from '../edge/fallDetection';
import { anomalyScore, assess, CachedZone, EdgeAssessment, EdgeModel, extractWindowFeatures, inferAvpu, VitalSample, zonesAt } from '../edge/clinical';
import { TIER_ADVISORY } from '../edge/mews';
import { Scenario, SimulatedWearable } from '../edge/wearable';
import { deltaEncode, telemetryStore } from '../edge/telemetryStore';

/**
 * Phone-side health guardian (report Tier 2 + workflow Phases 2–4). Runs while the app is
 * open: 1 Hz vitals → 60 s feature window → Isolation Forest + MEWS → escalation, with
 * 50 Hz motion feeding the four-stage fall detector. Everything is buffered locally and
 * synced opportunistically, so detection and triage keep working without signal.
 */

export type SelfCheckTrigger = 'fall' | 'vital_anomaly';

export interface MonitorState {
  running: boolean;
  digitalId: string | null;
  scenario: Scenario;
  motionSource: 'phone' | 'simulated' | 'unavailable';
  latest: VitalSample | null;
  assessment: EdgeAssessment | null;
  modelReady: boolean;
  modelTrainedAt?: string;
  online: boolean;
  lastSyncAt: number | null;
  pendingSamples: number;
  pendingOutbox: number;
  persistentBuffer: boolean;
  fallStage: FallStage;
  lastFall: FallEvent | null;
  selfCheck: { trigger: SelfCheckTrigger; deadline: number; reasons: string[] } | null;
  incident: {
    status: 'sending' | 'queued_offline' | 'sent';
    trigger: string;
    at: number;
    alertId?: string;
    unit?: string;
    mode?: string;
    etaMinutes?: number;
    destination?: string;
  } | null;
  advisory: string | null;
  location: { lat: number; lng: number; altitude?: number } | null;
  zones: string[];
}

const SELF_CHECK_MS = 30_000;
const SELF_CHECK_COOLDOWN_MS = 10 * 60_000;
const WINDOW_KEEP_MS = 15 * 60_000;
const SYNC_EVERY_MS = 5_000;
const MOTION_HZ = 50;
const RAD_TO_DEG = 180 / Math.PI;

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message || `HTTP ${res.status}`), { status: res.status });
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const downsample = <T,>(xs: T[], max: number) => (xs.length <= max ? xs : Array.from({ length: max }, (_, i) => xs[Math.floor((i * xs.length) / max)]));

class HealthMonitor {
  private state: MonitorState = {
    running: false,
    digitalId: null,
    scenario: 'normal',
    motionSource: 'unavailable',
    latest: null,
    assessment: null,
    modelReady: false,
    online: true,
    lastSyncAt: null,
    pendingSamples: 0,
    pendingOutbox: 0,
    persistentBuffer: false,
    fallStage: 'idle',
    lastFall: null,
    selfCheck: null,
    incident: null,
    advisory: null,
    location: null,
    zones: [],
  };
  private listeners = new Set<() => void>();

  private wearable = new SimulatedWearable();
  private model: EdgeModel | null = null;
  private zones: CachedZone[] = [];
  private window: VitalSample[] = [];
  private motionSvm: { t: number; svm: number }[] = [];
  private gyro = { x: 0, y: 0, z: 0 };
  private feedRealMotion = true;
  private fall: FallDetector;
  private subs: { remove(): void }[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private selfCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private selfCheckOutcome: { outcome: 'responded' | 'expired'; at: number } | null = null;
  private cooldownUntil = 0;
  private episodeIncidentSent = false;
  private greenSince = 0;
  private syncing = false;
  private alarm: AudioPlayer | null = null;

  constructor() {
    this.fall = new FallDetector(
      (e) => this.onFall(e),
      (stage) => this.set({ fallStage: stage })
    );
  }

  // ------------------------------------------------------------------ store plumbing (useSyncExternalStore)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<MonitorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ lifecycle

  async start(digitalId: string) {
    if (this.state.running && this.state.digitalId === digitalId) return;
    this.stop();
    this.set({ running: true, digitalId });

    await telemetryStore.init();
    this.set({ persistentBuffer: telemetryStore.persistent });
    await Promise.all([this.loadModel(), this.loadZones(), this.prefetchEmergencyQr(digitalId)]);
    await this.startMotion();
    await this.startLocation();

    this.timers.push(setInterval(() => this.tick().catch((e) => console.warn('[HealthMonitor] tick', e)), 1000));
    this.timers.push(setInterval(() => this.sync().catch(() => undefined), SYNC_EVERY_MS));
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.stopAlarm();
    if (this.selfCheckTimer) clearTimeout(this.selfCheckTimer);
    this.set({ running: false, selfCheck: null });
  }

  async reset() {
    this.stop();
    this.window = [];
    await telemetryStore.clear();
    await AsyncStorage.multiRemove(['emergencyQr']);
    this.set({ digitalId: null, assessment: null, latest: null, incident: null, lastFall: null, advisory: null, pendingSamples: 0, pendingOutbox: 0 });
  }

  // ------------------------------------------------------------------ cached cloud artefacts

  private async loadModel() {
    const cached = await AsyncStorage.getItem('edgeModel');
    if (cached) {
      this.model = JSON.parse(cached);
      this.set({ modelReady: true, modelTrainedAt: this.model!.forest.trainedAt });
    }
    try {
      const json = await fetchJson(`${API.health}/model`, undefined, 15000);
      this.model = json.data;
      await AsyncStorage.setItem('edgeModel', JSON.stringify(json.data));
      this.set({ modelReady: true, modelTrainedAt: json.data.forest.trainedAt });
    } catch {
      // keep the cached model (or run MEWS-only until one arrives)
    }
  }

  private async loadZones() {
    const cached = await AsyncStorage.getItem('geoFences');
    if (cached) this.zones = JSON.parse(cached);
    try {
      const res = await fetch(`${API.dashboard}/geofences`);
      if (res.ok) {
        this.zones = await res.json();
        await AsyncStorage.setItem('geoFences', JSON.stringify(this.zones));
      }
    } catch {
      // offline: cached zones still apply
    }
  }

  async prefetchEmergencyQr(digitalId: string) {
    try {
      const json = await fetchJson(`${API.health}/${digitalId}/emergency-qr`, undefined, 15000);
      await AsyncStorage.setItem('emergencyQr', JSON.stringify(json.data));
      return json.data;
    } catch {
      const cached = await AsyncStorage.getItem('emergencyQr');
      return cached ? JSON.parse(cached) : null;
    }
  }

  // ------------------------------------------------------------------ sensors

  private async startMotion() {
    const [accOk, gyroOk] = await Promise.all([
      Accelerometer.isAvailableAsync().catch(() => false),
      Gyroscope.isAvailableAsync().catch(() => false),
    ]);
    if (!accOk) {
      this.set({ motionSource: 'unavailable' });
      return;
    }
    Accelerometer.setUpdateInterval(1000 / MOTION_HZ);
    if (gyroOk) {
      Gyroscope.setUpdateInterval(1000 / MOTION_HZ);
      this.subs.push(Gyroscope.addListener((g) => (this.gyro = g)));
    }
    this.subs.push(
      Accelerometer.addListener((a) => {
        const t = Date.now();
        const svm = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        this.motionSvm.push({ t, svm });
        while (this.motionSvm.length && this.motionSvm[0].t < t - 1000) this.motionSvm.shift();
        if (this.feedRealMotion) {
          const sample: MotionSample = {
            t, ax: a.x, ay: a.y, az: a.z,
            gx: this.gyro.x * RAD_TO_DEG, gy: this.gyro.y * RAD_TO_DEG, gz: this.gyro.z * RAD_TO_DEG,
          };
          this.fall.push(sample);
        }
      })
    );
    this.set({ motionSource: 'phone' });
  }

  /** σ of the acceleration magnitude over the last second, in g. */
  private phoneMobility(): number | undefined {
    if (this.motionSvm.length < 10) return undefined;
    const m = this.motionSvm.reduce((s, x) => s + x.svm, 0) / this.motionSvm.length;
    return Math.sqrt(this.motionSvm.reduce((s, x) => s + (x.svm - m) ** 2, 0) / this.motionSvm.length);
  }

  private async startLocation() {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 10 },
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, altitude: pos.coords.altitude ?? undefined };
          this.set({ location: loc, zones: zonesAt(loc.lat, loc.lng, this.zones).map((z) => z.name) });
        }
      );
      this.subs.push(sub);
    } catch (error) {
      console.warn('[HealthMonitor] location unavailable', error);
    }
  }

  // ------------------------------------------------------------------ 1 Hz pipeline

  private async tick() {
    const now = Date.now();
    const loc = this.state.location;
    const phoneMob = this.phoneMobility();
    const exertion = Math.min(1, (phoneMob ?? 0.2) / 0.4);
    const r = this.wearable.read(now, loc?.altitude ?? 0, exertion);
    const scripted = this.wearable.scenario !== 'normal' && r.mobility !== undefined;
    const mobility = scripted ? r.mobility : phoneMob ?? r.mobility ?? 0.2;

    const sample: VitalSample = {
      t: now,
      hr: Math.round(r.hr),
      spo2: Math.round(Math.min(100, r.spo2) * 10) / 10,
      skinTemp: Math.round(r.skinTemp * 100) / 100,
      hrvRmssd: Math.round(Math.max(3, r.hrvRmssd)),
      mobility: Math.round(Math.max(0, mobility ?? 0) * 1000) / 1000,
      altitude: loc?.altitude != null ? Math.round(loc.altitude) : undefined,
      lat: loc?.lat,
      lng: loc?.lng,
    };
    await telemetryStore.append(sample);
    this.window.push(sample);
    while (this.window.length && this.window[0].t < now - WINDOW_KEEP_MS) this.window.shift();

    const motionSource = scripted ? 'simulated' : this.state.motionSource === 'unavailable' ? 'unavailable' : 'phone';
    const features = extractWindowFeatures(this.window);
    if (!features || features.sampleCount < 10) {
      this.set({ latest: sample, motionSource });
      return;
    }

    const recentCheck = this.selfCheckOutcome && now - this.selfCheckOutcome.at < 10 * 60_000 ? this.selfCheckOutcome.outcome : 'none';
    const zones = loc ? zonesAt(loc.lat, loc.lng, this.zones).map((z) => z.name) : [];
    const a = assess({
      features,
      anomalyScore: this.model ? anomalyScore(this.model, features.vector) : null,
      avpu: inferAvpu(recentCheck, features.named.mobility),
      zones,
      altitude: loc?.altitude,
      thresholds: this.model?.thresholds ?? { watch: 0.6, critical: 0.66, terrainShift: 0.03 },
      hypoxiaAltitudeM: this.model?.hypoxiaAltitudeM,
    });

    const prevTier = this.state.assessment?.tier;
    this.set({
      latest: sample,
      assessment: a,
      motionSource,
      zones,
      advisory: a.tier !== 'green' && a.tier !== prevTier ? TIER_ADVISORY[a.tier] : a.tier === 'green' ? null : this.state.advisory,
    });

    // Episode bookkeeping: a sustained return to green re-arms escalation.
    if (a.tier === 'green') {
      if (!this.greenSince) this.greenSince = now;
      if (now - this.greenSince > 2 * 60_000) this.episodeIncidentSent = false;
    } else {
      this.greenSince = 0;
    }

    if (a.tier === 'red' && !this.episodeIncidentSent && !this.state.selfCheck) {
      if (a.mews.bypassConfirmation) {
        void this.sendIncident('vital_anomaly', 'bypassed');
      } else if (a.requiresSelfCheck && now > this.cooldownUntil) {
        this.beginSelfCheck('vital_anomaly', a.reasons);
      }
    }
  }

  // ------------------------------------------------------------------ fall + self-check (Phase 3)

  private onFall(e: FallEvent) {
    this.set({ lastFall: e });
    if (this.state.selfCheck) return;
    this.beginSelfCheck('fall', [
      e.lowEnergy
        ? 'Collapse without free fall (possible fainting)'
        : `Free fall ${e.freeFallMs} ms${e.fallFromHeight ? ' (fall from height)' : ''}`,
      `Impact ${e.peakSvm} g, jerk ${e.peakJerk} g/s, rotation ${e.peakOmega}°/s`,
      `Lying posture ${e.tiltDeg}°, no movement for ${e.lowEnergy ? 20 : 10} s`,
    ]);
  }

  /** Demo / emulator aid: inject a recorded-style fall into the detector. */
  simulateFall() {
    this.feedRealMotion = false;
    const t0 = Date.now();
    const out: MotionSample[] = [];
    const push = (ms: number, f: (i: number) => Omit<MotionSample, 't'>) => {
      const start = out.length ? out[out.length - 1].t + 20 : t0;
      for (let i = 0; i < ms / 20; i++) out.push({ t: start + i * 20, ...f(i) });
    };
    const j = (sd: number) => (Math.random() - 0.5) * 2 * sd;
    push(1200, () => ({ ax: j(0.02), ay: 1 + j(0.02), az: j(0.02), gx: 2, gy: 2, gz: 2 }));
    push(280, () => ({ ax: 0.1, ay: 0.15, az: 0.1, gx: 320, gy: 90, gz: 40 }));
    push(100, (i) => (i === 0 ? { ax: 0.5, ay: 4.6, az: 1.2, gx: 300, gy: 80, gz: 60 } : { ax: 0.3, ay: 1.6, az: 0.8, gx: 100, gy: 30, gz: 20 }));
    push(10_700, () => ({ ax: j(0.004), ay: j(0.004), az: 1 + j(0.004), gx: 0, gy: 0, gz: 0 }));
    for (const s of out) this.fall.push(s);
    this.feedRealMotion = true;
    this.setScenario('fall');
  }

  private beginSelfCheck(trigger: SelfCheckTrigger, reasons: string[]) {
    const deadline = Date.now() + SELF_CHECK_MS;
    this.set({ selfCheck: { trigger, deadline, reasons } });
    this.startAlarm();
    if (this.selfCheckTimer) clearTimeout(this.selfCheckTimer);
    this.selfCheckTimer = setTimeout(() => this.expireSelfCheck(), SELF_CHECK_MS);
  }

  /** "I'M OK" pressed within 30 s — false alarm (dropped phone, abrupt stop). */
  async confirmOk() {
    const sc = this.state.selfCheck;
    if (!sc) return;
    if (this.selfCheckTimer) clearTimeout(this.selfCheckTimer);
    this.stopAlarm();
    this.selfCheckOutcome = { outcome: 'responded', at: Date.now() };
    if (sc.trigger === 'vital_anomaly') this.cooldownUntil = Date.now() + SELF_CHECK_COOLDOWN_MS;
    if (this.wearable.scenario === 'fall') this.setScenario('normal');
    this.set({ selfCheck: null });
    await telemetryStore.enqueue('selfcheck', { outcome: 'responded', reason: sc.trigger });
    void this.sync();
  }

  /** No response in 30 s — promote to an Emergency Distress Event (Phase 3b). */
  private async expireSelfCheck() {
    const sc = this.state.selfCheck;
    if (!sc) return;
    this.stopAlarm();
    this.selfCheckOutcome = { outcome: 'expired', at: Date.now() };
    this.set({ selfCheck: null });
    await telemetryStore.enqueue('selfcheck', { outcome: 'expired', reason: sc.trigger });
    await this.sendIncident(sc.trigger, 'expired');
  }

  async manualSos() {
    return this.sendIncident('manual_sos', 'manual');
  }

  private async sendIncident(trigger: 'fall' | 'vital_anomaly' | 'manual_sos', selfCheck: 'expired' | 'bypassed' | 'manual') {
    const id = this.state.digitalId;
    if (!id) return;
    if (trigger !== 'manual_sos') this.episodeIncidentSent = true;
    const a = this.state.assessment;
    const payload = {
      trigger,
      selfCheck,
      occurredAt: new Date().toISOString(),
      location: this.state.location ?? undefined,
      fallEvent: trigger === 'fall' ? this.state.lastFall ?? undefined : undefined,
      vitalsTrend: downsample(this.window, 90).map(({ lat, lng, ...v }) => v),
      deviceAssessment: a ? { tier: a.tier, mews: a.mews.total, anomalyScore: a.anomalyScore } : undefined,
    };
    this.set({ incident: { status: 'sending', trigger, at: Date.now() } });
    try {
      const json = await fetchJson(`${API.health}/${id}/incident`, { method: 'POST', body: JSON.stringify(payload) });
      this.applyIncidentAck(trigger, json.data);
      this.set({ online: true });
      void this.sync(); // deliver the self-check outcome too
    } catch {
      // Offline Emergency Mode: queue and keep retrying on every sync tick.
      await telemetryStore.enqueue('incident', { ...payload, offlineBuffered: true });
      this.set({ online: false, incident: { status: 'queued_offline', trigger, at: Date.now() } });
    }
  }

  private applyIncidentAck(trigger: string, data: any) {
    const r = data?.dispatch?.recommended;
    this.set({
      incident: {
        status: 'sent',
        trigger,
        at: Date.now(),
        alertId: data?.alertId,
        unit: r?.unit?.name,
        mode: r?.mode,
        etaMinutes: r?.etaMinutes,
        destination: data?.dispatch?.destinationFacility?.name,
      },
    });
  }

  dismissIncident() {
    this.set({ incident: null });
  }

  setScenario(s: Scenario) {
    this.wearable.setScenario(s);
    if (s === 'normal') this.cooldownUntil = 0;
    this.set({ scenario: s });
  }

  // ------------------------------------------------------------------ alarm (haptic + audio)

  private startAlarm() {
    Vibration.vibrate([0, 700, 300], true);
    (async () => {
      try {
        await setAudioModeAsync({ playsInSilentMode: true });
        this.alarm ??= createAudioPlayer(require('../assets/sounds/alarm.wav'));
        this.alarm.loop = true;
        this.alarm.seekTo(0);
        this.alarm.play();
      } catch (error) {
        console.warn('[HealthMonitor] alarm audio unavailable', error);
      }
    })();
  }

  private stopAlarm() {
    Vibration.cancel();
    try {
      this.alarm?.pause();
    } catch {
      // player already released
    }
  }

  // ------------------------------------------------------------------ store-and-forward sync

  async sync() {
    const id = this.state.digitalId;
    if (!id || this.syncing) return;
    this.syncing = true;
    try {
      // 1) Outbox first: emergencies outrank telemetry.
      for (const item of await telemetryStore.outbox()) {
        try {
          const url = item.kind === 'incident' ? `${API.health}/${id}/incident` : `${API.health}/${id}/selfcheck`;
          const json = await fetchJson(url, { method: 'POST', body: JSON.stringify(item.payload) });
          await telemetryStore.removeOutbox(item.id);
          if (item.kind === 'incident') this.applyIncidentAck(item.payload.trigger, json.data);
          this.set({ online: true });
        } catch (error: any) {
          if (error?.status >= 400 && error?.status < 500) {
            await telemetryStore.removeOutbox(item.id); // rejected — retrying will not help
            continue;
          }
          await telemetryStore.bumpAttempts(item.id);
          this.set({ online: false });
          return;
        }
      }

      // 2) Telemetry burst sync, delta-compressed, oldest first.
      for (let batch = 0; batch < 10; batch++) {
        const rows = await telemetryStore.unsynced(600);
        if (!rows.length) break;
        const loc = this.state.location;
        await fetchJson(`${API.health}/${id}/telemetry`, {
          method: 'POST',
          body: JSON.stringify({ ...deltaEncode(rows), location: loc ?? undefined }),
        }, 15000);
        await telemetryStore.markSynced(rows[rows.length - 1].t);
        this.set({ online: true, lastSyncAt: Date.now() });
        if (rows.length < 600) break;
      }
    } catch {
      this.set({ online: false });
    } finally {
      this.syncing = false;
      const [pendingSamples, outbox] = await Promise.all([telemetryStore.pendingCount(), telemetryStore.outbox()]);
      this.set({ pendingSamples, pendingOutbox: outbox.length });
    }
  }
}

export const healthMonitor = new HealthMonitor();
