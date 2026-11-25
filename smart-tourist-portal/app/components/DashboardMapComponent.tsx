"use client";

import { MapContainer, TileLayer, Marker, Popup, Circle, Polygon, Rectangle, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { API_BASE, TIER_STYLE, Tier } from "@/lib/health";
import { useHealthSocket } from "../hooks/useHealthSocket";

/** Quick views over the monitored regions (the demo cohort and seeded rescue network live here). */
const REGIONS: { name: string; bounds: [[number, number], [number, number]] }[] = [
  { name: "Kedarnath", bounds: [[30.56, 78.97], [30.76, 79.1]] },
  { name: "Manali–Rohtang", bounds: [[32.22, 77.15], [32.4, 77.28]] },
  { name: "Jaipur", bounds: [[26.9, 75.78], [27.0, 75.87]] },
];

/** Gives the parent a handle on the Leaflet map (for the region buttons). */
function MapHandle({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  return null;
}

// Triage-tier markers: status colour + a glyph, so the tier never relies on colour alone.
const TIER_GLYPH: Record<Tier, string> = { red: "!", yellow: "?", green: "✓" };
const tierIcon = (tier: Tier) =>
  L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${TIER_STYLE[tier].color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:700 14px/22px sans-serif;text-align:center">${TIER_GLYPH[tier]}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });

const FACILITY_GLYPH: Record<string, string> = { trauma_center: "H", medical_post: "+", sar_base: "R", helipad: "✈", waypoint: "·" };
const facilityIcon = (kind: string) =>
  L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:4px;background:#fff;border:2px solid #52514e;color:#0b0b0b;font:700 12px/16px sans-serif;text-align:center">${FACILITY_GLYPH[kind] ?? "·"}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

interface Facility { nodeId: string; name: string; kind: string; lat: number; lng: number; elevation: number; traumaLevel?: number; airAmbulance?: boolean }

/** Fits the view to tourists + facilities once data first arrives. */
function FitToData({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 12 });
  }, [points, map]);
  return null;
}

