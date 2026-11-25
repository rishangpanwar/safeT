import type { NextConfig } from "next";

/**
 * The browser only ever talks to this Next.js origin. /api/* and /socket.io/* are proxied to the
 * API server, so the portal works unchanged from a phone on the LAN, through an HTTPS tunnel,
 * or as an installed PWA — no "localhost" baked into the client bundle, no CORS, cookies stay
 * first-party.
 */
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // The floating dev-mode badge sits on top of the phone tab bar.
  devIndicators: false,
  // Socket.IO's endpoint is "/socket.io/" — the trailing-slash redirect would break the handshake.
  skipTrailingSlashRedirect: true,
  // Let phones on the LAN and HTTPS tunnels load dev-mode assets (next dev only).
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app", "*.loca.lt", "192.168.*.*", "10.*.*.*", "172.*.*.*"],
  async rewrites() {
    return {
      // afterFiles: the portal's own route handlers (e.g. /api/register) take precedence.
      afterFiles: [
        { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
        { source: "/socket.io/", destination: `${BACKEND_URL}/socket.io/` },
        { source: "/socket.io/:path*", destination: `${BACKEND_URL}/socket.io/:path*` },
      ],
      beforeFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or updates would not reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
