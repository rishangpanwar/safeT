"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Eye, FileText, Heart, HeartPulse, Plane, MapPin,
  Mountain, Printer, Radio, ShieldAlert, Thermometer, Truck, Wifi, WifiOff, Droplets,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";
import { useHealthSocket, playAlarm } from "../hooks/useHealthSocket";
import VitalTrendChart from "../components/VitalTrendChart";
import DemoBanner from "../components/DemoBanner";
import { api, HealthSummary, Incident, TIER_STYLE, Tier, TriageEntry, VitalPoint } from "@/lib/health";

const TierIcon = ({ tier, className = "h-4 w-4" }: { tier: Tier; className?: string }) => {
  const Icon = tier === "red" ? AlertTriangle : tier === "yellow" ? Eye : CheckCircle2;
  return <Icon className={className} style={{ color: TIER_STYLE[tier].color }} aria-hidden />;
};

const TierBadge = ({ tier }: { tier: Tier }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-gray-900 ring-1 ${TIER_STYLE[tier].bg} ${TIER_STYLE[tier].ring}`}>
    <TierIcon tier={tier} className="h-3.5 w-3.5" />
    {TIER_STYLE[tier].label}
  </span>
);

const TRIGGER_LABEL: Record<string, string> = {
  fall: "Fall detected",
  vital_anomaly: "AI vital-sign anomaly",
  manual_sos: "Manual SOS",
  server_escalation: "Unacknowledged critical vitals",
};

const ago = (iso?: string) => {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export default function TriagePage() {
  const { user, isLoading } = useAuth();
  const [board, setBoard] = useState<TriageEntry[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [vitals, setVitals] = useState<VitalPoint[]>([]);
  const [flash, setFlash] = useState<Incident | null>(null);
  const [showEfir, setShowEfir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  /** Select a tourist; on phones the detail sits below the feed, so bring it into view. */
  const select = (id: string) => {
    setSelected(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const load = useCallback(async () => {
    try {
      const [b, inc] = await Promise.all([
        api<TriageEntry[]>("/api/health/triage"),
        api<Incident[]>("/api/health/incidents"),
      ]);
      setBoard(b);
      setIncidents(inc);
      setError(null);
      setSelected((cur) => cur ?? b[0]?.digitalId ?? null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [user, load]);

  const loadVitals = useCallback(async (id: string) => {
    try {
      setVitals(await api<VitalPoint[]>(`/api/health/${id}/vitals?minutes=60`));
    } catch {
      setVitals([]);
    }
  }, []);

  useEffect(() => {
    if (selected && user) loadVitals(selected);
  }, [selected, user, loadVitals]);

  const connected = useHealthSocket({
    onHealthUpdate: (raw) => {
      const d = raw as unknown as HealthSummary & { digitalId: string; location?: TriageEntry["location"] };
      setBoard((prev) => {
        const next = prev.map((t) => (t.digitalId === d.digitalId ? { ...t, health: { ...t.health, ...d }, location: d.location ?? t.location } : t));
        const rank: Record<string, number> = { red: 0, yellow: 1, green: 2 };
        return next.sort((a, b) => rank[a.health?.tier ?? "green"] - rank[b.health?.tier ?? "green"] || (b.health?.mews ?? -1) - (a.health?.mews ?? -1));
      });
      if (d.digitalId === selected) loadVitals(d.digitalId);
    },
    onIncident: (raw) => {
      const inc = raw as unknown as Incident & { isUpdate?: boolean };
      setIncidents((prev) => [inc, ...prev.filter((i) => i._id !== inc._id)]);
      if (!inc.isUpdate) {
        setFlash(inc);
        playAlarm();
      }
    },
  });

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0, monitored: 0 };
    for (const t of board) if (t.health) { c.monitored++; c[t.health.tier]++; }
    return c;
  }, [board]);

  const openIncidents = incidents.filter((i) => i.status === "active" || i.status === "acknowledged");
  const current = board.find((t) => t.digitalId === selected) ?? null;
  const currentIncident = openIncidents.find((i) => i.touristId === selected) ?? null;

  const confirmDispatch = async (inc: Incident) => {
    if (!inc.dispatch.recommended) return;
    setBusy(true);
    try {
      const updated = await api<Incident>(`/api/health/incidents/${inc._id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ unitNodeId: inc.dispatch.recommended.unit.nodeId }),
      });
      setIncidents((prev) => prev.map((i) => (i._id === updated._id ? { ...i, ...updated } : i)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closeIncident = async (inc: Incident, status: "resolved" | "false_alarm") => {
    setBusy(true);
    try {
      await api(`/api/dashboard/alerts/${inc._id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, notes: status === "resolved" ? "Closed from the clinical command centre" : "Marked as false alarm by operator" }),
      });
      setIncidents((prev) => prev.map((i) => (i._id === inc._id ? { ...i, status } : i)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (!user) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <p className="mb-4 text-gray-700">Clinical data is restricted to authorised personnel.</p>
        <Link href="/login" className="font-semibold text-blue-600 underline">Log in to the command centre</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {flash && (
        <div className="sticky top-14 z-40 animate-pulse bg-[#d03b3b] px-4 py-3 text-white sm:top-16 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <AlertTriangle className="h-6 w-6" />
            <span className="font-bold">RED ALERT · {flash.title}</span>
            <span className="text-red-100">{flash.touristName ?? flash.touristId}</span>
            {flash.dispatch?.recommended && (
              <span className="text-red-100">
                → {flash.dispatch.recommended.mode} unit {flash.dispatch.recommended.unit.name}, ETA {flash.dispatch.recommended.etaMinutes} min
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => { select(flash.touristId); setFlash(null); }}>Open</Button>
              <Button size="sm" variant="outline" className="bg-transparent text-white" onClick={() => setFlash(null)}>Dismiss</Button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <HeartPulse className="h-7 w-7 text-[#d03b3b]" /> Clinical Command Centre
            </h1>
            <p className="text-sm text-gray-600">AI anomaly detection (Isolation Forest) · MEWS triage · Golden-Hour dispatch</p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm text-gray-700">
            {connected ? <Wifi className="h-4 w-4 text-[#0ca30c]" /> : <WifiOff className="h-4 w-4 text-gray-400" />}
            {connected ? "Live feed connected" : "Live feed offline — refreshing every 30 s"}
          </span>
        </div>

        <DemoBanner className="mb-4" />

        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {([
            ["Critical (Red)", counts.red, "red"],
            ["Watch (Yellow)", counts.yellow, "yellow"],
            ["Normal (Green)", counts.green, "green"],
          ] as [string, number, Tier][]).map(([label, n, tier]) => (
            <Card key={label} className="border-l-4 py-0" style={{ borderLeftColor: TIER_STYLE[tier].color }}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-xs text-gray-600">{label}</p>
                  <p className="text-2xl font-bold text-gray-900">{n}</p>
                </div>
                <TierIcon tier={tier} className="h-6 w-6" />
              </CardContent>
            </Card>
          ))}
          <Card className="py-0">
            <CardContent className="flex items-center justify-between p-4">
              <div><p className="text-xs text-gray-600">Monitored wearers</p><p className="text-2xl font-bold text-gray-900">{counts.monitored}</p></div>
              <Activity className="h-6 w-6 text-gray-500" />
            </CardContent>
          </Card>
          <Card className="col-span-2 py-0 md:col-span-1">
            <CardContent className="flex items-center justify-between p-4">
              <div><p className="text-xs text-gray-600">Open incidents</p><p className="text-2xl font-bold text-gray-900">{openIncidents.length}</p></div>
              <Radio className="h-6 w-6 text-gray-500" />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Triage feed */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Triage feed</CardTitle>
              <CardDescription>Highest acuity first</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
              {board.length === 0 && <p className="p-6 text-center text-sm text-gray-500">No active tourists.</p>}
              {board.map((t) => {
                const h = t.health;
                const inc = openIncidents.find((i) => i.touristId === t.digitalId);
                return (
                  <button
                    key={t.digitalId}
                    onClick={() => select(t.digitalId)}
                    className={`w-full rounded-lg border p-3 text-left transition hover:shadow ${selected === t.digitalId ? "border-blue-500 ring-1 ring-blue-500" : "border-gray-200"} bg-white`}
                    style={h ? { borderLeft: `4px solid ${TIER_STYLE[h.tier].color}` } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-gray-900">{t.name}</span>
                      {h ? <TierBadge tier={h.tier} /> : <span className="text-xs text-gray-400">no wearable data</span>}
                    </div>
                    {h && (
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-600">
                        <span>MEWS <b className="text-gray-900">{h.mews}</b></span>
                        <span>AI s=<b className="text-gray-900">{h.anomalyScore?.toFixed(2)}</b></span>
                        <span>HR {h.vitals?.hr}</span>
                        <span>SpO₂ {h.vitals?.spo2}%</span>
                        <span>{h.vitals?.skinTemp}°C</span>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                      {h?.terrain?.zones?.length ? <span className="inline-flex items-center gap-1"><Mountain className="h-3 w-3" />{h.terrain.zones[0].name}</span> : null}
                      {inc && <span className="inline-flex items-center gap-1 font-semibold text-gray-900"><AlertTriangle className="h-3 w-3 text-[#d03b3b]" />Incident {inc.status}</span>}
                      {h && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{ago(h.updatedAt)}</span>}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Detail */}
          <div ref={detailRef} className="scroll-mt-20 space-y-6 lg:col-span-3">
            {current ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">{current.name}</CardTitle>
                      <CardDescription>
                        {current.digitalId} · {current.nationality ?? "—"} · Health permit: {current.hasHealthId ? `SBT (${current.sbtNetwork})` : "not registered"}
                      </CardDescription>
                    </div>
                    {current.health && <TierBadge tier={current.health.tier} />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {current.health ? (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { icon: Heart, label: "Heart rate", v: `${current.health.vitals.hr} bpm`, s: current.health.mewsComponents?.hr },
                          { icon: Droplets, label: "SpO₂", v: `${current.health.vitals.spo2}%`, s: current.health.mewsComponents?.spo2 },
                          { icon: Thermometer, label: "Temperature", v: `${current.health.vitals.skinTemp} °C`, s: current.health.mewsComponents?.skinTemp },
                          { icon: Activity, label: "Responsiveness", v: current.health.selfCheck?.outcome === "expired" ? "No response" : "Alert", s: current.health.mewsComponents?.avpu },
                        ].map((x) => (
                          <div key={x.label} className="rounded-lg border border-gray-200 p-3">
                            <p className="flex items-center gap-1 text-xs text-gray-600"><x.icon className="h-3.5 w-3.5" />{x.label}</p>
                            <p className="text-lg font-bold text-gray-900">{x.v}</p>
                            <p className="text-xs text-gray-500">MEWS +{x.s ?? 0}</p>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3 text-sm">
                        <p className="mb-1 font-medium text-gray-900">
                          MEWS {current.health.mews} (Red ≥ {current.health.mewsThresholds?.red ?? 5}) · Isolation Forest s = {current.health.anomalyScore?.toFixed(3)} ({current.health.anomalyLevel})
                        </p>
                        <ul className="list-disc space-y-0.5 pl-5 text-gray-700">
                          {current.health.reasons?.length ? current.health.reasons.map((r) => <li key={r}>{r}</li>) : <li>All parameters within normal bands</li>}
                        </ul>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <VitalTrendChart data={vitals} field="hr" title="Heart rate (60 min)" unit="bpm" bands={[{ value: 100, label: "+1" }, { value: 130, label: "+3" }]} />
                        <VitalTrendChart data={vitals} field="spo2" title="SpO₂ (60 min)" unit="%" bands={[{ value: 95, label: "+0" }, { value: 90, label: "+2" }, { value: 85, label: "+3" }]} ceil={100} />
                        <VitalTrendChart data={vitals} field="skinTemp" title="Temperature (60 min)" unit="°C" decimals={1} bands={[{ value: 35, label: "+2" }, { value: 37.5, label: "+0" }, { value: 38.5, label: "+2" }]} />
                      </div>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-gray-600">Show vital-sign table ({vitals.length} points)</summary>
                        <div className="mt-2 max-h-56 overflow-auto rounded border border-gray-200">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-gray-100 text-gray-700">
                              <tr><th className="p-1.5">Time</th><th>HR</th><th>SpO₂</th><th>Temp</th><th>HRV</th><th>Motion</th></tr>
                            </thead>
                            <tbody>
                              {vitals.slice().reverse().map((p) => (
                                <tr key={p.t} className="border-t border-gray-100 text-gray-800">
                                  <td className="p-1.5">{new Date(p.t).toLocaleTimeString()}</td>
                                  <td>{p.hr ?? "—"}</td><td>{p.spo2 ?? "—"}</td><td>{p.skinTemp ?? "—"}</td><td>{p.hrvRmssd ?? "—"}</td><td>{p.mobility ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">This tourist has not streamed any wearable telemetry yet.</p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="p-10 text-center text-gray-500">Select a tourist from the triage feed.</CardContent></Card>
            )}

            {currentIncident && <IncidentPanel inc={currentIncident} busy={busy} onDispatch={confirmDispatch} onClose={closeIncident} showEfir={showEfir === currentIncident._id} toggleEfir={() => setShowEfir(showEfir === currentIncident._id ? null : currentIncident._id)} />}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Incident queue</CardTitle>
                <CardDescription>Health emergencies raised by the AI pipeline, fall detector or SOS</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {openIncidents.length === 0 && <p className="p-4 text-center text-sm text-gray-500">No open incidents.</p>}
                {openIncidents.map((i) => (
                  <button key={i._id} onClick={() => select(i.touristId)} className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left hover:shadow">
                    <AlertTriangle className="h-4 w-4 text-[#d03b3b]" />
                    <span className="font-medium text-gray-900">{TRIGGER_LABEL[i.metadata?.trigger] ?? i.type}</span>
                    <span className="text-sm text-gray-600">{i.touristName ?? board.find((b) => b.digitalId === i.touristId)?.name ?? i.touristId}</span>
                    <span className="text-xs text-gray-500">{ago(i.timeline?.createdAt)}</span>
                    <span className="ml-auto text-xs font-semibold uppercase text-gray-700">{i.status}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncidentPanel({ inc, busy, onDispatch, onClose, showEfir, toggleEfir }: { inc: Incident; busy: boolean; onDispatch: (i: Incident) => void; onClose: (i: Incident, status: "resolved" | "false_alarm") => void; showEfir: boolean; toggleEfir: () => void }) {
  const d = inc.dispatch;
  const r = d?.recommended;
  return (
    <Card className="border-l-4" style={{ borderLeftColor: "#d03b3b" }}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-5 w-5 text-[#d03b3b]" />{inc.title}</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-900">
            {d?.withinGoldenHour ? <CheckCircle2 className="h-3.5 w-3.5 text-[#0ca30c]" /> : <Clock className="h-3.5 w-3.5 text-[#d03b3b]" />}
            {d?.withinGoldenHour ? "Within Golden Hour" : "Exceeds Golden Hour"}
          </span>
        </div>
        <CardDescription>
          {TRIGGER_LABEL[inc.metadata?.trigger]} · occurred {new Date(inc.timeline.occurredAt ?? inc.timeline.createdAt).toLocaleString()}
          {inc.metadata?.offlineBuffered ? " · delivered after offline buffering" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2 text-gray-700">
          <a className="inline-flex items-center gap-1 text-blue-700 underline" href={`https://www.google.com/maps?q=${inc.location.latitude},${inc.location.longitude}`} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-4 w-4" />{inc.location.latitude.toFixed(5)}, {inc.location.longitude.toFixed(5)}{inc.location.altitude ? ` · ${Math.round(inc.location.altitude)} m` : ""}
          </a>
          {d?.nearestMedicalPost && <span>· {d.nearestMedicalPost.distanceKm} km from {d.nearestMedicalPost.name}</span>}
          {!d?.airEvacuationPossible && <span className="font-medium text-gray-900">· Helicopter access restricted here</span>}
        </div>

        {r && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-600">Recommended asset</p>
            <p className="flex items-center gap-2 text-base font-semibold text-gray-900">
              {r.mode === "air" ? <Plane className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
              {r.unit.name} · ETA {r.etaMinutes} min · {r.distanceKm} km
            </p>
            {d.destinationFacility && (
              <p className="text-gray-700">Definitive care: {d.destinationFacility.name}{d.destinationFacility.traumaLevel ? ` (trauma level ${d.destinationFacility.traumaLevel})` : ""} · {d.destinationFacility.etaMinutes} min by {d.destinationFacility.mode}</p>
            )}
            {r.mode === "ground" && r.route.length > 2 && <p className="mt-1 text-xs text-gray-600">Route: {r.route.map((p) => p.name).join(" → ")}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {d.dispatchedAt ? (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900"><CheckCircle2 className="h-4 w-4 text-[#0ca30c]" />Dispatched {new Date(d.dispatchedAt).toLocaleTimeString()}</span>
              ) : (
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDispatch(inc)}>Confirm dispatch</Button>
              )}
              <Button size="sm" variant="outline" onClick={toggleEfir}><FileText className="h-4 w-4" />{showEfir ? "Hide E-FIR" : "View E-FIR"}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onClose(inc, "resolved")}><CheckCircle2 className="h-4 w-4" />Mark resolved</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onClose(inc, "false_alarm")}>False alarm</Button>
            </div>
          </div>
        )}

        {d?.options?.length > 1 && (
          <table className="w-full text-left text-xs">
            <thead className="text-gray-600"><tr><th className="py-1">Mode</th><th>Unit</th><th className="text-right">Distance</th><th className="text-right">ETA</th></tr></thead>
            <tbody>
              {d.options.map((o) => (
                <tr key={`${o.mode}-${o.unit.nodeId}`} className="border-t border-gray-100 text-gray-800">
                  <td className="py-1 capitalize">{o.mode}</td><td>{o.unit.name}</td><td className="text-right">{o.distanceKm} km</td><td className="text-right font-semibold">{o.etaMinutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {showEfir && inc.efir && (
          <div className="rounded-lg border border-gray-300 bg-white p-4 print:border-0" id="efir">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-gray-900">Electronic First Information Report · {inc.efir.firNumber}</p>
              <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
            </div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="text-gray-500">Incident</dt><dd className="text-gray-900">{inc.efir.incidentType}</dd></div>
              <div><dt className="text-gray-500">Occurred</dt><dd className="text-gray-900">{new Date(inc.efir.occurredAt).toLocaleString()}</dd></div>
              <div><dt className="text-gray-500">Subject</dt><dd className="text-gray-900">{inc.efir.subject.name} ({inc.efir.subject.nationality}) · {inc.efir.subject.digitalId}</dd></div>
              <div><dt className="text-gray-500">Location</dt><dd className="text-gray-900">{inc.efir.location.lat.toFixed(5)}, {inc.efir.location.lng.toFixed(5)}{inc.efir.location.nearestLandmark ? ` near ${inc.efir.location.nearestLandmark}` : ""}</dd></div>
              <div><dt className="text-gray-500">Triage</dt><dd className="text-gray-900">{inc.efir.clinicalSummary.triageTier.toUpperCase()} · MEWS {inc.efir.clinicalSummary.mews}</dd></div>
              <div><dt className="text-gray-500">Response</dt><dd className="text-gray-900">{inc.efir.response.recommendedUnit} ({inc.efir.response.mode}) · ETA {inc.efir.response.etaMinutes} min</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-gray-800">{inc.efir.narrative}</p>
            <p className="mt-2 text-[11px] text-gray-500">Clinical directives (blood group, allergies) are excluded from the E-FIR and released only to medical responders via the signed Emergency QR.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
