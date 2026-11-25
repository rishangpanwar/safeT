"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  /** Chrome/Edge/Android offered an install prompt we can trigger. */
  canInstall: boolean;
  /** Running as an installed app (home-screen icon), not in a browser tab. */
  isStandalone: boolean;
  /** iOS Safari never fires beforeinstallprompt — show "Share → Add to Home Screen" instead. */
  isIos: boolean;
  /** Service workers and install need HTTPS (or localhost). */
  isSecure: boolean;
  install: () => Promise<void>;
}

const PwaContext = createContext<PwaState>({ canInstall: false, isStandalone: false, isIos: false, isSecure: true, install: async () => undefined });

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setStandalone] = useState(false);
  const [isIos, setIos] = useState(false);
  const [isSecure, setSecure] = useState(true);

  useEffect(() => {
    setSecure(window.isSecureContext);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    const mq = window.matchMedia("(display-mode: standalone)");
    const sync = () => setStandalone(mq.matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    sync();
    mq.addEventListener?.("change", sync);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own Install button
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator && window.isSecureContext) {
      const dev = process.env.NODE_ENV !== "production" ? "?dev=1" : "";
      navigator.serviceWorker.register(`/sw.js${dev}`, { scope: "/" }).catch((err) => console.warn("Service worker registration failed:", err));
      if (!dev) {
        // Chromium serves repeat JS/CSS from its memory cache, in front of the service worker, so the
        // worker never sees them. Hand it the build assets this page loaded so it opens offline.
        navigator.serviceWorker.ready
          .then(async () => {
            const urls = performance
              .getEntriesByType("resource")
              .map((e) => e.name)
              .filter((u) => new URL(u).origin === location.origin && new URL(u).pathname.startsWith("/_next/static/"));
            const cache = await caches.open("safet-v2-assets"); // must match VERSION in public/sw.js
            await Promise.all(urls.map(async (u) => (await cache.match(u)) || cache.add(u).catch(() => undefined)));
          })
          .catch(() => undefined);
      }
    }

    return () => {
      mq.removeEventListener?.("change", sync);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    setPrompt(null);
  }, [prompt]);

  return (
    <PwaContext.Provider value={{ canInstall: !!prompt, isStandalone, isIos, isSecure, install }}>
      {children}
    </PwaContext.Provider>
  );
}

export const usePwa = () => useContext(PwaContext);
