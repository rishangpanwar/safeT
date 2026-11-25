"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE } from "@/lib/health";

// Payload shapes are documented in smart-tourist-server/src/services/healthMonitoringService.ts
type Payload = Record<string, unknown> & { digitalId?: string };
type Handlers = {
  onHealthUpdate?: (data: Payload) => void;
  onIncident?: (data: Payload) => void;
  onSelfCheck?: (data: Payload) => void;
  onLocation?: (data: Payload) => void;
};

let shared: { socket: Socket; refs: number } | null = null;

/** One Socket.IO connection per tab, shared by every component that uses the hook. */
function acquireSocket(): Socket {
  if (!shared) {
    // Same origin as the page; Next.js proxies /socket.io to the API server. Polling first: it
    // always works through the dev proxy and tunnels, then Socket.IO upgrades to WebSocket.
    const opts = { transports: ["polling", "websocket"] };
    const socket: Socket = API_BASE ? io(API_BASE, opts) : io(opts);
    socket.on("connect", () => socket.emit("authenticate", { userType: "authority" }));
    shared = { socket, refs: 0 };
  }
  shared.refs++;
  return shared.socket;
}

function releaseSocket() {
  if (shared && --shared.refs <= 0) {
    shared.socket.disconnect();
    shared = null;
  }
}

/** Live command-centre feed over Socket.IO (joins the "authorities" room). */
export function useHealthSocket(handlers: Handlers) {
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const socket = acquireSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const events: [string, (d: Payload) => void][] = [
      ["health_update", (d) => ref.current.onHealthUpdate?.(d)],
      ["health_incident", (d) => ref.current.onIncident?.(d)],
      ["health_selfcheck", (d) => ref.current.onSelfCheck?.(d)],
      ["tourist_location_update", (d) => ref.current.onLocation?.(d)],
    ];
    setConnected(socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    for (const [e, fn] of events) socket.on(e, fn);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      for (const [e, fn] of events) socket.off(e, fn);
      releaseSocket();
    };
  }, []);

  return connected;
}

/** Audible dispatch alarm (Phase 5) — synthesised, no asset needed. */
export function playAlarm() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.32);
    });
  } catch {
    // autoplay blocked until the operator interacts with the page
  }
}
