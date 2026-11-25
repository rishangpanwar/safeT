"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, KeyRound, Link2, Pill, ShieldCheck, Stethoscope, Syringe, WifiOff, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useAuth } from "../contexts/AuthContext";
import { api } from "@/lib/health";

interface Profile {
  fullName: string;
  age?: number;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  medications: string[];
  emergencyContacts: { name: string; phone: string; relationship?: string }[];
  notes?: string;
}

interface Result {
  mode: "online" | "offline";
  digitalId: string;
  tokenId: string;
  profile: Profile;
  expiresAt: string;
  expired: boolean;
  signatureValid: boolean;
  hashConsistent?: boolean;
  registry?: { verified: boolean; source: string };
  liveStatus?: { safetyStatus?: string; health?: { tier: string; mews: number; vitals: { hr: number; spo2: number; skinTemp: number } } | null } | null;
}

const LS_PUB = "responder.publicKey";
const LS_KEY = "responder.aesKey";

const b64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Offline path: Ed25519 signature check + AES-256-GCM decryption, entirely in the browser. */
async function verifyOffline(token: string, publicKeyRaw: string, aesKeyHex: string): Promise<Result> {
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "STHS1") throw new Error("Not a Smart Tourist emergency token");
  const [prefix, head, body, sig] = parts;

  let signatureValid = false;
  try {
    const pub = await crypto.subtle.importKey("raw", b64url(publicKeyRaw), { name: "Ed25519" }, false, ["verify"]);
    signatureValid = await crypto.subtle.verify({ name: "Ed25519" }, pub, b64url(sig), new TextEncoder().encode(`${prefix}.${head}.${body}`));
  } catch {
    throw new Error("This browser cannot verify Ed25519 signatures offline — use online verification");
  }
  if (!signatureValid) throw new Error("Signature verification failed — token is forged or altered");

  const keyBytes = Uint8Array.from(aesKeyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const blob = b64url(body);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12));
  } catch {
    throw new Error("Decryption failed — responder key is wrong or not provisioned");
  }
  const payload = JSON.parse(new TextDecoder().decode(plain));
  const header = JSON.parse(new TextDecoder().decode(b64url(head)));
  return {
    mode: "offline",
    digitalId: header.did,
    tokenId: header.tid,
    profile: payload.profile,
    expiresAt: new Date(header.exp * 1000).toISOString(),
    expired: header.exp * 1000 < Date.now(),
    signatureValid: true,
  };
}

