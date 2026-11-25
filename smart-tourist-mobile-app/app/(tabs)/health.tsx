import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useHealthMonitor } from '../../hooks/use-health-monitor';
import { healthMonitor } from '../../services/healthMonitor';
import { SCENARIOS } from '../../edge/wearable';
import MedicalIdCard from '../../components/MedicalIdCard';

const TIER = {
  green: { bg: '#15803d', label: 'GREEN · Normal', icon: 'heart' as const },
  yellow: { bg: '#b45309', label: 'YELLOW · Elevated watch', icon: 'alert-circle' as const },
  red: { bg: '#b91c1c', label: 'RED · Critical', icon: 'warning' as const },
};

const FALL_STAGE: Record<string, string> = {
  idle: 'Armed — monitoring motion',
  free_fall: 'Stage 1 · free fall detected',
  impact_window: 'Stage 2 · checking impact',
  rebound: 'Stage 3 · rebound',
  immobility_check: 'Stage 4 · checking immobility (10 s)',
};

function Vital({ icon, label, value, unit, alert }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; unit: string; alert?: boolean }) {
  return (
    <View style={[styles.vital, alert && styles.vitalAlert]}>
      <View style={styles.vitalHead}>
        <Ionicons name={icon} size={14} color={alert ? '#b91c1c' : '#6b7280'} />
        <Text style={styles.vitalLabel}>{label}</Text>
      </View>
      <Text style={[styles.vitalValue, alert && { color: '#b91c1c' }]}>
        {value}
        <Text style={styles.vitalUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

export default function HealthScreen() {
  const s = useHealthMonitor();
  const [showId, setShowId] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const a = s.assessment;
  const tier = TIER[a?.tier ?? 'green'];
  const v = s.latest;
  const c = a?.mews.components;

  const onRefresh = async () => {
    setRefreshing(true);
    await healthMonitor.sync();
    setRefreshing(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 14 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {/* Triage status */}
      <View style={[styles.status, { backgroundColor: a ? tier.bg : '#4b5563' }]}>
        <View style={styles.statusRow}>
          <Ionicons name={a ? tier.icon : 'pulse'} size={26} color="#fff" />
          <Text style={styles.statusTitle}>{a ? tier.label : s.running ? 'Calibrating (10 s)…' : 'Monitoring not started'}</Text>
        </View>
        {a && (
          <View style={styles.scoreRow}>
            <View style={styles.scorePill}>
              <Text style={styles.scoreLabel}>MEWS</Text>
              <Text style={styles.scoreValue}>{a.mews.total}</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scoreLabel}>AI anomaly</Text>
              <Text style={styles.scoreValue}>{a.anomalyScore != null ? a.anomalyScore.toFixed(2) : '—'}</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scoreLabel}>Red at</Text>
              <Text style={styles.scoreValue}>≥{a.mews.thresholds.red}</Text>
            </View>
          </View>
        )}
        {s.advisory && <Text style={styles.advisory}>{s.advisory}</Text>}
        {a?.reasons.map((r) => (
          <Text key={r} style={styles.reason}>• {r}</Text>
        ))}
      </View>

      {s.zones.length > 0 && (
        <View style={styles.zoneBanner}>
          <Ionicons name="trail-sign" size={18} color="#92400e" />
          <Text style={styles.zoneText}>Geo-medical risk zone: {s.zones.join(', ')}. Alert thresholds are lowered here.</Text>
        </View>
      )}

      {/* Vitals */}
      <View style={styles.grid}>
        <Vital icon="heart" label="Heart rate" value={v?.hr != null ? String(v.hr) : '—'} unit="bpm" alert={!!c?.hr} />
        <Vital icon="water" label="SpO₂" value={v?.spo2 != null ? v.spo2.toFixed(0) : '—'} unit="%" alert={!!c?.spo2} />
        <Vital icon="thermometer" label="Temperature" value={v?.skinTemp != null ? v.skinTemp.toFixed(1) : '—'} unit="°C" alert={!!c?.skinTemp} />
        <Vital icon="pulse" label="HRV (RMSSD)" value={v?.hrvRmssd != null ? String(v.hrvRmssd) : '—'} unit="ms" />
        <Vital icon="walk" label={`Motion (${s.motionSource})`} value={v?.mobility != null ? v.mobility.toFixed(3) : '—'} unit="g" />
        <Vital icon="trending-up" label="Altitude" value={v?.altitude != null ? String(v.altitude) : '—'} unit="m" />
      </View>

      {/* Connectivity / store-and-forward */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Telemetry link</Text>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: s.online ? '#16a34a' : '#dc2626' }]} />
          <Text style={styles.rowText}>{s.online ? 'Online' : 'Offline — buffering on device'}</Text>
        </View>
        <Text style={styles.small}>Buffered samples: {s.pendingSamples} · Queued alerts: {s.pendingOutbox}</Text>
        <Text style={styles.small}>Buffer: {s.persistentBuffer ? 'SQLite (24 h circular)' : 'memory'} · Last sync: {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString() : '—'}</Text>
        <Text style={styles.small}>Edge AI model: {s.modelReady ? `Isolation Forest (trained ${s.modelTrainedAt ? new Date(s.modelTrainedAt).toLocaleDateString() : ''})` : 'not downloaded — MEWS only'}</Text>
      </View>

      {/* Fall detection */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Fall detection</Text>
        <Text style={styles.rowText}>{s.motionSource === 'unavailable' ? 'No accelerometer on this device' : FALL_STAGE[s.fallStage]}</Text>
        {s.lastFall && (
          <Text style={styles.small}>
            Last fall: {s.lastFall.peakSvm} g impact, {s.lastFall.tiltDeg}° tilt, {new Date(s.lastFall.confirmedAt).toLocaleTimeString()}
          </Text>
        )}
        <TouchableOpacity style={styles.outline} onPress={() => healthMonitor.simulateFall()}>
          <Ionicons name="body" size={16} color="#1f2937" />
          <Text style={styles.outlineText}>Test fall detection</Text>
        </TouchableOpacity>
      </View>

      {/* Wearable simulator */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Wearable band (simulated)</Text>
        <Text style={styles.small}>No wearable band is paired, so vitals come from a simulated band. Pick a scenario to demonstrate detection.</Text>
        <View style={styles.chips}>
          {SCENARIOS.map((sc) => (
            <TouchableOpacity key={sc.key} style={[styles.chip, s.scenario === sc.key && styles.chipActive]} onPress={() => healthMonitor.setScenario(sc.key)}>
              <Text style={[styles.chipText, s.scenario === sc.key && styles.chipTextActive]}>{sc.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.small}>{SCENARIOS.find((x) => x.key === s.scenario)?.detail}</Text>
      </View>

      <TouchableOpacity style={styles.medicalButton} onPress={() => setShowId(true)}>
        <Ionicons name="qr-code" size={20} color="#fff" />
        <Text style={styles.medicalText}>Emergency Medical ID</Text>
      </TouchableOpacity>

      <Modal visible={showId} animationType="slide" transparent onRequestClose={() => setShowId(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <MedicalIdCard digitalId={s.digitalId} />
            <TouchableOpacity onPress={() => setShowId(false)} style={{ padding: 14, alignItems: 'center' }}>
              <Text style={{ color: '#6b7280', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  status: { borderRadius: 16, padding: 16, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusTitle: { color: '#fff', fontSize: 20, fontWeight: '800', flexShrink: 1 },
  scoreRow: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  scorePill: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, flex: 1 },
  scoreLabel: { color: '#f3f4f6', fontSize: 11 },
  scoreValue: { color: '#fff', fontSize: 20, fontWeight: '800' },
  advisory: { color: '#fff', fontWeight: '700', marginTop: 4 },
  reason: { color: '#f9fafb', fontSize: 13 },
  zoneBanner: { flexDirection: 'row', gap: 8, backgroundColor: '#fef3c7', borderRadius: 12, padding: 12, alignItems: 'center' },
  zoneText: { flex: 1, color: '#92400e', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  vital: { backgroundColor: '#fff', borderRadius: 12, padding: 12, width: '48%', flexGrow: 1 },
  vitalAlert: { borderWidth: 2, borderColor: '#fca5a5' },
  vitalHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vitalLabel: { color: '#6b7280', fontSize: 12 },
  vitalValue: { fontSize: 26, fontWeight: '800', color: '#111827', marginTop: 4 },
  vitalUnit: { fontSize: 13, fontWeight: '500', color: '#6b7280' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 14, color: '#1f2937' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  small: { fontSize: 12, color: '#6b7280' },
  outline: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 6 },
  outlineText: { fontWeight: '600', color: '#1f2937' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  medicalButton: { flexDirection: 'row', gap: 8, backgroundColor: '#dc2626', borderRadius: 14, padding: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  medicalText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
});
