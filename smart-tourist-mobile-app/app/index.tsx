import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadServerUrl } from '../constants/config';

/**
 * Start screen for "/" (the URL the app opens at).
 *
 * Decides where the tourist goes: the activation screen on first launch, the Health tab once a
 * Digital ID is saved. The decision lives here, not in _layout.tsx, because expo-router requires
 * the root layout to render a navigator on its first render; redirecting from there drops the
 * navigation and leaves the app on an "Unmatched Route" page.
 */
export default function Index() {
  const [target, setTarget] = useState<'/activation' | '/(tabs)/health' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadServerUrl(); // the saved server address, before any screen makes a request
      let digitalId: string | null = null;
      try {
        digitalId = await AsyncStorage.getItem('digitalId');
      } catch {
        // Unreadable storage behaves like a first launch.
      }
      if (!cancelled) setTarget(digitalId ? '/(tabs)/health' : '/activation');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return <Redirect href={target} />;
}
