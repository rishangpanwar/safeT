import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Backend location.
 *
 * An installed app (.apk) cannot rely on a build-time IP: the laptop running smart-tourist-server
 * gets a new address on every Wi-Fi network. So the address is stored on the phone and can be
 * changed on the activation screen or in Profile → Server. EXPO_PUBLIC_API_URL (smart-tourist-
 * mobile-app/.env, e.g. http://192.168.1.20:4000) only sets the first default.
 *
 * Always read URLs through API.* or getApiBase() at request time, never copy them into a
 * module-level constant, so a changed address takes effect immediately.
 */
const SERVER_KEY = 'serverUrl';
export const DEFAULT_API_BASE = normalizeServerUrl(process.env.EXPO_PUBLIC_API_URL || 'http://192.168.1.20:4000');

let apiBase = DEFAULT_API_BASE;
let loaded: Promise<string> | null = null;

/** "192.168.1.20" → "http://192.168.1.20:4000"; trims spaces and trailing slashes. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  // A bare host means the API server's default port.
  if (/^https?:\/\/[^/:]+$/i.test(url) && !/^https:/i.test(url)) url = `${url}:4000`;
  return url;
}

export function getApiBase(): string {
  return apiBase;
}

/** Reads the saved address once per JS runtime (the app, or a headless background task). */
export function loadServerUrl(): Promise<string> {
  loaded ??= AsyncStorage.getItem(SERVER_KEY)
    .then((saved) => {
      if (saved) apiBase = saved;
      return apiBase;
    })
    .catch(() => apiBase);
  return loaded;
}

export async function setServerUrl(input: string): Promise<string> {
  apiBase = normalizeServerUrl(input);
  loaded = Promise.resolve(apiBase);
  await AsyncStorage.setItem(SERVER_KEY, apiBase);
  return apiBase;
}

/** GET /health on a candidate address. Resolves with an error message, or null when reachable. */
export async function testServerUrl(input: string, timeoutMs = 6000): Promise<string | null> {
  const url = normalizeServerUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    return res.ok ? null : `Server answered ${res.status}`;
  } catch {
    return `No answer from ${url}. Is the server running, and is the phone on the same Wi-Fi?`;
  } finally {
    clearTimeout(timer);
  }
}

export const API = {
  get tourists() { return `${apiBase}/api/tourists`; },
  get dashboard() { return `${apiBase}/api/dashboard`; },
  get notifications() { return `${apiBase}/api/notifications`; },
  get health() { return `${apiBase}/api/health`; },
  get base() { return `${apiBase}/api`; },
};
