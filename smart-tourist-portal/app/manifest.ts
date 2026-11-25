import type { MetadataRoute } from "next";

/** Web App Manifest — makes the portal installable on phones (Add to Home screen / Install app). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SafeT Health Command — Tourist Health & Safety",
    short_name: "SafeT Command",
    description: "AI-powered tourist health monitoring, clinical triage and emergency response",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    categories: ["medical", "health", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Clinical Triage", short_name: "Triage", url: "/triage", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Responder — scan Emergency QR", short_name: "Responder", url: "/responder", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Alerts", short_name: "Alerts", url: "/alerts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
