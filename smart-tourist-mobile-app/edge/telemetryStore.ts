import * as SQLite from 'expo-sqlite';
import type { VitalSample } from './clinical';

/**
 * Offline-first store-and-forward buffer (report Objective 4, Tier 2d).
 *   telemetry — 1 Hz vitals as a 24 h circular buffer; rows flip to synced=1 once uploaded
 *   outbox    — incidents and self-check outcomes, delivered in order when signal returns
 * Falls back to memory if SQLite is unavailable (e.g. web preview).
 */

const CAPACITY = 24 * 3600; // rows (24 h at 1 Hz)
const FIELDS = ['t', 'hr', 'spo2', 'skinTemp', 'hrvRmssd', 'mobility', 'altitude'] as const;
const PRECISION: Record<string, number> = { t: 0, hr: 1, spo2: 1, skinTemp: 2, hrvRmssd: 1, mobility: 3, altitude: 0 };

export interface OutboxItem {
  id: number;
  kind: 'incident' | 'selfcheck';
  payload: any;
  createdAt: number;
  attempts: number;
}

type Row = VitalSample & { synced?: number };

const round = (v: number | undefined | null, dp: number) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** delta-v1: first row absolute, every other row = difference from the previous one. */
export function deltaEncode(samples: VitalSample[]) {
  const rows = samples.map((s) => FIELDS.map((f) => round((s as any)[f], PRECISION[f])));
  return {
    encoding: 'delta-v1' as const,
    fields: FIELDS,
    base: rows[0],
    deltas: rows.slice(1).map((r, i) =>
      r.map((v, j) => {
        const prev = rows[i][j];
        return v == null || prev == null ? v : round(v - prev, PRECISION[FIELDS[j]] + 1);
      })
    ),
  };
}

class TelemetryStore {
  private db: SQLite.SQLiteDatabase | null = null;
  private ready: Promise<void> | null = null;
  private inserts = 0;
  private mem: Row[] = [];
  private memOutbox: OutboxItem[] = [];
  private memSeq = 0;

  init() {
    if (!this.ready) this.ready = this.open();
    return this.ready;
  }

  private async open() {
    try {
      this.db = await SQLite.openDatabaseAsync('health-buffer.db');
      await this.db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS telemetry (
          t INTEGER PRIMARY KEY, hr REAL, spo2 REAL, skinTemp REAL, hrvRmssd REAL,
          mobility REAL, altitude REAL, lat REAL, lng REAL, synced INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_unsynced ON telemetry (synced, t);
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL,
          createdAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
        );
      `);
    } catch (error) {
      console.warn('[TelemetryStore] SQLite unavailable, buffering in memory:', error);
      this.db = null;
    }
  }

  get persistent() {
    return !!this.db;
  }

  async append(s: VitalSample) {
    await this.init();
    if (!this.db) {
      this.mem.push({ ...s, synced: 0 });
      if (this.mem.length > CAPACITY) this.mem.splice(0, this.mem.length - CAPACITY);
      return;
    }
    await this.db.runAsync(
      'INSERT OR REPLACE INTO telemetry (t, hr, spo2, skinTemp, hrvRmssd, mobility, altitude, lat, lng, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [s.t, s.hr ?? null, s.spo2 ?? null, s.skinTemp ?? null, s.hrvRmssd ?? null, s.mobility ?? null, s.altitude ?? null, s.lat ?? null, s.lng ?? null]
    );
    if (++this.inserts % 600 === 0) {
      // Circular buffer: keep the newest CAPACITY rows.
      await this.db.runAsync('DELETE FROM telemetry WHERE t < (SELECT t FROM telemetry ORDER BY t DESC LIMIT 1 OFFSET ?)', [CAPACITY]);
    }
  }

  async unsynced(limit = 600): Promise<VitalSample[]> {
    await this.init();
    if (!this.db) return this.mem.filter((r) => !r.synced).slice(0, limit);
    return this.db.getAllAsync<VitalSample>(
      'SELECT t, hr, spo2, skinTemp, hrvRmssd, mobility, altitude, lat, lng FROM telemetry WHERE synced = 0 ORDER BY t LIMIT ?',
      [limit]
    );
  }

  async markSynced(upToT: number) {
    await this.init();
    if (!this.db) {
      for (const r of this.mem) if (r.t <= upToT) r.synced = 1;
      return;
    }
    await this.db.runAsync('UPDATE telemetry SET synced = 1 WHERE synced = 0 AND t <= ?', [upToT]);
  }

  async pendingCount(): Promise<number> {
    await this.init();
    if (!this.db) return this.mem.filter((r) => !r.synced).length;
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM telemetry WHERE synced = 0');
    return row?.n ?? 0;
  }

  async enqueue(kind: OutboxItem['kind'], payload: any) {
    await this.init();
    if (!this.db) {
      this.memOutbox.push({ id: ++this.memSeq, kind, payload, createdAt: Date.now(), attempts: 0 });
      return;
    }
    await this.db.runAsync('INSERT INTO outbox (kind, payload, createdAt) VALUES (?, ?, ?)', [kind, JSON.stringify(payload), Date.now()]);
  }

  async outbox(): Promise<OutboxItem[]> {
    await this.init();
    if (!this.db) return [...this.memOutbox];
    const rows = await this.db.getAllAsync<any>('SELECT * FROM outbox ORDER BY id');
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  async removeOutbox(id: number) {
    if (!this.db) {
      this.memOutbox = this.memOutbox.filter((i) => i.id !== id);
      return;
    }
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
  }

  async bumpAttempts(id: number) {
    if (!this.db) {
      const item = this.memOutbox.find((i) => i.id === id);
      if (item) item.attempts++;
      return;
    }
    await this.db.runAsync('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?', [id]);
  }

  async clear() {
    await this.init();
    this.mem = [];
    this.memOutbox = [];
    if (this.db) await this.db.execAsync('DELETE FROM telemetry; DELETE FROM outbox;');
  }
}

export const telemetryStore = new TelemetryStore();
