/** Same-origin: next.config.ts proxies /api and /socket.io to the API server (see BACKEND_URL). */
export const API_BASE = "";

export type Tier = "green" | "yellow" | "red";

export interface HealthSummary {
  tier: Tier;
  mews: number;
  mewsComponents?: { hr: number; spo2: number; skinTemp: number; pulsePressure: number; avpu: number };
  mewsThresholds?: { yellow: number; red: number };
  anomalyScore: number;
  anomalyLevel: "normal" | "watch" | "critical";
  reasons: string[];
  vitals: { hr: number; spo2: number; skinTemp: number; hrvRmssd: number; mobility: number; deltaHr?: number; altitude?: number };
  terrain?: { zones: { name: string; category?: string }[]; escalationOffset: number; altitude?: number };
  selfCheck?: { outcome: "responded" | "expired"; at: string; reason?: string };
  activeIncidentId?: string;
  lastSampleAt?: string;
  updatedAt: string;
}

export interface TriageEntry {
  digitalId: string;
  name: string;
  nationality?: string;
  safetyStatus?: string;
  location: { lat: number; lng: number; altitude?: number } | null;
  health: HealthSummary | null;
  hasHealthId: boolean;
  sbtNetwork?: string;
}

export interface DispatchOption {
  mode: "ground" | "air";
  unit: { nodeId: string; name: string; phone?: string };
  etaMinutes: number;
  distanceKm: number;
  route: { lat: number; lng: number; name: string }[];
}

export interface Incident {
  _id: string;
  touristId: string;
  touristName?: string;
  type: string;
  status: "active" | "acknowledged" | "resolved" | "false_alarm";
  priority: string;
  title: string;
  message: string;
  location: { latitude: number; longitude: number; altitude?: number };
  timeline: { createdAt: string; occurredAt?: string; acknowledgedAt?: string };
  metadata: { trigger: string; selfCheck?: string; offlineBuffered?: boolean };
  clinical: { tier: Tier; mews: number | null; anomalyScore: number | null; reasons: string[]; avpu?: string; vitals?: HealthSummary["vitals"] };
  dispatch: {
    recommended: DispatchOption | null;
    options: DispatchOption[];
    destinationFacility: { nodeId: string; name: string; traumaLevel?: number; etaMinutes: number; mode: string } | null;
    nearestMedicalPost: { name: string; distanceKm: number } | null;
    withinGoldenHour: boolean;
    airEvacuationPossible: boolean;
    dispatchedUnit?: string;
    dispatchedAt?: string;
  };
  efir: {
    firNumber: string;
    generatedAt: string;
    incidentType: string;
    occurredAt: string;
    location: { lat: number; lng: number; altitude?: number; nearestLandmark?: string; mapsUrl: string };
    subject: { digitalId: string; name?: string; nationality?: string; permitTokenId?: string };
    clinicalSummary: { triageTier: string; mews: number; anomalyScore: number | null; reasons: string[] };
    response: { recommendedUnit?: string; mode?: string; etaMinutes?: number; destination?: string; withinGoldenHour: boolean };
    narrative: string;
  };
}

export interface VitalPoint {
  t: number;
  hr?: number;
  spo2?: number;
  skinTemp?: number;
  hrvRmssd?: number;
  mobility?: number;
}

/** Fixed status palette — always shown with an icon and a label, never colour alone. */
export const TIER_STYLE: Record<Tier, { label: string; color: string; bg: string; ring: string }> = {
  red: { label: "Critical", color: "#d03b3b", bg: "bg-red-50", ring: "ring-red-200" },
  yellow: { label: "Watch", color: "#b7791f", bg: "bg-amber-50", ring: "ring-amber-200" },
  green: { label: "Normal", color: "#0ca30c", bg: "bg-green-50", ring: "ring-green-200" },
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Request failed (${res.status})`);
  return (json.data ?? json) as T;
}
