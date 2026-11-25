"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ShieldAlert,
  Bell,
  Users,
  MapPin,
  AlertTriangle,
  Clock,
  HeartPulse,
  CheckCircle2,
  Eye,
  Wifi,
  WifiOff,
  Activity,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useHealthSocket } from "../hooks/useHealthSocket";
import DemoBanner from "../components/DemoBanner";

// Leaflet touches `window` at import time, so the map must never render on the server.
const DashboardMap = dynamic(() => import("@/app/components/DashboardMapComponent"), { ssr: false });

type Stat = { name: string; stat: string; icon: React.ComponentType<{ className?: string }>; change: string; changeType: "positive" | "negative" | "neutral"; href?: string };

type Alert = {
  id: string;
  type: string;
  severity: "danger" | "warning" | "info";
  priority: string;
  title: string;
  message: string;
  time: string;
  createdAt?: string;
  location: string;
  mapsQuery: string | null;
  icon: React.ComponentType<{ className?: string }>;
  status: string;
  touristId?: string;
  isHealth: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  health_emergency: "Health emergency",
  fall_detected: "Fall detected",
  emergency: "SOS distress",
  geofence_breach: "Geo-fence breach",
  panic: "Panic button",
  medical: "Medical",
};

const humanize = (s: string) => TYPE_LABEL[s] ?? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const getAlertIcon = (type: string) => {
  if (type === "health_emergency") return HeartPulse;
  if (type === "fall_detected") return Activity;
  if (/emergency|panic|sos/i.test(type)) return AlertTriangle;
  if (/geo/i.test(type)) return MapPin;
  if (/medical/i.test(type)) return ShieldAlert;
  return Clock;
};

