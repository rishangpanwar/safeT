import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { startBackgroundLocationTracking } from '../locationTask';
import { API, getApiBase, setServerUrl, testServerUrl } from '../constants/config';

type ServerState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string };

export default function ActivationScreen() {
  const [server, setServer] = useState(getApiBase());
  const [serverState, setServerState] = useState<ServerState>({ kind: 'idle' });
  const [id, setId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setServer(getApiBase());
  }, []);

  const checkServer = async (): Promise<boolean> => {
    setServerState({ kind: 'testing' });
    const error = await testServerUrl(server);
    if (error) {
      setServerState({ kind: 'error', message: error });
      return false;
    }
    setServer(await setServerUrl(server));
    setServerState({ kind: 'ok' });
    return true;
  };

  const handleActivate = async () => {
    const digitalId = id.trim();
    if (!digitalId) {
      Alert.alert('Digital ID needed', 'Enter the Digital Tourist ID you received at registration.');
      return;
    }
    setIsLoading(true);
    try {
      if (!(await checkServer())) return;

      const res = await fetch(`${API.tourists}/${encodeURIComponent(digitalId)}`);
      if (res.status === 404) {
        Alert.alert('Digital ID not found', 'Check the ID and try again. It must match exactly what the registration desk gave you.');
        return;
      }
      if (!res.ok) {
        Alert.alert('Could not check your ID', `The server answered ${res.status}. Try again in a moment.`);
        return;
      }
      const tourist = await res.json();
      const name = tourist.kyc?.name || tourist.personalInfo?.fullName || 'Tourist';

      const tracking = await startBackgroundLocationTracking(digitalId);
      if (!tracking.started) {
        Alert.alert('Location needed', tracking.reason);
        return;
      }
      await AsyncStorage.setItem('digitalId', digitalId);

      const note =
        tracking.mode === 'always'
          ? 'Location, fall detection and health monitoring are now active.'
          : 'Fall detection and health monitoring are active. Location is shared while the app is open or running in the background; choose "Allow all the time" in Settings to keep it going if the app is closed.';
      Alert.alert(`Welcome, ${name}!`, note, [{ text: 'Continue', onPress: () => router.replace('/(tabs)/health') }]);
    } catch (error: any) {
      Alert.alert('Activation failed', error?.message ?? 'Unexpected error. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Ionicons name="shield-checkmark" size={56} color="#1e66d0" />
            <Text style={styles.title}>Activate Safety Monitoring</Text>
            <Text style={styles.subtitle}>Fall detection, AI health monitoring and live location for rescue teams.</Text>
          </View>

          <Text style={styles.label}>Server address</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={server}
              onChangeText={(v) => {
                setServer(v);
                setServerState({ kind: 'idle' });
              }}
              placeholder="192.168.1.20:4000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isLoading}
            />
            <Pressable
              style={({ pressed }) => [styles.testButton, pressed && styles.pressed]}
              onPress={checkServer}
              disabled={isLoading || serverState.kind === 'testing'}
              accessibilityLabel="Test connection to the server"
            >
              {serverState.kind === 'testing' ? <ActivityIndicator color="#1e66d0" /> : <Text style={styles.testText}>Test</Text>}
            </Pressable>
          </View>
          {serverState.kind === 'ok' && (
            <Text style={[styles.hint, styles.ok]}>
              <Ionicons name="checkmark-circle" size={14} /> Connected
            </Text>
          )}
          {serverState.kind === 'error' && <Text style={[styles.hint, styles.error]}>{serverState.message}</Text>}
          {serverState.kind === 'idle' && (
            <Text style={styles.hint}>The computer running the Smart Tourist server (ipconfig → IPv4 address), on the same Wi-Fi as this phone.</Text>
          )}

          <Text style={[styles.label, styles.spaced]}>Digital Tourist ID</Text>
          <TextInput
            style={styles.input}
            placeholder="TID-…"
            value={id}
            onChangeText={setId}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            returnKeyType="go"
            onSubmitEditing={handleActivate}
          />

          <Pressable style={({ pressed }) => [styles.activate, (pressed || isLoading) && styles.pressed]} onPress={handleActivate} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.activateText}>Activate</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f7fb' },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  hero: { alignItems: 'center', marginBottom: 28 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginTop: 12, color: '#1a1f2b' },
  subtitle: { fontSize: 14, textAlign: 'center', marginTop: 6, color: '#5b6475' },
  label: { fontSize: 14, fontWeight: '600', color: '#1a1f2b', marginBottom: 6 },
  spaced: { marginTop: 18 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#cfd5e1',
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    fontSize: 16,
    color: '#1a1f2b',
  },
  testButton: {
    minWidth: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e66d0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  testText: { color: '#1e66d0', fontWeight: '600', fontSize: 15 },
  hint: { fontSize: 12, color: '#5b6475', marginTop: 6 },
  ok: { color: '#0a7a0a' },
  error: { color: '#b42318' },
  activate: { backgroundColor: '#1e66d0', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  activateText: { color: 'white', fontSize: 17, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