// Fix for default icon issue with Leaflet and React
const defaultIcon = L.icon({
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const alertIcon = L.icon({
  iconUrl:
    "data:image/svg+xml;base64," +
    btoa(`
        <svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 19.4 12.5 41 12.5 41S25 19.4 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#dc2626"/>
            <circle cx="12.5" cy="12.5" r="8" fill="white"/>
            <circle cx="12.5" cy="12.5" r="5" fill="#dc2626"/>
        </svg>
    `),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Tourist {
  _id: string;
  digitalId: string;
  lastLocation?: { lat: number; lng: number; altitude?: number };
  safetyStatus: "normal" | "alert" | "danger";
  kyc?: {
    name?: string;
    nationality?: string;
  };
  health?: { tier: Tier; mews: number; anomalyScore: number; vitals?: { hr: number; spo2: number; skinTemp: number } } | null;
}

interface GeoFence {
  _id: string;
  name: string;
  type: "safe_zone" | "restricted_zone" | "alert_zone" | "emergency_zone" | "danger_zone" | "restricted_area" | "tourist_zone";
  riskLevel?: "low" | "medium" | "high" | "critical";
  geometry: {
    type: "Polygon" | "Circle";
    coordinates: number[][] | number[];
    radius?: number;
  };
  isActive: boolean;
}

export default function DashboardMap() {
  const [tourists, setTourists] = useState<Tourist[]>([]);
  const [geoFences, setGeoFences] = useState<GeoFence[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [layers, setLayers] = useState({ facilities: true, density: false });
  const [loading, setLoading] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const mapRef = useRef<L.Map | null>(null);
  const onMapReady = useCallback((m: L.Map) => {
    mapRef.current = m;
  }, []);

  // Live feed: positions and triage tiers move without waiting for the 30 s refresh.
  useHealthSocket({
    onLocation: (raw) => {
      const d = raw as { touristId?: string; location?: { latitude: number; longitude: number; altitude?: number } };
      if (!d.touristId || !d.location) return;
      setTourists((prev) =>
        prev.map((t) => (t.digitalId === d.touristId ? { ...t, lastLocation: { lat: d.location!.latitude, lng: d.location!.longitude, altitude: d.location!.altitude } } : t))
      );
    },
    onHealthUpdate: (raw) => {
      const d = raw as { digitalId?: string; tier?: Tier; mews?: number; anomalyScore?: number; vitals?: { hr: number; spo2: number; skinTemp: number } };
      if (!d.digitalId || !d.tier) return;
      setTourists((prev) =>
        prev.map((t) =>
          t.digitalId === d.digitalId
            ? { ...t, safetyStatus: d.tier === "red" ? "danger" : t.safetyStatus, health: { tier: d.tier!, mews: d.mews ?? 0, anomalyScore: d.anomalyScore ?? 0, vitals: d.vitals } }
            : t
        )
      );
    },
  });

  useEffect(() => {
    fetch(`${API_BASE}/api/health/network`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data?.nodes && setFacilities(j.data.nodes.filter((n: Facility) => n.kind !== "waypoint")))
      .catch(() => undefined);
  }, []);

  // Tourist density heatmap: ~5 km grid cells, one sequential hue (light → dark blue).
  const density = useMemo(() => {
    const cell = 0.05;
    const bins = new Map<string, { lat: number; lng: number; n: number }>();
    for (const t of tourists) {
      if (!t.lastLocation) continue;
      const lat = Math.floor(t.lastLocation.lat / cell) * cell;
      const lng = Math.floor(t.lastLocation.lng / cell) * cell;
      const k = `${lat}:${lng}`;
      bins.set(k, { lat, lng, n: (bins.get(k)?.n ?? 0) + 1 });
    }
    const max = Math.max(1, ...[...bins.values()].map((b) => b.n));
    return [...bins.values()].map((b) => ({ ...b, cell, alpha: 0.2 + 0.55 * (b.n / max) }));
  }, [tourists]);

  const fitPoints = useMemo<[number, number][]>(
    () => [
      ...tourists.filter((t) => t.lastLocation).map((t) => [t.lastLocation!.lat, t.lastLocation!.lng] as [number, number]),
      ...facilities.map((f) => [f.lat, f.lng] as [number, number]),
    ],
    [tourists, facilities]
  );

  useEffect(() => {
    const fetchData = async () => {
      try {

        // Fetch tourists data
        const touristsResponse = await fetch('/api/dashboard/tourists');
        if (touristsResponse.ok) {
          const touristsData = await touristsResponse.json();
          // Filter out tourists without location data for the map
          const touristsWithLocation = touristsData.filter((tourist: any) =>
            tourist.lastLocation &&
            tourist.lastLocation.lat &&
            tourist.lastLocation.lng &&
            tourist.isActive
          );
          setTourists(touristsWithLocation);
        }

        // Fetch geo-fences data
        const geoFencesResponse = await fetch('/api/geofences', {
          credentials: 'include'
        });
        if (geoFencesResponse.ok) {
          const geoFencesResult = await geoFencesResponse.json();
          const geoFencesData = geoFencesResult.success ? geoFencesResult.data.geoFences : [];
          setGeoFences(geoFencesData.filter((gf: GeoFence) => gf.isActive));
        }
      } catch (error) {
        // Keep the last known positions on screen; the next refresh will retry.
        console.error("Failed to fetch map data", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Fetch every 30 seconds to simulate real-time updates
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-card rounded-lg shadow-elegant">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-muted-foreground">Loading map data...</p>
        </div>
      </div>
    );
  }

  // OpenStreetMap standard tiles (free with attribution; CARTO basemaps now require an API key).
  const tileLayerUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileLayerAttribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const getStatusColor = (status: string) => {
    switch (status) {
      case "danger":
        return "text-destructive";
      case "alert":
        return "text-warning";
      default:
        return "text-accent";
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "danger":
        return "bg-destructive/10";
      case "alert":
        return "bg-warning/10";
      default:
        return "bg-accent/10";
    }
  };

  const getGeoFenceColor = (geoFence: GeoFence) => {
    // Use risk level if available, otherwise fall back to type-based colors
    if (geoFence.riskLevel) {
      switch (geoFence.riskLevel) {
        case "low":
          return { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.2 }; // Green
        case "medium":
          return { color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.2 }; // Yellow/Orange
        case "high":
          return { color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.2 }; // Red
        case "critical":
          return { color: "#9333ea", fillColor: "#9333ea", fillOpacity: 0.2 }; // Purple
      }
    }

    // Fallback to type-based colors for backward compatibility
    switch (geoFence.type) {
      case "safe_zone":
      case "tourist_zone":
        return { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.2 }; // Green
      case "alert_zone":
        return { color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.2 }; // Yellow/Orange
      case "restricted_zone":
      case "restricted_area":
      case "danger_zone":
        return { color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.2 }; // Red
      case "emergency_zone":
        return { color: "#9333ea", fillColor: "#9333ea", fillOpacity: 0.2 }; // Purple
      default:
        return { color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.2 }; // Gray
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-card rounded-lg shadow-elegant overflow-hidden border">
      <div className="bg-gradient-hero border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-primary-foreground font-semibold text-sm sm:text-base">Live Tracking &amp; Risk Zones</h3>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="flex items-center gap-1 text-primary-foreground text-xs">
              <input type="checkbox" checked={layers.facilities} onChange={(e) => setLayers((l) => ({ ...l, facilities: e.target.checked }))} />
              Rescue network
            </label>
            <label className="flex items-center gap-1 text-primary-foreground text-xs">
              <input type="checkbox" checked={layers.density} onChange={(e) => setLayers((l) => ({ ...l, density: e.target.checked }))} />
              Density
            </label>
            <button onClick={() => setShowLegend((v) => !v)} className="rounded border border-primary-foreground/40 px-2 py-0.5 text-xs text-primary-foreground" aria-expanded={showLegend}>
              {showLegend ? "Hide legend" : "Legend"}
            </button>
          </div>
        </div>
        <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
          {REGIONS.map((r) => (
            <button
              key={r.name}
              onClick={() => mapRef.current?.fitBounds(r.bounds)}
              className="shrink-0 rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary-foreground/25"
            >
              {r.name}
            </button>
          ))}
          <button
            onClick={() => fitPoints.length && mapRef.current?.fitBounds(L.latLngBounds(fitPoints).pad(0.15), { maxZoom: 12 })}
            className="shrink-0 rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary-foreground/25"
          >
            All
          </button>
        </div>
        {showLegend && (
          <div className="mt-2 grid grid-cols-1 gap-1 rounded bg-white/95 p-2 text-xs text-gray-800 sm:grid-cols-3">
            <div>
              <p className="mb-0.5 font-semibold">Tourist triage</p>
              <p>{(["green", "yellow", "red"] as Tier[]).map((t) => <span key={t} className="mr-2 inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: TIER_STYLE[t].color }} />{TIER_STYLE[t].label}</span>)}</p>
            </div>
            <div>
              <p className="mb-0.5 font-semibold">Zone risk</p>
              <p>{([["#22c55e", "Low"], ["#fbbf24", "Medium"], ["#ef4444", "High"], ["#9333ea", "Critical"]] as const).map(([c, l]) => <span key={l} className="mr-2 inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}</p>
            </div>
            <div>
              <p className="mb-0.5 font-semibold">Rescue network</p>
              <p>H trauma centre · + medical post · R rescue base · ✈ helipad</p>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <MapContainer
          center={[26.9124, 75.7873]}
          zoom={11}
          scrollWheelZoom={true}
          style={{ height: "100%", width: "100%" }}
          className="z-0"
        >
          <TileLayer attribution={tileLayerAttribution} url={tileLayerUrl} maxZoom={19} />
          <FitToData points={fitPoints} />
          <MapHandle onReady={onMapReady} />

          {layers.density &&
            density.map((b) => (
              <Rectangle
                key={`${b.lat}:${b.lng}`}
                bounds={[[b.lat, b.lng], [b.lat + b.cell, b.lng + b.cell]]}
                pathOptions={{ color: "#2a78d6", weight: 0, fillColor: "#2a78d6", fillOpacity: b.alpha }}
              >
                <Popup>{b.n} tourist{b.n > 1 ? "s" : ""} in this ~5 km cell</Popup>
              </Rectangle>
            ))}

          {layers.facilities &&
            facilities.map((f) => (
              <Marker key={f.nodeId} position={[f.lat, f.lng]} icon={facilityIcon(f.kind)}>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">{f.name}</p>
                    <p className="text-muted-foreground">
                      {f.kind.replace("_", " ")}
                      {f.traumaLevel ? ` · trauma level ${f.traumaLevel}` : ""}
                      {f.airAmbulance ? " · air ambulance" : ""} · {f.elevation} m
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}

          {/* Render geo-fences */}
          {geoFences.map((geoFence) => {
            const colors = getGeoFenceColor(geoFence);

            if (geoFence.geometry.type === "Circle") {
              // coordinates for circle is [longitude, latitude]
              const coords = geoFence.geometry.coordinates as number[];
              const longitude = coords[0];
              const latitude = coords[1];
              const center: [number, number] = [latitude, longitude];

              return (
                <Circle
                  key={geoFence._id}
                  center={center}
                  radius={geoFence.geometry.radius || 1000}
                  pathOptions={colors}
                  weight={2}
                >
                  <Popup>
                    <div className="p-2 space-y-2 min-w-[180px]">
                      <div className="border-b border-border pb-2">
                        <p className="font-semibold text-foreground">
                          {geoFence.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {geoFence.type.replace('_', ' ').toUpperCase()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        {geoFence.riskLevel && (
                          <p className="text-sm">
                            <span className="font-medium">Risk Level:</span>
                            <span className="ml-2 px-2 py-1 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: colors.fillColor + '40', color: colors.color }}>
                              {geoFence.riskLevel.toUpperCase()}
                            </span>
                          </p>
                        )}
                        <p className="text-sm">
                          <span className="font-medium">Radius:</span> {geoFence.geometry.radius}m
                        </p>
                      </div>
                    </div>
                  </Popup>
                </Circle>
              );
            } else if (geoFence.geometry.type === "Polygon") {
              const coords = geoFence.geometry.coordinates as number[][];
              const positions: [number, number][] = coords.map((coord) => [coord[1], coord[0]]);

              return (
                <Polygon
                  key={geoFence._id}
                  positions={positions}
                  pathOptions={colors}
                  weight={2}
                >
                  <Popup>
                    <div className="p-2 space-y-2 min-w-[180px]">
                      <div className="border-b border-border pb-2">
                        <p className="font-semibold text-foreground">
                          {geoFence.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {geoFence.type.replace('_', ' ').toUpperCase()}
                        </p>
                      </div>
                      <div className="space-y-1">
                        {geoFence.riskLevel && (
                          <p className="text-sm">
                            <span className="font-medium">Risk Level:</span>
                            <span className="ml-2 px-2 py-1 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: colors.fillColor + '40', color: colors.color }}>
                              {geoFence.riskLevel.toUpperCase()}
                            </span>
                          </p>
                        )}
                        <p className="text-sm">
                          <span className="font-medium">Area:</span> Polygon Zone
                        </p>
                      </div>
                    </div>
                  </Popup>
                </Polygon>
              );
            }

            return null;
          })}

          {/* Render tourists */}
          {tourists.map(
            (tourist) =>
              tourist.lastLocation && (
                <Marker
                  key={tourist._id}
                  position={[
                    tourist.lastLocation.lat,
                    tourist.lastLocation.lng,
                  ]}
                  icon={
                    tourist.health?.tier
                      ? tierIcon(tourist.health.tier)
                      : tourist.safetyStatus === "danger" ? alertIcon : defaultIcon
                  }
                >
                  <Popup className="custom-popup">
                    <div className="p-2 space-y-2 min-w-[200px]">
                      <div className="border-b border-border pb-2">
                        <p className="font-semibold text-foreground">
                          {tourist.kyc?.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          ID: {tourist.digitalId}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">Status:</span>
                          <span
                            className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getStatusBg(
                              tourist.safetyStatus
                            )} ${getStatusColor(tourist.safetyStatus)}`}
                          >
                            {tourist.safetyStatus.toUpperCase()}
                          </span>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Nationality:</span>{" "}
                          {tourist.kyc?.nationality}
                        </p>
                        {tourist.health && (
                          <p className="text-sm">
                            <span className="font-medium">Triage:</span>{" "}
                            {TIER_STYLE[tourist.health.tier].label} · MEWS {tourist.health.mews}
                            {tourist.health.vitals && ` · HR ${tourist.health.vitals.hr} · SpO₂ ${tourist.health.vitals.spo2}%`}
                          </p>
                        )}
                        <p className="text-sm">
                          <span className="font-medium">Location:</span>
                          <span className="text-muted-foreground ml-1">
                            {tourist.lastLocation.lat.toFixed(4)},{" "}
                            {tourist.lastLocation.lng.toFixed(4)}
                          </span>
                        </p>
                        {/* Google Maps Link for tourists in danger */}
                        {tourist.safetyStatus === "danger" && (
                          <div className="mt-2 pt-2 border-t">
                            <a
                              href={`https://www.google.com/maps?q=${tourist.lastLocation.lat},${tourist.lastLocation.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 text-xs underline font-medium"
                            >
                              🚨 View Emergency Location on Google Maps
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )
          )}
        </MapContainer>
      </div>
    </div>
  );
}
