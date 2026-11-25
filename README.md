# AI-Powered Smart Tourist Health, Safety & Emergency Response System

CSET343 · AI in Healthcare. This is the implementation of the project report *"AI-Powered Smart Tourist Health, Safety & Emergency Response System"*.

Wearable vital signs (heart rate, HRV, SpO₂, skin temperature) and the phone's motion sensors are monitored by an **on-device AI**. It detects *silent incapacitation* (falls, hypoxia, cardiac collapse) without the tourist pressing anything. Each event is triaged with **MEWS** and correlated with **geo-medical risk zones**. The system routes the nearest rescue asset inside the **Golden Hour** and generates an **E-FIR**. It keeps working in cellular shadow zones through **store-and-forward** buffering. Clinical directives are protected by **soulbound (ERC-5192) health permits** and a **signed, encrypted Emergency QR**.

The system is built on top of the existing Smart Tourist Safety project, which already provided registration, GPS tracking, geofences, SOS and the authority portal. That functionality is kept.

---

## 1. Where each part of the report lives

| Report section | Implementation |
|---|---|
| **§2.2-A Isolation Forest** (Eq. 2.1, 2.2; t = 100, ψ = 256) | [`server/src/health/isolationForest.ts`](smart-tourist-server/src/health/isolationForest.ts) trains the forest; the edge scorer is [`mobile/edge/clinical.ts`](smart-tourist-mobile-app/edge/clinical.ts) |
| Feature vector X = [HR, ΔHR, SpO₂, HRV_RMSSD, Temp, Mobility], 60 s sliding window | [`server/src/health/features.ts`](smart-tourist-server/src/health/features.ts) |
| **§2.2-B Four-stage fall detector** (Eq. 2.3–2.5: SVM, jerk, Ω, tilt) | [`mobile/edge/fallDetection.ts`](smart-tourist-mobile-app/edge/fallDetection.ts) |
| **§2.2-C MEWS** (Eq. 2.6, Table 2.1, Green/Yellow/Red) | [`server/src/health/mews.ts`](smart-tourist-server/src/health/mews.ts) (mirrored on the phone) |
| MEWS + Isolation Forest + terrain fusion, with kinematic context (exertion / resting tachycardia) | [`server/src/health/triage.ts`](smart-tourist-server/src/health/triage.ts) |
| Accuracy evaluation (ablation, ROC-AUC, per-pathology latency, fall detector per movement) | [`server/src/evaluation/vitalsEvaluation.ts`](smart-tourist-server/src/evaluation/vitalsEvaluation.ts), [`mobile/edge/fallEvaluation.ts`](smart-tourist-mobile-app/edge/fallEvaluation.ts), runner [`evaluation/run-accuracy.ts`](evaluation/run-accuracy.ts); results in [`evaluation/results/ACCURACY.md`](evaluation/results/ACCURACY.md); portal [`/accuracy`](smart-tourist-portal/app/accuracy/page.tsx) |
| **§2.2-D Ray-casting point-in-polygon + MBB pruning** (Eq. 2.7); S2 `2dsphere` index | [`server/src/health/geoMedical.ts`](smart-tourist-server/src/health/geoMedical.ts); used by [`geoFencingService.ts`](smart-tourist-server/src/services/geoFencingService.ts); `2dsphere` index on `medicalFacilities` |
| **§2.2-E Haversine + Dijkstra evacuation routing** (Eq. 2.8, O(E + V log V)) | [`server/src/health/routing.ts`](smart-tourist-server/src/health/routing.ts), [`rescueNetworkService.ts`](smart-tourist-server/src/services/rescueNetworkService.ts) |
| **§2.2-F SHA-256 TokenID / ClinicalHash** (Eq. 2.9), encrypted profile, signed QR | [`server/src/health/healthIdentity.ts`](smart-tourist-server/src/health/healthIdentity.ts), [`healthIdentityService.ts`](smart-tourist-server/src/services/healthIdentityService.ts) |
| **ERC-5192 Soulbound Token** `TouristHealthRegistry.sol` | [`server/chain/contracts/TouristHealthRegistry.sol`](smart-tourist-server/chain/contracts/TouristHealthRegistry.sol), [`healthRegistryService.ts`](smart-tourist-server/src/services/healthRegistryService.ts) |
| Objective 4: offline store-and-forward (SQLite circular buffer, delta compression) | [`mobile/edge/telemetryStore.ts`](smart-tourist-mobile-app/edge/telemetryStore.ts) |
| Phases 2–4: monitoring, 30 s self-check, autonomous escalation, offline emergency mode | [`mobile/services/healthMonitor.ts`](smart-tourist-mobile-app/services/healthMonitor.ts), [`SelfCheckOverlay.tsx`](smart-tourist-mobile-app/components/SelfCheckOverlay.tsx) |
| Phase 5: command dashboard, red alert, dispatch, E-FIR | portal [`/triage`](smart-tourist-portal/app/triage/page.tsx); [`healthMonitoringService.ts`](smart-tourist-server/src/services/healthMonitoringService.ts) |
| Phase 6: paramedic QR scan and decryption | portal [`/responder`](smart-tourist-portal/app/responder/page.tsx); mobile [`MedicalIdCard.tsx`](smart-tourist-mobile-app/components/MedicalIdCard.tsx) |
| Tier 1 wearables (BLE GATT 0x2A37 / 0x2A5F / 0x2A1C) | [`mobile/edge/wearable.ts`](smart-tourist-mobile-app/edge/wearable.ts) |

