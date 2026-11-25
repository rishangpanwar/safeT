import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { healthMonitor } from '../../services/healthMonitor';
import { loadServerUrl } from '../../constants/config';
import SelfCheckOverlay from '../../components/SelfCheckOverlay';

export default function TabLayout() {
  // Start the on-device health guardian as soon as an activated tourist reaches the tabs.
  useEffect(() => {
    // Wait for the saved server address, so uploads go to the right server even if the
    // tabs were opened directly (a deep link) without passing the start screen.
    loadServerUrl()
      .then(() => AsyncStorage.getItem('digitalId'))
      .then((id) => {
        if (id) healthMonitor.start(id).catch((e) => console.warn('Health monitor failed to start', e));
      });
  }, []);

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: 'tomato',
          tabBarInactiveTintColor: 'gray',
        }}>
        <Tabs.Screen
          name="health"
          options={{
            title: 'Health',
            tabBarIcon: ({ color }) => <Ionicons name="pulse-outline" size={28} color={color} />,
            headerTitle: 'Health Guardian',
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color }) => <Ionicons name="map-outline" size={28} color={color} />,
            headerTitle: 'Live Map View',
          }}
        />
        <Tabs.Screen
          name="alerts"
          options={{
            title: 'SOS',
            tabBarIcon: ({ color }) => <Ionicons name="shield-outline" size={28} color={color} />,
            headerTitle: 'Emergency SOS',
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            title: 'Notifications',
            tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={28} color={color} />,
            headerTitle: 'Official Advisories',
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={28} color={color} />,
            headerTitle: 'My Profile',
          }}
        />
      </Tabs>
      <SelfCheckOverlay />
    </>
  );
}
