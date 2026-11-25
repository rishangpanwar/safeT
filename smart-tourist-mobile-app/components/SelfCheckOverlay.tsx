import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useHealthMonitor } from '../hooks/use-health-monitor';
import { healthMonitor } from '../services/healthMonitor';
import MedicalIdCard from './MedicalIdCard';

/**
 * Phase 3a — "ARE YOU OK?" 30 s self-check, and Phase 4 — escalation status.
 * Mounted once in the tab layout so it appears over every screen.
 */
export default function SelfCheckOverlay() {
  const { selfCheck, incident, digitalId } = useHealthMonitor();
  const [now, setNow] = useState(Date.now());
  const [showId, setShowId] = useState(false);

  useEffect(() => {
    if (!selfCheck) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [selfCheck]);

  if (selfCheck) {
    const remaining = Math.max(0, Math.ceil((selfCheck.deadline - now) / 1000));
    return (
      <Modal visible animationType="fade" statusBarTranslucent>
        <View style={styles.alarm}>
          <Ionicons name="warning" size={64} color="#fff" />
          <Text style={styles.alarmTitle}>
            CRITICAL {selfCheck.trigger === 'fall' ? 'FALL' : 'HEALTH'} ANOMALY DETECTED
          </Text>
          <Text style={styles.alarmQuestion}>ARE YOU OK?</Text>
          <View style={styles.countdown}>
            <Text style={styles.countdownText}>{remaining}</Text>
            <Text style={styles.countdownLabel}>seconds until emergency services are alerted</Text>
          </View>
          <View style={styles.reasons}>
            {selfCheck.reasons.slice(0, 4).map((r) => (
              <Text key={r} style={styles.reason}>• {r}</Text>
            ))}
          </View>
          <TouchableOpacity style={styles.okButton} onPress={() => healthMonitor.confirmOk()} accessibilityLabel="I am OK, cancel the alert">
            <Text style={styles.okText}>I'M OK — CANCEL</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  if (incident) {
    const queued = incident.status === 'queued_offline';
    return (
      <Modal visible animationType="slide" transparent onRequestClose={() => healthMonitor.dismissIncident()}>
        <View style={styles.backdrop}>
          <ScrollView contentContainerStyle={styles.sheet}>
            <View style={[styles.banner, { backgroundColor: queued ? '#7c2d12' : '#b91c1c' }]}>
              <Ionicons name={queued ? 'cloud-offline' : 'medkit'} size={28} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>
                  {incident.status === 'sending' ? 'Sending emergency alert…' : queued ? 'OFFLINE EMERGENCY MODE' : 'Help is on the way'}
                </Text>
                <Text style={styles.bannerText}>
                  {queued
                    ? 'No signal. Your alert, location and vital signs are stored on this phone and will be transmitted the moment a network is found.'
                    : incident.status === 'sent' && incident.unit
                      ? `${incident.mode === 'air' ? 'Air ambulance' : 'Rescue team'} from ${incident.unit}${incident.etaMinutes != null ? ` · ETA ${incident.etaMinutes} min` : ''}`
                      : 'The command centre has your location and vital signs.'}
                </Text>
                {incident.destination && <Text style={styles.bannerText}>Destination: {incident.destination}</Text>}
              </View>
            </View>
            <Text style={styles.tip}>Stay where you are. Keep this screen visible for first responders.</Text>
            {showId ? (
              <MedicalIdCard digitalId={digitalId} compact />
            ) : (
              <TouchableOpacity style={styles.secondary} onPress={() => setShowId(true)}>
                <Ionicons name="qr-code" size={18} color="#111827" />
                <Text style={styles.secondaryText}>Show Medical ID for paramedics</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => healthMonitor.dismissIncident()} style={styles.dismiss}>
              <Text style={styles.dismissText}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  alarm: { flex: 1, backgroundColor: '#b91c1c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alarmTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  alarmQuestion: { color: '#fff', fontSize: 40, fontWeight: '900', marginVertical: 12 },
  countdown: { alignItems: 'center', marginBottom: 16 },
  countdownText: { color: '#fff', fontSize: 72, fontWeight: '900' },
  countdownLabel: { color: '#fecaca', fontSize: 14, textAlign: 'center' },
  reasons: { alignSelf: 'stretch', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 12, marginBottom: 24 },
  reason: { color: '#fff', fontSize: 13, marginVertical: 2 },
  okButton: { backgroundColor: '#fff', paddingVertical: 22, borderRadius: 16, alignSelf: 'stretch', alignItems: 'center' },
  okText: { color: '#b91c1c', fontSize: 22, fontWeight: '900' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#f9fafb', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12 },
  banner: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 14, alignItems: 'flex-start' },
  bannerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  bannerText: { color: '#fee2e2', fontSize: 14, marginTop: 4 },
  tip: { fontSize: 13, color: '#374151', textAlign: 'center' },
  secondary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db', padding: 14, borderRadius: 12 },
  secondaryText: { fontWeight: '700', color: '#111827' },
  dismiss: { alignItems: 'center', padding: 12 },
  dismissText: { color: '#6b7280', fontWeight: '600' },
});
