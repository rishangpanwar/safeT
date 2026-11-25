"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Zap } from "lucide-react";
import { api } from "@/lib/health";
import { useAuth } from "../contexts/AuthContext";

interface DemoStatus {
  enabled: boolean;
  wearers: number;
  episodesStarted: number;
  nextEpisodeInSeconds: number;
  active: { digitalId: string; name: string; scenario?: string; severe?: boolean; phase: string }[];
}

const SCENARIOS: [string, string][] = [
  ["", "Random emergency"],
  ["ams", "Altitude sickness (AMS → HAPE)"],
  ["cardiac", "Cardiac event"],
  ["fall", "Fall, unresponsive"],
  ["hypothermia", "Hypothermia"],
  ["heatstroke", "Heatstroke"],
];

const SCENARIO_LABEL: Record<string, string> = { ams: "altitude sickness", cardiac: "cardiac event", fall: "fall", hypothermia: "hypothermia", heatstroke: "heatstroke" };

/**
 * Shown only while the API server runs with DEMO_MODE (npm run demo): says the data is simulated
 * and gives the presenter a one-tap way to start an emergency instead of waiting for the next one.
 */
export default function DemoBanner({ className = "" }: { className?: string }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [scenario, setScenario] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<DemoStatus>("/api/health/demo").then((s) => alive && setStatus(s)).catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!status?.enabled) return null;

  const trigger = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ name: string; scenario: string }>("/api/health/demo/trigger", { method: "POST", body: JSON.stringify(scenario ? { scenario } : {}) });
      setMsg(`${r.name}: ${SCENARIO_LABEL[r.scenario] ?? r.scenario} started. Expect a Watch → Critical tier change, then a 30 s self-check before the incident (≈ 1–3 min).`);
      setStatus(await api<DemoStatus>("/api/health/demo"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start an episode");
    } finally {
      setBusy(false);
    }
  };

  const next = Math.ceil(status.nextEpisodeInSeconds / 60);

  return (
    <div className={`rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2 font-semibold">
          <Clapperboard className="h-4 w-4 shrink-0" aria-hidden /> Live demo · simulated data
        </span>
        <span className="text-indigo-900/80">
          {status.wearers} simulated wearers streaming through the real AI pipeline.{" "}
          {status.active.length
            ? `In progress: ${status.active.map((a) => `${a.name} (${SCENARIO_LABEL[a.scenario ?? ""] ?? a.scenario}${a.phase === "incident" ? ", incident open" : ""})`).join(", ")}.`
            : `Next emergency in about ${next} min.`}
        </span>
        {user && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-sm text-gray-900 sm:flex-none"
              aria-label="Emergency scenario"
            >
              {SCENARIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button onClick={trigger} disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-indigo-700 px-3 py-1.5 font-semibold text-white hover:bg-indigo-800 disabled:opacity-60">
              <Zap className="h-4 w-4" aria-hidden /> {busy ? "Starting…" : "Trigger now"}
            </button>
          </div>
        )}
      </div>
      {msg && <p className="mt-2 text-indigo-900">{msg}</p>}
    </div>
  );
}
