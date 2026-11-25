import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useHealthMonitor } from '../../hooks/use-health-monitor';
import { healthMonitor } from '../../services/healthMonitor';

export default function AlertsScreen() {
  const [isSending, setIsSending] = useState(false);
  const { digitalId, online } = useHealthMonitor();

  const sendDistressSignal = async () => {
    if (!digitalId) {
      Alert.alert('Error', 'Could not find your ID. Please restart the app.');
      return;
    }
    setIsSending(true);
    try {
      // Same pipeline as automatic detection: location + vital trends + dispatch plan,
      // queued on the device if there is no signal.
      await healthMonitor.manualSos();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.panicButton}
        onPress={sendDistressSignal}
        disabled={isSending}
      >
        {isSending ? (
          <ActivityIndicator size="large" color="white" />
        ) : (
          <Text style={styles.panicButtonText}>SEND DISTRESS SIGNAL</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.infoText}>Press in case of a real emergency.</Text>
      <Text style={styles.subText}>
        You don't have to press anything if you collapse: falls and critical vital signs are detected automatically.
        {online ? '' : '\n\nNo signal right now: your alert will be stored and sent as soon as a network is available.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#f0f0f0' },
  panicButton: {
    backgroundColor: '#dc2626', // A strong red color
    width: 220,
    height: 220,
    borderRadius: 110,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 10,
    borderWidth: 5,
    borderColor: '#fecaca'
  },
  panicButtonText: { color: 'white', fontSize: 28, fontWeight: 'bold', textAlign: 'center' },
  infoText: { marginTop: 25, fontSize: 16, color: 'gray' },
  subText: { marginTop: 12, fontSize: 13, color: '#6b7280', textAlign: 'center', maxWidth: 320 },
});
