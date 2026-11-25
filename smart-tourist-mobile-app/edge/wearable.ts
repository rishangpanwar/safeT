/**
 * Tier 1 sensing: wearable biosensors over BLE 5.0 GATT, plus a simulated band.
 *
 * Expo Go cannot open BLE connections, so the app ships with SimulatedWearable for
 * demonstrations. The GATT parsers below decode the standard Bluetooth SIG health
 * characteristics; a development build with a BLE library (e.g. react-native-ble-plx)
 * passes each notification's bytes to them and forwards the result to the monitor.
 */

export type Scenario = 'normal' | 'ams' | 'cardiac' | 'hypothermia' | 'heatstroke' | 'fall';

export const SCENARIOS: { key: Scenario; label: string; detail: string }[] = [
  { key: 'normal', label: 'Normal trek', detail: 'Healthy exertion; motion from phone sensors' },
  { key: 'ams', label: 'AMS → HAPE', detail: 'Progressive hypoxia, tachycardia, collapse' },
  { key: 'cardiac', label: 'Cardiac event', detail: 'Exertional arrhythmia then arrest' },
  { key: 'hypothermia', label: 'Hypothermia', detail: 'Core temperature < 35 °C, bradycardia' },
  { key: 'heatstroke', label: 'Heatstroke', detail: 'Temperature > 40 °C, tachycardia' },
  { key: 'fall', label: 'Fall + unconscious', detail: 'Impact, then complete immobility' },
];

export interface WearableReading {
  hr: number;
  spo2: number;
  skinTemp: number;
  hrvRmssd: number;
  mobility?: number; // only set when the scenario dictates motion
}

const noise = (sd: number) => (Math.random() + Math.random() + Math.random() - 1.5) * sd * 1.4;
const lerp = (a: number, b: number, p: number) => a + (b - a) * Math.min(1, Math.max(0, p));

export class SimulatedWearable {
  scenario: Scenario = 'normal';
  private startedAt = Date.now();

  setScenario(s: Scenario) {
    this.scenario = s;
    this.startedAt = Date.now();
  }

  /** @param altitude metres ASL (lower SpO₂ at altitude) @param exertion 0..1 from phone motion */
  read(now: number, altitude = 0, exertion = 0.3): WearableReading {
    const s = (now - this.startedAt) / 1000;
    const altEffect = Math.max(0, altitude - 1500) / 600;
    const base: WearableReading = {
      hr: 72 + 70 * exertion + noise(3),
      spo2: Math.min(99.5, 98 - altEffect - exertion + noise(0.5)),
      skinTemp: 36.6 + 0.5 * exertion + noise(0.08),
      hrvRmssd: 58 - 30 * exertion + noise(4),
    };
    switch (this.scenario) {
      case 'ams': {
        const p = s / 120;
        return { hr: lerp(base.hr, 150, p) + noise(3), spo2: lerp(base.spo2, 72, p) + noise(0.7), skinTemp: base.skinTemp, hrvRmssd: lerp(base.hrvRmssd, 11, p), mobility: lerp(0.25, 0.004, p * 1.2) };
      }
      case 'cardiac': {
        const p = s / 90;
        const arrest = p > 0.75;
        return { hr: arrest ? 34 + noise(6) : lerp(base.hr, 188, p / 0.75) + noise(10), spo2: lerp(base.spo2, 79, p) + noise(1), skinTemp: base.skinTemp, hrvRmssd: arrest ? 140 + noise(30) : lerp(base.hrvRmssd, 8, p), mobility: arrest ? 0.002 : 0.3 };
      }
      case 'hypothermia': {
        const p = s / 150;
        return { hr: lerp(base.hr, 46, p) + noise(2), spo2: base.spo2 - 1, skinTemp: lerp(36.6, 34.1, p) + noise(0.05), hrvRmssd: base.hrvRmssd, mobility: lerp(0.2, 0.05, p) + Math.abs(noise(0.02)) };
      }
      case 'heatstroke': {
        const p = s / 150;
        return { hr: lerp(base.hr, 158, p) + noise(3), spo2: lerp(base.spo2, 92, p), skinTemp: lerp(37.2, 40.6, p) + noise(0.05), hrvRmssd: lerp(base.hrvRmssd, 12, p), mobility: lerp(0.25, 0.01, p) };
      }
      case 'fall':
        return { hr: 138 - Math.min(30, s / 4) + noise(3), spo2: base.spo2 - 1.5 + noise(0.5), skinTemp: base.skinTemp, hrvRmssd: 20 + noise(3), mobility: 0.003 };
      default:
        return base;
    }
  }
}

