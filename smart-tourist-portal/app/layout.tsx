import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "./components/Header";
import { AuthProvider } from "./contexts/AuthContext";
import { PwaProvider } from "./contexts/PwaContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Smart Tourist Health & Safety Command",
  description: "AI-powered tourist health monitoring, clinical triage and emergency response",
  applicationName: "SafeT Command",
  appleWebApp: { capable: true, title: "SafeT Command", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the header/tab bar extend under the notch; safe-area insets pad them
  themeColor: "#1d4ed8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PwaProvider>
          <AuthProvider>
            <Header />
            {/* Bottom padding clears the phone tab bar (rendered by Header when logged in). */}
            <main className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>
          </AuthProvider>
        </PwaProvider>
      </body>
    </html>
  );
}
