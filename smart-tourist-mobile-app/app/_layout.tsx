import React from 'react';
import { Slot } from 'expo-router';
import { loadServerUrl } from '../constants/config';
// Registers the background location task at startup, as expo-task-manager requires
// (Android can start the JS runtime headless just to deliver a location update).
import '../locationTask';

// Start reading the saved server address now; screens await the same cached promise.
loadServerUrl();

/**
 * Root layout. It must render a navigator (Slot) on its very first render, so it holds no
 * loading state or redirects. app/index.tsx chooses between activation and the tabs.
 */
export default function RootLayout() {
  return <Slot />;
}