## 2. Architecture (four tiers)

```
Tier 1  Sensing          Wearable band (HR, HRV, SpO₂, temp) ── BLE GATT ──┐   Phone: 50 Hz accel + gyro, GNSS
                                                                         ▼
Tier 2  Mobile edge      healthMonitor: 60 s window → Isolation Forest + MEWS + geofence → self-check (30 s)
        (Expo app)       FallDetector (4 stages) · SQLite 24 h buffer + outbox · delta-v1 burst sync
                                         │ REST /api/health/*            ▲ Socket.IO advisories / ETA
                                         ▼                               │
Tier 3  Cloud services   Telemetry ingestion → triage engine → geo-medical validator → dispatch planner (Dijkstra)
        (Express)        E-FIR generator · server-side escalation backstop · personalised forests
                                         │
Tier 4  Command & trust  MongoDB (2dsphere) · in-memory live window cache · TouristHealthRegistry (ERC-5192)
                         Portal: Clinical Command Centre, Responder, live map with triage tiers + density layer
```

## 3. Running it

### Quick start: live demo, no database setup

Two terminals. You need Node.js 18+ and nothing else.

```bash
# Terminal 1: API server + live demo cohort
cd smart-tourist-server
npm install
npm run demo        # http://localhost:4000

# Terminal 2: command portal, reachable from phones on the same Wi-Fi
cd smart-tourist-portal
npm install
npm run phone       # builds, then serves on http://<your-PC-IP>:3001
```

Log in with **`gov_admin` / `GovAdmin@123`**. Demo mode creates this account automatically.

`npm run demo` does the following:

- If `MONGODB_URI` is not set (or `.env` is missing), it starts a **local MongoDB automatically**. The data is kept in `smart-tourist-server/.demo-db/`, so logins, registrations and incidents survive restarts. The first run downloads MongoDB once, about 600 MB. If you'd rather use Atlas, put its URI in `.env`; set `DEMO_DB=local` to force the local database.
- It streams **12 simulated wearers** through the real pipeline: ingestion, Isolation Forest, MEWS, geo-medical zones, self-check, incident, Dijkstra dispatch and E-FIR. They walk real routes: the Kedarnath trek, the Manali–Rohtang road and Jaipur's heritage sites. Their SpO₂ follows the altitude.
- About every 4 minutes one tourist has a health episode. Mild cases reach Watch and answer the 30 s self-check with "I'm OK". Severe cases reach Critical, the self-check expires and an incident is raised. If nobody confirms dispatch within 3 minutes, a duty officer does. The unit then "arrives", and the patient is handed over at the hospital, discharged later, and rejoins the route.
- **Presenter control:** the Dashboard and Clinical Triage pages show a *Live demo* banner with **Trigger now**, which starts an emergency immediately (random, or a chosen scenario such as AMS, cardiac event, fall, hypothermia or heatstroke). You don't have to wait for the timer.

`npm run dev` still runs the server without the demo cohort (it needs `MONGODB_URI`).

### Open it on your phone

The portal proxies `/api` and `/socket.io` to the API server, so the phone only ever talks to port 3001.

1. Find your PC's address: on Windows, run `ipconfig` and use the *IPv4 Address*.
2. Connect the phone to the **same Wi-Fi**, then open `http://<that-IP>:3001` in Chrome or Safari.
3. If it doesn't load:
   - **Windows firewall.** When Windows asks whether to allow Node.js, allow it (at least on *Private* networks). If you dismissed the prompt, go to *Windows Security → Firewall → Allow an app* and tick Node.js.
   - **College or public Wi-Fi** often blocks devices from reaching each other (client isolation). Turn on your phone's hotspot and connect the PC to it, or use the HTTPS tunnel below, which works from any network.

