import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { healthMonitor } from '../services/healthMonitor';

interface QrData {
  token: string;
  qrDataUrl: string;
  validUntil: string;
  tokenId: string;
  sbt?: { network: string; txHash: string };
}

/**
 * Emergency Medical ID (report Phase 6). The QR holds an Ed25519-signed, AES-256-GCM
 * encrypted clinical profile; it is cached so paramedics can scan it with no signal.
 */
export default function MedicalIdCard({ digitalId, compact = false }: { digitalId: string | null; compact?: boolean }) {
  const [qr, setQr] = useState<QrData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (refresh: boolean) => {
    setLoading(true);
    try {
      const cached = await AsyncStorage.getItem('emergencyQr');
      if (cached && !refresh) setQr(JSON.parse(cached));
      if (digitalId && (refresh || !cached)) {
        const fresh = await healthMonitor.prefetchEmergencyQr(digitalId);
        if (fresh) setQr(fresh);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
  }, [digitalId]);

  if (loading && !qr) return <ActivityIndicator style={{ margin: 24 }} />;

  if (!qr) {
    return (
      <View style={styles.empty}>
        <Ionicons name="medkit-outline" size={28} color="#9ca3af" />
        <Text style={styles.emptyText}>
          No emergency health profile on file. Ask the registration desk to add your blood group, allergies and conditions.
        </Text>
        <TouchableOpacity onPress={() => load(true)}>
          <Text style={styles.link}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="medkit" size={18} color="#dc2626" />
        <Text style={styles.title}>Emergency Medical ID</Text>
      </View>
      <Image source={{ uri: qr.qrDataUrl }} style={compact ? styles.qrSmall : styles.qr} resizeMode="contain" />
      <Text style={styles.caption}>Paramedics: scan with the Responder portal to verify and decrypt.</Text>
      {!compact && (
        <View style={styles.meta}>
          <Text style={styles.metaText}>Permit token: {qr.tokenId.slice(0, 10)}…{qr.tokenId.slice(-6)}</Text>
          {qr.sbt && <Text style={styles.metaText}>Soulbound registry: {qr.sbt.network}</Text>}
          <Text style={styles.metaText}>Valid until {new Date(qr.validUntil).toLocaleDateString()}</Text>
          <Text style={styles.metaNote}>Readable only by authorised responders. Works offline.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  qr: { width: 260, height: 260 },
  qrSmall: { width: 200, height: 200 },
  caption: { fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 8 },
  meta: { marginTop: 10, alignSelf: 'stretch', gap: 2 },
  metaText: { fontSize: 12, color: '#374151' },
  metaNote: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  empty: { alignItems: 'center', padding: 20, gap: 8 },
  emptyText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  link: { color: '#2563eb', fontWeight: '600' },
});
