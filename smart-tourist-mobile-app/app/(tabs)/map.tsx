import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { API } from "../../constants/config";
import { healthMonitor } from "../../services/healthMonitor";
import { stopBackgroundLocationTracking } from "../../locationTask";

interface GeoFence {
  _id: string;
  name: string;
  type: "safe_zone" | "restricted_zone" | "alert_zone" | "emergency_zone" | "danger_zone" | "restricted_area" | "tourist_zone";
  riskLevel?: "low" | "medium" | "high" | "critical";
  geometry: {
    type: "Polygon" | "Circle";
    coordinates: number[][] | number[]; // Polygon: [[lng, lat], …]; Circle: [lng, lat]
    radius?: number;
  };
  isActive: boolean;
}

const RISK_COLORS = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
  critical: "#9333ea",
  none: "#9ca3af",
} as const;

function colorFor(z: GeoFence): string {
  if (z.riskLevel) return RISK_COLORS[z.riskLevel];
  switch (z.type) {
    case "safe_zone":
    case "tourist_zone":
      return RISK_COLORS.low;
    case "alert_zone":
      return RISK_COLORS.medium;
    case "restricted_zone":
    case "restricted_area":
    case "danger_zone":
      return RISK_COLORS.high;
    case "emergency_zone":
      return RISK_COLORS.critical;
    default:
      return RISK_COLORS.none;
  }
}

/**
 * OpenStreetMap through Leaflet in a WebView. Google Maps on Android needs a billed API key in a
 * standalone build (react-native-maps crashes without one); OSM needs no key. Map tiles need an
 * internet connection; safety monitoring itself works offline.
 */
const MAP_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="">
<style>html,body,#map{height:100%;margin:0;background:#e9eef5;font-family:sans-serif}
#offline{display:none;height:100%;align-items:center;justify-content:center;text-align:center;padding:24px;color:#475467;font-size:15px}</style>
</head><body><div id="map"></div><div id="offline">The map needs an internet connection.<br>Fall detection, health monitoring and SOS keep working offline.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin="" onerror="document.getElementById('map').style.display='none';document.getElementById('offline').style.display='flex';"></script>
<script>
var map, layer, me, centred = false;
function init(){
  if (!window.L) return;
  map = L.map('map', { zoomControl: false }).setView([20.6, 78.9], 5);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
window.update = function(p){
  if (!map) return;
  layer.clearLayers();
  (p.zones || []).forEach(function(z){
    var style = { color: z.color, weight: 2, fillColor: z.color, fillOpacity: 0.2 };
    var shape = z.circle ? L.circle(z.circle, Object.assign({ radius: z.radius }, style)) : L.polygon(z.polygon, style);
    shape.bindPopup('<b>' + z.name + '</b>' + (z.risk ? '<br>Risk: ' + z.risk : '')).addTo(layer);
  });
  if (p.me) {
    if (!me) me = L.circleMarker(p.me, { radius: 9, color: '#fff', weight: 3, fillColor: '#1e66d0', fillOpacity: 1 }).addTo(map);
    me.setLatLng(p.me).bindPopup(p.label || 'You are here');
    if (!centred) { map.setView(p.me, 13); centred = true; }
  }
};
window.recentre = function(){ if (me) map.setView(me.getLatLng(), Math.max(map.getZoom(), 13)); };
init();
</script></body></html>`;

export default function MapScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [geoFences, setGeoFences] = useState<GeoFence[]>([]);
  const [digitalId, setDigitalId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const webview = useRef<WebView>(null);
  const router = useRouter();

  const fetchGeoFences = useCallback(async () => {
    try {
      const response = await fetch(`${API.dashboard}/geofences`);
      if (response.ok) setGeoFences(await response.json());
    } catch (error) {
      console.error("Failed to fetch geo-fences:", error);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setDigitalId(await AsyncStorage.getItem("digitalId"));
      fetchGeoFences();
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermissionDenied(true);
        return;
      }
      setLocation(await Location.getCurrentPositionAsync({}));
    })();
  }, [fetchGeoFences]);

  const payload = useMemo(
    () => ({
      me: location ? [location.coords.latitude, location.coords.longitude] : null,
      label: digitalId ? `You · ${digitalId}` : "You are here",
      zones: geoFences
        .filter((z) => z.isActive !== false)
        .map((z) => {
          const color = colorFor(z);
          if (z.geometry.type === "Circle") {
            const [lng, lat] = z.geometry.coordinates as number[];
            return { name: z.name, risk: z.riskLevel, color, circle: [lat, lng], radius: z.geometry.radius || 1000 };
          }
          return { name: z.name, risk: z.riskLevel, color, polygon: (z.geometry.coordinates as number[][]).map(([lng, lat]) => [lat, lng]) };
        }),
    }),
    [location, geoFences, digitalId]
  );

  useEffect(() => {
    if (mapReady) webview.current?.injectJavaScript(`window.update(${JSON.stringify(payload)}); true;`);
  }, [mapReady, payload]);

  const refreshMapData = async () => {
    setIsRefreshing(true);
    try {
      await fetchGeoFences();
      setLocation(await Location.getCurrentPositionAsync({}));
      webview.current?.injectJavaScript("window.recentre && window.recentre(); true;");
    } catch {
      Alert.alert("Refresh failed", "Could not refresh the map. Check your connection.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const resetApp = () => {
    Alert.alert("Reset app", "This clears your Digital ID and stops monitoring on this phone. Continue?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          try {
            await stopBackgroundLocationTracking();
            await AsyncStorage.removeItem("digitalId");
            await healthMonitor.reset();
            router.replace("/activation");
          } catch {
            Alert.alert("Error", "Failed to reset the app. Please try again.");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Map</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={refreshMapData} disabled={isRefreshing} accessibilityLabel="Refresh map">
          {isRefreshing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="locate" size={20} color="#fff" />}
        </TouchableOpacity>
      </View>

      <WebView
        ref={webview}
        style={styles.map}
        originWhitelist={["*"]}
        source={{ html: MAP_HTML, baseUrl: "https://localhost/" }}
        onLoadEnd={() => setMapReady(true)}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />

      {permissionDenied && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Location permission is off, so your position is not shown. Zones are still displayed.</Text>
        </View>
      )}

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Risk zones</Text>
        {(["low", "medium", "high", "critical"] as const).map((r) => (
          <View key={r} style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: RISK_COLORS[r] }]} />
            <Text style={styles.legendText}>{r[0].toUpperCase() + r.slice(1)}</Text>
          </View>
        ))}
        <TouchableOpacity style={styles.resetButton} onPress={resetApp}>
          <Text style={styles.resetButtonText}>Reset app</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#e9eef5" },
  header: {
    height: 60,
    backgroundColor: "#4A90E2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    elevation: 3,
  },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: "#fff" },
  refreshButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  map: { flex: 1 },
  banner: { position: "absolute", left: 10, right: 160, bottom: 16, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 8, padding: 10, elevation: 4 },
  bannerText: { fontSize: 12, color: "#344054" },
  legend: {
    position: "absolute",
    top: 70,
    right: 10,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: 12,
    borderRadius: 10,
    elevation: 5,
    maxWidth: 140,
  },
  legendTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 5 },
  legendItem: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  legendColor: { width: 12, height: 12, borderRadius: 6, marginRight: 6, opacity: 0.8 },
  legendText: { fontSize: 12 },
  resetButton: { backgroundColor: "#ff4444", padding: 8, borderRadius: 5, marginTop: 10, alignItems: "center" },
  resetButtonText: { color: "white", fontSize: 12, fontWeight: "bold" },
});