Use `npm run dev:phone` instead of `npm run phone` while you're editing code (hot reload).

### Install it as an app (PWA)

Phones only allow installing, the camera (QR scanning on the Responder page) and offline mode over **HTTPS**. A plain `http://192.168…` address can't do that. To get an HTTPS address, keep both terminals running and start a third:

```bash
cd smart-tourist-portal
npm run tunnel      # prints https://<random-name>.trycloudflare.com
```

Open that `https://…trycloudflare.com` address on the phone. Then:

- **Android (Chrome):** tap **Install app** in the menu (☰), or ⋮ → *Install app*.
- **iPhone (Safari):** tap **Share → Add to Home Screen**. The menu's *Install app* item explains the same steps.

The installed app opens full screen with a bottom tab bar (Home, Triage, Alerts, Responder) and has shortcuts to Triage, Responder and Alerts. Pages you've opened stay available offline. The Responder page can verify and decrypt an Emergency QR with no connection once its keys are saved on the device.

> **Note:** the tunnel URL is public while it runs. Anyone with the link can reach your portal, which still needs a login. Stop it (Ctrl+C) when you're done, and don't use the default development keys for anything real.

### Full setup (your own MongoDB, plus the tourist mobile app)

```bash
# 1. API server
cd smart-tourist-server
npm install
cp .env.example .env            # set MONGODB_URI; generate HEALTH_ID_SALT / RESPONDER_KEY / QR_SIGNING_SEED
npm run dev                     # http://localhost:4000 (seeds zones, rescue network, 2 sample trekkers); or: npm run demo

# 2. Command portal
cd ../smart-tourist-portal
npm install
npm run dev                     # http://localhost:3001 (BACKEND_URL in .env.local only if the API isn't on localhost:4000)

# 3. Mobile app (tourist side)
cd ../smart-tourist-mobile-app
npm install
cp .env.example .env            # EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000
npm start                       # scan with Expo Go
```

### Android app (.apk) — install the tourist app on a phone

**Build in the cloud with Expo EAS (recommended for distribution).** The app is linked to the Expo project `safet`; `eas.json` has a `preview` profile that produces an installable APK and a `production` profile for the Play Store.

```bash
cd smart-tourist-mobile-app
npx eas-cli@latest login
npx eas-cli@latest init --id <project-id>          # once; copy the full id from expo.dev
npx eas-cli@latest build -p android --profile preview
```

On the first build, answer **Yes** to "Generate a new Android Keystore?" (Expo stores it and signs every later build with it). When the build finishes, EAS prints a link and QR code to download the APK; share that link or the file. An APK built on this PC is signed differently, so uninstall it before installing the EAS one.

**Build on this PC.** `smart-tourist-mobile-app/build-apk.cmd` builds a release APK at `dist/SmartTourist.apk` (needs the Android SDK and JDK 17; this PC has them in `D:\dev-tools`). To use either APK:

1. On the PC, double-click **`start-demo.cmd`**. It starts the API server and the portal, and prints the server address for phones (e.g. `192.168.31.128:4000`). Allow Node.js through Windows Firewall if asked.
2. Copy `SmartTourist.apk` to the phone (USB, Drive, WhatsApp to yourself…), open it and allow *Install unknown apps*.
3. Open **Smart Tourist Health**, enter the server address, tap **Test**, then enter the Digital ID from the portal's *Register Tourist* page and tap **Activate**. Allow location ("Allow all the time" keeps sharing alive when the app is closed; "While using the app" also works, through the location notification).