// ------------------------------------------------------------------ BLE GATT parsers

export function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (chars.indexOf(clean[i]) << 18) | (chars.indexOf(clean[i + 1]) << 12) | ((chars.indexOf(clean[i + 2]) & 63) << 6) | (chars.indexOf(clean[i + 3]) & 63);
    out.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) out.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

/** IEEE-11073 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa. */
export function sfloat(raw: number): number {
  const mantissaRaw = raw & 0x0fff;
  if ([0x07ff, 0x0800, 0x07fe, 0x0802, 0x0801].includes(mantissaRaw)) return NaN; // NaN, NRes, ±INF, reserved
  const mantissa = mantissaRaw >= 0x0800 ? mantissaRaw - 0x1000 : mantissaRaw;
  let exponent = raw >> 12;
  if (exponent >= 0x8) exponent -= 0x10;
  return mantissa * Math.pow(10, exponent);
}

/** IEEE-11073 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa. */
export function float32(raw: number): number {
  const mantissaRaw = raw & 0xffffff;
  if (mantissaRaw === 0x7fffff) return NaN;
  const mantissa = mantissaRaw >= 0x800000 ? mantissaRaw - 0x1000000 : mantissaRaw;
  let exponent = (raw >>> 24) & 0xff;
  if (exponent >= 0x80) exponent -= 0x100;
  return mantissa * Math.pow(10, exponent);
}

/** Heart Rate Measurement (0x2A37). RR intervals arrive in 1/1024 s units. */
export function parseHeartRateMeasurement(bytes: Uint8Array): { hr: number; rr: number[]; contact: boolean | null } {
  const flags = bytes[0];
  let i = 1;
  const hr = flags & 0x01 ? bytes[i] | (bytes[i + 1] << 8) : bytes[i];
  i += flags & 0x01 ? 2 : 1;
  const contact = flags & 0x04 ? !!(flags & 0x02) : null;
  if (flags & 0x08) i += 2; // energy expended
  const rr: number[] = [];
  if (flags & 0x10) for (; i + 1 < bytes.length; i += 2) rr.push(Math.round(((bytes[i] | (bytes[i + 1] << 8)) / 1024) * 1000));
  return { hr, rr, contact };
}

/** PLX Continuous Measurement (0x2A5F): SpO₂ and pulse rate as SFLOATs. */
export function parsePlxContinuous(bytes: Uint8Array): { spo2: number; pulseRate: number } {
  return {
    spo2: sfloat(bytes[1] | (bytes[2] << 8)),
    pulseRate: sfloat(bytes[3] | (bytes[4] << 8)),
  };
}

/** Temperature Measurement (0x2A1C): FLOAT, flag bit 0 = Fahrenheit. Returns °C. */
export function parseTemperatureMeasurement(bytes: Uint8Array): number {
  const raw = (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) >>> 0;
  const value = float32(raw);
  return bytes[0] & 0x01 ? ((value - 32) * 5) / 9 : value;
}

/** RMSSD from RR intervals (ms). */
export function rmssd(rr: number[]): number | undefined {
  if (rr.length < 3) return undefined;
  let sum = 0;
  for (let i = 1; i < rr.length; i++) sum += (rr[i] - rr[i - 1]) ** 2;
  return Math.sqrt(sum / (rr.length - 1));
}