export default function ResponderPage() {
  const { user } = useAuth();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [aesKey, setAesKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setPublicKey(localStorage.getItem(LS_PUB));
    setAesKey(localStorage.getItem(LS_KEY) ?? "");
    api<{ raw: string }>("/api/health/responder/public-key")
      .then((k) => {
        localStorage.setItem(LS_PUB, k.raw);
        setPublicKey(k.raw);
      })
      .catch(() => undefined); // offline: keep the cached key
  }, []);

  const verifyOnline = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await api<Omit<Result, "mode">>("/api/health/responder/verify", { method: "POST", body: JSON.stringify({ token }) });
      setResult({ ...data, mode: "online" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runOffline = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (!publicKey) throw new Error("Signing public key not cached yet — connect once to fetch it");
      if (!/^[0-9a-fA-F]{64}$/.test(aesKey)) throw new Error("Provision the 64-hex-character responder key first");
      setResult(await verifyOffline(token, publicKey, aesKey));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setError("Camera QR scanning is not supported in this browser — paste the token text instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setScanning(true);
      const detector = new Detector({ formats: ["qr_code"] });
      requestAnimationFrame(async function loop() {
        if (!video.current) return;
        if (!video.current.srcObject) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        const codes = await detector.detect(video.current).catch(() => []);
        if (codes.length) {
          setToken(codes[0].rawValue);
          stream.getTracks().forEach((t) => t.stop());
          setScanning(false);
          return;
        }
        requestAnimationFrame(loop);
      });
    } catch (e: any) {
      setError(`Camera unavailable: ${e.message}`);
    }
  };

  const p = result?.profile;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Stethoscope className="h-7 w-7 text-[#d03b3b]" />First Responder · Emergency Medical ID</h1>
        <p className="mb-6 text-sm text-gray-600">Scan the casualty&apos;s Emergency QR. Its signature proves it was issued by the tourism health authority; only authorised responders can decrypt it.</p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">1 · Scan or paste</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {scanning && <video ref={video} className="w-full rounded-lg bg-black" muted playsInline />}
              <Button variant="outline" onClick={scan} className="w-full"><Camera className="h-4 w-4" />Scan QR with camera</Button>
              <Textarea value={token} onChange={(e) => setToken(e.target.value)} rows={5} placeholder="STHS1.…" className="font-mono text-xs" />
              <Button className="w-full" disabled={!token || busy || !user} onClick={verifyOnline}><ShieldCheck className="h-4 w-4" />Verify &amp; decrypt (online, audited)</Button>
              {!user && <p className="text-xs text-gray-600"><Link href="/login" className="text-blue-700 underline">Log in</Link> to use online verification.</p>}
              <Button variant="secondary" className="w-full" disabled={!token || busy} onClick={runOffline}><WifiOff className="h-4 w-4" />Verify &amp; decrypt offline</Button>

              <details className="rounded-lg border border-gray-200 p-3 text-xs">
                <summary className="flex cursor-pointer items-center gap-1 font-medium text-gray-700"><KeyRound className="h-3.5 w-3.5" />Offline provisioning</summary>
                <p className="mt-2 text-gray-600">Signing key: {publicKey ? <span className="text-gray-900">cached ✓</span> : "not cached"}</p>
                <p className="mt-1 text-gray-600">Responder key (RESPONDER_KEY, issued by the health authority). Stored only in this browser.</p>
                <Input type="password" value={aesKey} onChange={(e) => setAesKey(e.target.value.trim())} placeholder="64 hex characters" className="mt-1 font-mono text-xs" />
                <Button size="sm" variant="outline" className="mt-2" onClick={() => localStorage.setItem(LS_KEY, aesKey)}>Save on this device</Button>
              </details>
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#d03b3b]" />{error}
              </div>
            )}
            {!result && !error && (
              <Card><CardContent className="p-10 text-center text-sm text-gray-500">The decrypted clinical profile appears here.</CardContent></Card>
            )}
            {result && p && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{p.fullName}{p.age ? `, ${p.age}` : ""}</CardTitle>
                  <CardDescription>{result.digitalId} · permit {result.tokenId.slice(0, 10)}…</CardDescription>
                  <div className="flex flex-wrap gap-2 pt-1 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-900"><CheckCircle2 className="h-3.5 w-3.5 text-[#0ca30c]" />Signature valid</span>
                    {result.registry && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-900">
                        {result.registry.verified ? <Link2 className="h-3.5 w-3.5 text-[#0ca30c]" /> : <AlertTriangle className="h-3.5 w-3.5 text-[#d03b3b]" />}
                        {result.registry.verified ? "Hash matches SBT registry" : "Hash NOT on registry"} ({result.registry.source})
                      </span>
                    )}
                    {result.mode === "offline" && <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-900"><WifiOff className="h-3.5 w-3.5" />Decrypted offline</span>}
                    {result.expired && <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-gray-900"><AlertTriangle className="h-3.5 w-3.5 text-[#d03b3b]" />Permit expired</span>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 rounded-lg border-2 border-gray-900 p-4">
                    <Syringe className="h-8 w-8 text-gray-700" />
                    <div><p className="text-xs uppercase text-gray-600">Blood group</p><p className="text-3xl font-black text-gray-900">{p.bloodGroup}</p></div>
                  </div>
                  <Section title="Allergies" icon={<AlertTriangle className="h-4 w-4 text-[#d03b3b]" />} items={p.allergies} empty="No known allergies" strong />
                  <Section title="Chronic conditions" icon={<Stethoscope className="h-4 w-4 text-gray-600" />} items={p.chronicConditions} empty="None declared" />
                  <Section title="Medications" icon={<Pill className="h-4 w-4 text-gray-600" />} items={p.medications} empty="None declared" />
                  <div>
                    <p className="mb-1 text-sm font-semibold text-gray-900">Emergency contacts</p>
                    {p.emergencyContacts.length ? p.emergencyContacts.map((c) => (
                      <p key={c.phone} className="text-sm text-gray-800">{c.name}{c.relationship ? ` (${c.relationship})` : ""} · <a className="text-blue-700 underline" href={`tel:${c.phone}`}>{c.phone}</a></p>
                    )) : <p className="text-sm text-gray-500">None</p>}
                  </div>
                  {result.liveStatus?.health && (
                    <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
                      <p className="font-semibold text-gray-900">Latest wearable reading</p>
                      HR {result.liveStatus.health.vitals.hr} bpm · SpO₂ {result.liveStatus.health.vitals.spo2}% · {result.liveStatus.health.vitals.skinTemp} °C · MEWS {result.liveStatus.health.mews} ({result.liveStatus.health.tier})
                    </div>
                  )}
                  <p className="text-[11px] text-gray-500">{result.mode === "online" ? "This access was recorded in the clinical access audit log." : "Offline decryption is not logged centrally; record the access in your patient report."}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, items, empty, strong }: { title: string; icon: React.ReactNode; items: string[]; empty: string; strong?: boolean }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-gray-900">{icon}{title}</p>
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((i) => (
            <span key={i} className={`rounded-md px-2 py-1 text-sm ${strong ? "border border-red-300 bg-red-50 font-semibold text-gray-900" : "bg-gray-100 text-gray-800"}`}>{i}</span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">{empty}</p>
      )}
    </div>
  );
}