The phone and the PC must be on the same Wi-Fi (or the phone's hotspot). When the PC gets a new address, change it in the app under **Profile → Server**. Differences from Expo Go: the map uses OpenStreetMap (no Google Maps API key needed; tiles need internet), location sharing runs as a foreground service, and the app talks to the server over plain HTTP on the local network.

Without demo mode, create the government login once with `POST http://localhost:4000/api/auth/create-sample-gov` (development only). The username is `gov_admin` and the password is `GovAdmin@123`.

### Optional: real blockchain instead of the fallback ledger

Hardhat 3 is ESM-only and the API server is CommonJS, so the contracts live in a nested ESM workspace, `smart-tourist-server/chain/`. It uses the server's `node_modules`.

```bash
cd smart-tourist-server
npm run chain:test                       # contract tests (soulbound transfers revert, etc.)
cd chain && npx hardhat node             # terminal A: local chain
npm run chain:deploy:local               # terminal B: prints the TouristHealthRegistry address
# .env → BLOCKCHAIN_RPC_URL, PRIVATE_KEY (a funded account), HEALTH_REGISTRY_ADDRESS
```

For **Polygon Amoy** (the report's L2 testnet), set the Hardhat config variables `AMOY_RPC_URL` and `AMOY_PRIVATE_KEY`, then run `npm run chain:deploy:amoy`. Without a configured contract, permits go to a hash-chained MongoDB ledger (`sbtLedger`). The API reports this honestly as `network: "fallback-ledger"`.

## 4. Demo walkthrough

1. **Register (Phase 1).** In the portal, go to *Register Tourist* and fill Step 3, *Emergency Health Profile*, including the consent box. The response shows the soulbound permit: TokenID, ClinicalHash and transaction.
2. **Activate (Phase 2).** Enter the Digital ID in the app. The **Health** tab starts streaming 1 Hz vitals from the simulated band, with motion taken from the phone's sensors.
3. **AI detection (Phase 3).** Pick *AMS → HAPE* or *Cardiac event* in the Health tab. Within about 1–2 minutes the tier turns red, and a full-screen **"ARE YOU OK?"** alarm (vibration and audio) counts down 30 s. Press *I'M OK* to cancel, or let it expire.
4. **Fall detection.** Tap *Test fall detection* (or really drop into a lying position). The four-stage detector confirms the fall and starts the same self-check.
5. **Escalation (Phase 4–5).** On expiry the app sends the incident: GPS, altitude, the last 15 min of vitals and the MEWS score. The portal's **Clinical Triage** page flashes a Red Alert with an alarm and shows the recommended asset (e.g. *air ambulance from Phata Helibase, ETA 20 min → AIIMS Rishikesh, trauma level 1*), the Golden Hour status, the alternatives and a printable **E-FIR**.
6. **Offline mode.** Turn on airplane mode before step 5. The app shows *OFFLINE EMERGENCY MODE*, keeps triaging and buffering, and delivers everything (delta-compressed) when signal returns.
7. **Paramedic (Phase 6).** On the phone, open *Emergency Medical ID*. In the portal, go to **Responder** and scan or paste the QR. It verifies the Ed25519 signature, decrypts blood group, allergies, conditions and contacts, and checks the hash against the SBT registry. Online verification is audited; offline decryption runs in the browser.

Without a phone, you can stream a scenario from the command line instead:

```bash
cd smart-tourist-server
npm run simulate -- --tourist TID-trek-kedarnath-01 --scenario ams --duration 240 --speed 10 --incident
npm run simulate -- --tourist TID-trek-rohtang-01 --scenario normal --offline 300   # store-and-forward burst
```

## 5. Health API (new)

| Method & path | Purpose |
|---|---|
| `GET /api/health/model` | Isolation Forest + thresholds for on-device scoring |
| `POST /api/health/:id/telemetry` | 1 Hz samples, `{samples}` or `delta-v1` encoded burst |
| `POST /api/health/:id/selfcheck` | `{outcome: responded \| expired}` |
| `POST /api/health/:id/incident` | Emergency Distress Event → dispatch plan + E-FIR |
| `GET /api/health/:id/status` · `GET /api/health/:id/emergency-qr` | Current triage · signed Emergency QR |
| `GET /api/health/triage` 🔒 · `GET /api/health/:id/vitals` 🔒 | Command board · vital trends |
| `GET /api/health/incidents[/:id]` 🔒 · `POST /api/health/incidents/:id/dispatch` 🔒 | Incident queue · confirm dispatch |
| `POST /api/health/responder/verify` 🔒 · `GET /api/health/responder/public-key` | QR verification (audited) · Ed25519 key |
| `GET /api/health/network` · `GET /api/health/registry` | Rescue network · trust-layer status |
| `GET /api/health/demo` · `POST /api/health/demo/trigger` 🔒 | Live demo status · start an episode now (`{scenario?, digitalId?, severe?}`) |

🔒 means the endpoint needs a portal login. Socket.IO events sent to authorities: `health_update`, `health_incident`, `health_selfcheck`, `emergency_alert`. Events sent to the tourist: `health_advisory`, `incident_ack`.

## 6. Tests

```bash
cd smart-tourist-server && npm test            # algorithms: iForest, MEWS table, ray casting, Haversine, routing, crypto, accuracy floors
cd smart-tourist-server && npm run chain:test  # ERC-5192 contract
cd smart-tourist-mobile-app && npm run test:edge   # fall detector, BLE GATT decoding, edge ↔ server parity, accuracy floors
```

The Isolation Forest thresholds (watch 0.60, critical 0.66) were calibrated on held-out windows from the training generator. Normal trekking scores at p99 ≈ 0.58; simulated hypoxic collapse, syncope and heatstroke score 0.68–0.71.

## 7. Accuracy evaluation

```bash
cd smart-tourist-server
npm run evaluate        # ≈ 30 s → evaluation/results/accuracy.json + ACCURACY.md, shown on the portal's Model Accuracy page
```

Simulated trekkers (healthy walking, healthy resting, and AMS, cardiac, hypothermia, heatstroke and fall episodes) stream through the real feature window, Isolation Forest, MEWS and fusion code, over 5 seeds. Synthetic 50 Hz motion traces (falls, collapses, walking, running, jumping, sitting down hard, lying or flopping down, phone drops) go through the real fall detector with random phone orientations. The original and final versions run on identical data:

| | Original | Final |
|---|---|---|
| Vital signs: session accuracy | 90.0 % | 99.3 % |
| Vital signs: emergencies detected | 86.5 % | 99.9 % |
| Vital signs: healthy sessions alarm-free | 96.5 % | 98.3 % |
| Vital signs: false Red alarms per trekker-hour | 0.28 | 0.14 |
| Vital signs: healthy time shown Yellow/Red | 28 % | 7.6 % |
| Isolation Forest ROC-AUC | 0.923 | 0.961 |
| Fall detector: accuracy / recall | 83.7 % / 66.7 % | 92.7 % / 99.7 % |

What the first evaluation showed, and what changed:

- **The forest could not see "motionless at 110 bpm".** Each value is ordinary on its own axis. Training now fits HR ≈ a + b·Mobility on healthy data and adds the unexplained heart rate as a split dimension (model version 2; the phone scores it too). X and Eq. 2.1–2.2 are unchanged.
- **MEWS flagged 28 % of healthy trekking** because it was designed for patients at rest. While walking with a normal forest score, exertional tachycardia is no longer escalated (bradycardia always is). HR > 100 bpm after ≥ 2 min of complete stillness now raises the self-check, which took post-fall incapacitation from 30 % to 100 % detected.
- **The four-stage fall detector missed every collapse** (fainting has no free fall below 0.5 g). A soft impact after partial unloading now also opens Stage 3–4, which then needs 20 s motionless with no voluntary rotation.

The full tables (ablation of MEWS / forest / fusion, per-pathology latency, every movement class) are in [`evaluation/results/ACCURACY.md`](evaluation/results/ACCURACY.md). All of it is synthetic data: it compares versions fairly but is not clinical validation.

## 8. Limitations (stated plainly)

- **No real crisis dataset.** As the report argues, labelled data does not exist. The forest is trained on a synthetic healthy-trekking baseline and personalised per tourist on their own Green-tier windows. The thresholds need clinical validation before any real use.
- **No real wearable is paired yet.** The app (Expo Go and the .apk alike) uses a simulated band. The GATT parsers are implemented and tested; connecting a real band needs a BLE library (e.g. `react-native-ble-plx`) added to the native build. Broadcasting an emergency BLE beacon to nearby phones is not implemented either.
- **Foreground monitoring.** Vitals scoring and fall detection run while the app is open. GPS continues in the background (as before). Background sensor processing needs a native foreground service.
- **Redis.** The live window cache is in-process memory. With more than one server instance, swap it for Redis as in the report's Tier 4b.
- **Rescue network data is illustrative.** Facility locations in [`seedHealthData.ts`](smart-tourist-server/src/scripts/seedHealthData.ts) are approximate. Replace them with the district's authoritative registry.
- **Demo data is simulated.** In `npm run demo`, the wearers, their routes and their health episodes are synthetic, and the portal labels them that way. The algorithms they flow through are the real ones. Rescue-unit travel in the demo is capped at 3 minutes so incidents close during a presentation; the real ETA is still shown.
- **MEWS was designed for patients at rest.** The kinematic context now discounts exertional tachycardia, but walking above ~4,500 m with SpO₂ ≤ 90 % still asks for a self-check (about 0.14 false prompts per trekker-hour in the evaluation), which the 10-minute "I'm OK" cooldown absorbs. Pulse pressure contributes 0, because Table 2.1 defines no bands for it and wearables can't measure blood pressure.
- **A dropped phone looks like a fall.** About 60 % of simulated phone drops pass all four stages. The 30 s self-check is the safeguard: the owner picks the phone up and cancels.