const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [health, setHealth] = useState<{ monitored: number; red: number; yellow: number; green: number; activeIncidents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [statsRes, alertsRes, activeRes, zonesRes] = await Promise.all([
        fetch("/api/dashboard/stats"),
        fetch("/api/dashboard/alerts?limit=8", { credentials: "include" }),
        fetch("/api/dashboard/alerts?status=active&limit=1", { credentials: "include" }),
        fetch("/api/geofences", { credentials: "include" }),
      ]);
      if (!statsRes.ok) throw new Error(`Command server returned ${statsRes.status}`);

      const s = await statsRes.json();
      if (s.health) setHealth(s.health);

      const activeData = activeRes.ok ? await activeRes.json() : null;
      const activeAlerts: number = activeData?.data?.pagination?.total ?? activeData?.data?.alerts?.length ?? 0;

      const zonesData = zonesRes.ok ? await zonesRes.json() : null;
      const zones: { riskLevel?: string; type?: string }[] = zonesData?.data?.geoFences ?? [];
      const highRisk = zones.filter((z) => z.riskLevel === "high" || z.riskLevel === "critical" || z.type === "restricted_zone").length;

      const rt = s.responseTime as { medianMinutes: number | null; samples: number } | undefined;
      setStats([
        {
          name: "Active Tourists",
          stat: String(s.activeTourists?.count ?? 0),
          icon: Users,
          change: s.health ? `${s.health.monitored} with live wearable data` : "Registered and travelling",
          changeType: "neutral",
        },
        {
          name: "Active Alerts",
          stat: String(activeAlerts),
          icon: AlertTriangle,
          change: activeAlerts > 0 ? `${activeAlerts} awaiting action` : "No active alerts",
          changeType: activeAlerts > 0 ? "negative" : "positive",
          href: "/alerts",
        },
        {
          name: "High-Risk Zones",
          stat: String(highRisk),
          icon: MapPin,
          change: `${zones.length} zones monitored in total`,
          changeType: "neutral",
          href: "/high-risk-zones",
        },
        {
          name: "Median Response Time",
          stat: rt?.medianMinutes != null ? `${rt.medianMinutes} min` : "—",
          icon: Clock,
          change: rt?.samples ? `Alert → unit dispatched · ${rt.samples} incident${rt.samples > 1 ? "s" : ""}, 7 days` : "No dispatched incidents yet",
          changeType: rt?.medianMinutes != null && rt.medianMinutes > 5 ? "negative" : "neutral",
        },
      ]);

      if (alertsRes.ok) {
        const alertsData = await alertsRes.json();
        const alerts = alertsData.success ? alertsData.data.alerts : Array.isArray(alertsData) ? alertsData : [];
        setRecentAlerts(
          alerts.map((alert: any) => {
            const priority: string = alert.priority || alert.severity || "medium";
            const lat = alert.location?.latitude, lng = alert.location?.longitude;
            return {
              id: alert._id || alert.id,
              type: alert.type || "alert",
              priority,
              severity: priority === "critical" || priority === "high" || priority === "danger" ? "danger" : priority === "medium" || priority === "warning" ? "warning" : "info",
              title: alert.title || humanize(alert.type || "alert"),
              message: alert.message || "No message",
              time: ago(alert.timeline?.createdAt),
              createdAt: alert.timeline?.createdAt,
              location: alert.location?.address || (lat != null ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}` : "Unknown location"),
              mapsQuery: lat != null && lng != null ? `${lat},${lng}` : null,
              icon: getAlertIcon(alert.type || ""),
              status: alert.status,
              touristId: alert.touristId,
              isHealth: alert.metadata?.source === "health_monitor",
            } as Alert;
          })
        );
      }
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
      setError("Can't reach the command server. Retrying…");
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  // New incidents or status changes → refresh soon (debounced; several events can arrive together).
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(fetchDashboardData, 1500);
  }, [fetchDashboardData]);
  const connected = useHealthSocket({ onIncident: refreshSoon, onSelfCheck: refreshSoon });

  const severityStyles = { danger: "border-l-destructive bg-destructive/5", warning: "border-l-warning bg-warning/5", info: "border-l-primary bg-primary/5" };
  const severityText = { danger: "text-destructive", warning: "text-warning-foreground", info: "text-primary" };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-gradient-hero border-b">
        <div className="px-4 py-5 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-primary-foreground sm:text-3xl">Authorities Dashboard</h1>
              <p className="mt-1 text-sm text-primary-foreground/80 sm:mt-2 sm:text-base">
                Real-time tourist monitoring, risk zones and incident response
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="bg-primary-foreground/10 text-primary-foreground border-primary-foreground/20">
                {connected ? <Wifi className="mr-1.5 h-3.5 w-3.5" /> : <WifiOff className="mr-1.5 h-3.5 w-3.5" />}
                {connected ? "Live" : "Reconnecting"}
              </Badge>
              <Badge variant="secondary" className="bg-primary-foreground/10 text-primary-foreground border-primary-foreground/20">
                <Bell className="mr-1.5 h-3.5 w-3.5" />
                {health ? `${health.activeIncidents} open health incident${health.activeIncidents === 1 ? "" : "s"}` : "Loading…"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <DemoBanner className="mx-4 mt-4 sm:mx-6" />

      {error && (
        <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mx-6">{error}</div>
      )}

      {/* Clinical triage strip (MEWS + Isolation Forest) */}
      {health && (
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <Link href="/triage" className="block">
            <Card className={`py-0 transition-shadow hover:shadow-elegant ${health.red > 0 ? "ring-2 ring-red-300" : ""}`}>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <span className="flex items-center gap-2 font-semibold text-gray-900">
                  <HeartPulse className="h-5 w-5 text-[#d03b3b]" /> Clinical triage
                </span>
                <span className="flex items-center gap-1.5 text-sm text-gray-700">
                  <AlertTriangle className="h-4 w-4 text-[#d03b3b]" /> Critical <b className="text-gray-900">{health.red}</b>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-gray-700">
                  <Eye className="h-4 w-4 text-[#b7791f]" /> Watch <b className="text-gray-900">{health.yellow}</b>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-gray-700">
                  <CheckCircle2 className="h-4 w-4 text-[#0ca30c]" /> Normal <b className="text-gray-900">{health.green}</b>
                </span>
                <span className="text-sm text-gray-600">{health.monitored} wearers monitored</span>
                <span className="w-full text-sm font-medium text-blue-700 sm:ml-auto sm:w-auto">Open command centre →</span>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}

      {/* Stats Cards */}
      <div className="px-4 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-6 lg:grid-cols-4">
          {(stats ?? Array.from({ length: 4 }, () => null)).map((item, i) => {
            if (!item) {
              return (
                <Card key={i} className="py-0 shadow-card">
                  <CardContent className="space-y-2 p-4 sm:p-6">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-gray-200" />
                    <div className="h-7 w-1/3 animate-pulse rounded bg-gray-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                  </CardContent>
                </Card>
              );
            }
            const body = (
              <Card className={`h-full py-0 shadow-card transition-shadow hover:shadow-elegant ${item.href ? "cursor-pointer" : ""}`}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground sm:text-sm">{item.name}</p>
                      <p className="mt-1 text-2xl font-bold text-foreground sm:mt-2 sm:text-3xl">{item.stat}</p>
                      <p className={`mt-1 text-xs sm:mt-2 ${item.changeType === "positive" ? "text-green-700" : item.changeType === "negative" ? "text-red-700" : "text-gray-600"}`}>
                        {item.change}
                      </p>
                    </div>
                    <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-feature sm:flex">
                      <item.icon className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
            return item.href ? <Link key={item.name} href={item.href}>{body}</Link> : <div key={item.name}>{body}</div>;
          })}
        </div>

        {/* Map + alerts: stacked on phones, side by side on wide screens */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:h-[70vh] xl:grid-cols-5">
          <div className="h-[60vh] min-h-[360px] xl:col-span-3 xl:h-full">
            <Suspense
              fallback={
                <Card className="h-full">
                  <CardContent className="flex h-full items-center justify-center">
                    <div className="space-y-4 text-center">
                      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                      <p className="text-muted-foreground">Loading Map...</p>
                    </div>
                  </CardContent>
                </Card>
              }
            >
              <DashboardMap />
            </Suspense>
          </div>

          <div className="xl:col-span-2 xl:h-full">
            <Card className="flex h-full max-h-[75vh] flex-col gap-0 pt-0 shadow-elegant xl:max-h-none">
              <CardHeader className="border-b bg-gradient-feature">
                <CardTitle className="flex items-center justify-between">
                  <span className="text-foreground">Alerts & Incidents</span>
                  <Link href="/alerts" className="text-sm font-medium text-blue-700">View all →</Link>
                </CardTitle>
                <CardDescription>
                  Latest safety alerts and incident reports{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString()}` : ""}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1 overflow-hidden p-0">
                <div className="h-full space-y-3 overflow-y-auto p-3 sm:p-4">
                  {recentAlerts.length === 0 && (
                    <p className="p-6 text-center text-sm text-gray-500">{stats ? "No alerts yet." : "Loading alerts…"}</p>
                  )}
                  {recentAlerts.map((alert) => {
                    const open = alert.status === "active" || alert.status === "acknowledged";
                    return (
                      <div key={alert.id} className={`rounded-r-lg border-l-4 p-3 transition-shadow hover:shadow-md sm:p-4 ${severityStyles[alert.severity]} ${open ? "" : "opacity-70"}`}>
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <alert.icon className={`h-4 w-4 shrink-0 ${severityText[alert.severity]}`} />
                            <h4 className="truncate font-semibold text-gray-900">{alert.title}</h4>
                          </div>
                          <Badge variant={open && alert.severity === "danger" ? "destructive" : "secondary"} className="shrink-0 text-xs capitalize">
                            {alert.status?.replace("_", " ") ?? alert.priority}
                          </Badge>
                        </div>

                        <p className="mb-2 line-clamp-3 text-sm text-foreground">{alert.message}</p>

                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center">
                            <MapPin className="mr-1 h-3 w-3" />
                            {alert.location}
                          </span>
                          <span className="flex items-center" title={alert.createdAt ? new Date(alert.createdAt).toLocaleString() : undefined}>
                            <Clock className="mr-1 h-3 w-3" />
                            {alert.time}
                          </span>
                        </div>

                        {open && (
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs font-medium">
                            {alert.isHealth && <Link href="/triage" className="text-blue-700 underline">Open in triage</Link>}
                            {alert.severity === "danger" && alert.mapsQuery && (
                              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(alert.mapsQuery)}`} target="_blank" rel="noopener noreferrer" className="text-red-700 underline">
                                Emergency location on Google Maps
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
