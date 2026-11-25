import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API, loadServerUrl } from "./constants/config";

const LOCATION_TASK_NAME = "background-location-task";

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error("Background location task error:", error);
    return;
  }
  const location = (data as { locations?: Location.LocationObject[] } | undefined)?.locations?.[0];
  if (!location) return;

  // This can run headless (app closed), before any screen has loaded the saved server address.
  await loadServerUrl();
  const digitalId = await AsyncStorage.getItem("digitalId");
  if (!digitalId) return;

  try {
    await fetch(`${API.tourists}/${digitalId}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude,
        speed: location.coords.speed,
        heading: location.coords.heading,
        timestamp: new Date(location.timestamp).toISOString(),
      }),
    });
  } catch (err) {
    console.error("Failed to send location update:", err);
  }
});

export type TrackingResult =
  | { started: true; mode: "always" | "while-using" }
  | { started: false; reason: string };

/**
 * Starts location sharing as an Android foreground service (persistent notification). That needs
 * only the "While using the app" permission; "Allow all the time" is requested as well because it
 * lets updates survive the app being swiped away, but declining it no longer blocks activation.
 */
export const startBackgroundLocationTracking = async (digitalId: string): Promise<TrackingResult> => {
  const { status: foreground } = await Location.requestForegroundPermissionsAsync();
  if (foreground !== "granted") {
    return { started: false, reason: "Location permission was denied. Rescue teams need your position: allow location for this app in Settings." };
  }

  let mode: "always" | "while-using" = "while-using";
  try {
    const { status: background } = await Location.requestBackgroundPermissionsAsync();
    if (background === "granted") mode = "always";
  } catch {
    // Some Android versions refuse the request outright; the foreground service still works.
  }

  await AsyncStorage.setItem("digitalId", digitalId);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: 60 * 1000,
      distanceInterval: 25,
      deferredUpdatesInterval: 60 * 1000,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Smart Tourist Safety",
        notificationBody: "Sharing your location with rescue services while you trek",
        notificationColor: "#1e66d0",
      },
    });
  } catch (err: any) {
    return { started: false, reason: `Could not start location sharing: ${err?.message ?? err}` };
  }
  return { started: true, mode };
};

export const stopBackgroundLocationTracking = async () => {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch {
    // not running
  }
};
