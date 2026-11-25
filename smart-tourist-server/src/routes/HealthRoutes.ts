import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getCollections } from '../config/database';
import { authenticateToken, requirePermission } from '../middleware/auth';
import healthMonitoringService from '../services/healthMonitoringService';
import healthRegistryService from '../services/healthRegistryService';
import { emergencyQrFor, verifyForResponder } from '../services/healthIdentityService';
import { getRescueNetwork } from '../services/rescueNetworkService';
import { signingPublicKeyPem, signingPublicKeyRaw } from '../health/healthIdentity';
import demoMode from '../demo/demoMode';
import { SCENARIOS, Scenario } from '../demo/physiology';

const router = Router();

const fail = (res: Response, error: any, fallback: string) => {
  const status = error?.status ?? 500;
  if (status >= 500) console.error(`[Health] ${fallback}:`, error);
  res.status(status).json({ success: false, message: error?.message ?? fallback });
};

// ---------------------------------------------------------------- live demo (npm run demo)

// GET /api/health/demo — whether the simulated cohort is running, and what it is doing
router.get('/demo', (_req: Request, res: Response) => {
  res.json({ success: true, data: demoMode.status() });
});

// POST /api/health/demo/trigger — presenter control: start a health episode now
router.post('/demo/trigger', authenticateToken, (req: Request, res: Response) => {
  try {
    const { digitalId, scenario, severe } = req.body ?? {};
    if (scenario && !SCENARIOS.includes(scenario)) return res.status(400).json({ success: false, message: `scenario must be one of ${SCENARIOS.join(', ')}` });
    return res.json({ success: true, data: demoMode.trigger({ digitalId, scenario: scenario as Scenario | undefined, severe: severe === undefined ? undefined : !!severe }) });
  } catch (error) {
    return fail(res, error, 'Failed to trigger demo episode');
  }
});

// ---------------------------------------------------------------- edge / mobile endpoints

// GET /api/health/model — Isolation Forest + thresholds for on-device (offline) scoring
router.get('/model', (_req: Request, res: Response) => {
  res.json({ success: true, data: healthMonitoringService.getEdgeModel() });
});

// GET /api/health/evaluation — results of the accuracy evaluation (written by `npm run evaluate`)
router.get('/evaluation', (_req: Request, res: Response) => {
  const candidates = [
    process.env.ACCURACY_REPORT_PATH,
    path.resolve(process.cwd(), '../evaluation/results/accuracy.json'), // started from smart-tourist-server
    path.resolve(__dirname, '../../../evaluation/results/accuracy.json'), // src/routes (tsx / ts-node)
    path.resolve(__dirname, '../../../../evaluation/results/accuracy.json'), // dist/src/routes (compiled)
  ].filter((p): p is string => !!p);
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    return res.status(404).json({ success: false, message: 'No accuracy report yet. Run `npm run evaluate` in smart-tourist-server.' });
  }
  try {
    return res.json({ success: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (error) {
    return fail(res, error, 'Failed to read the accuracy report');
  }
});

// POST /api/health/:digitalId/telemetry — 1 Hz vitals, live or burst-synced from the offline buffer
router.post('/:digitalId/telemetry', async (req: Request, res: Response) => {
  try {
    const samples = healthMonitoringService.decodeBatch(req.body);
    if (samples.length > 5000) return res.status(413).json({ success: false, message: 'Batch too large (max 5000 samples)' });
    const result = await healthMonitoringService.ingest(req.params.digitalId, samples, { location: req.body.location });
    return res.json({ success: true, data: result });
  } catch (error) {
    return fail(res, error, 'Telemetry ingestion failed');
  }
});

// POST /api/health/:digitalId/selfcheck — outcome of the 30 s "ARE YOU OK?" dialog (Phase 3a)
router.post('/:digitalId/selfcheck', async (req: Request, res: Response) => {
  try {
    const { outcome, reason } = req.body;
    if (!['responded', 'expired'].includes(outcome)) return res.status(400).json({ success: false, message: "outcome must be 'responded' or 'expired'" });
    return res.json({ success: true, data: await healthMonitoringService.recordSelfCheck(req.params.digitalId, outcome, reason) });
  } catch (error) {
    return fail(res, error, 'Self-check update failed');
  }
});

// POST /api/health/:digitalId/incident — Emergency Distress Event (Phase 3b / 4)
router.post('/:digitalId/incident', async (req: Request, res: Response) => {
  try {
    const { trigger } = req.body;
    if (!['fall', 'vital_anomaly', 'manual_sos'].includes(trigger)) {
      return res.status(400).json({ success: false, message: "trigger must be 'fall', 'vital_anomaly' or 'manual_sos'" });
    }
    const result = await healthMonitoringService.reportIncident(req.params.digitalId, req.body);
    return res.status(result.isUpdate ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    return fail(res, error, 'Incident report failed');
  }
});

// GET /api/health/:digitalId/status — current triage assessment
router.get('/:digitalId/status', async (req: Request, res: Response) => {
  try {
    const { tourists } = await getCollections();
    const t: any = await tourists.findOne({ digitalId: req.params.digitalId }, { projection: { health: 1, safetyStatus: 1 } });
    if (!t) return res.status(404).json({ success: false, message: 'Tourist not found' });
    return res.json({ success: true, data: { health: t.health ?? null, safetyStatus: t.safetyStatus } });
  } catch (error) {
    return fail(res, error, 'Failed to load status');
  }
});

// GET /api/health/:digitalId/emergency-qr — signed + encrypted Emergency QR (cached offline by the phone)
router.get('/:digitalId/emergency-qr', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await emergencyQrFor(req.params.digitalId) });
  } catch (error) {
    return fail(res, error, 'Failed to issue emergency QR');
  }
});

// ---------------------------------------------------------------- command dashboard (authenticated)

// GET /api/health/triage — all active tourists, Red → Yellow → Green, then by MEWS
router.get('/triage', authenticateToken, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await healthMonitoringService.getTriageBoard() });
  } catch (error) {
    return fail(res, error, 'Failed to load triage board');
  }
});

// GET /api/health/:digitalId/vitals?minutes=60 — vital-sign trend
router.get('/:digitalId/vitals', authenticateToken, async (req: Request, res: Response) => {
  try {
    const minutes = Math.min(24 * 60, Math.max(1, parseInt(req.query.minutes as string) || 60));
    return res.json({ success: true, data: await healthMonitoringService.getVitals(req.params.digitalId, minutes) });
  } catch (error) {
    return fail(res, error, 'Failed to load vitals');
  }
});

// GET /api/health/incidents — health incidents with dispatch plans
router.get('/incidents', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { alerts } = await getCollections();
    const filter: any = { 'metadata.source': 'health_monitor' };
    if (req.query.status) filter.status = req.query.status;
    const data = await alerts.find(filter).sort({ 'timeline.createdAt': -1 }).limit(100).toArray();
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, 'Failed to load incidents');
  }
});

// GET /api/health/incidents/:id — full incident incl. E-FIR
router.get('/incidents/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid incident id' });
    const { alerts } = await getCollections();
    const incident = await alerts.findOne({ _id: new ObjectId(req.params.id) });
    if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });
    return res.json({ success: true, data: incident });
  } catch (error) {
    return fail(res, error, 'Failed to load incident');
  }
});

// POST /api/health/incidents/:id/dispatch — commander confirms the rescue unit
router.post('/incidents/:id/dispatch', authenticateToken, requirePermission('canManageAlerts'), async (req: Request, res: Response) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid incident id' });
    const { alerts } = await getCollections();
    const { unitNodeId, notes } = req.body;
    const result = await alerts.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: 'acknowledged',
          'dispatch.dispatchedUnit': unitNodeId,
          'dispatch.dispatchedAt': new Date(),
          'dispatch.dispatchedBy': req.user?._id,
          'timeline.acknowledgedAt': new Date(),
          'timeline.acknowledgedBy': req.user?._id,
          'timeline.updatedAt': new Date(),
          ...(notes ? { 'timeline.notes': notes } : {}),
        },
      },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ success: false, message: 'Incident not found' });
    return res.json({ success: true, data: result });
  } catch (error) {
    return fail(res, error, 'Dispatch failed');
  }
});

// GET /api/health/network — medical posts, trauma centres, SAR bases and routes for the map
router.get('/network', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await getRescueNetwork() });
  } catch (error) {
    return fail(res, error, 'Failed to load rescue network');
  }
});

// GET /api/health/registry — trust layer status (on-chain vs fallback ledger)
router.get('/registry', async (_req: Request, res: Response) => {
  res.json({ success: true, data: await healthRegistryService.status() });
});

// ---------------------------------------------------------------- first responders

// GET /api/health/responder/public-key — Ed25519 key to verify emergency QR signatures
router.get('/responder/public-key', (_req: Request, res: Response) => {
  res.json({ success: true, data: { algorithm: 'Ed25519', pem: signingPublicKeyPem(), raw: signingPublicKeyRaw() } });
});

// POST /api/health/responder/verify — verify + decrypt a scanned emergency QR (audited)
router.post('/responder/verify', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.body?.token) return res.status(400).json({ success: false, message: 'token is required' });
    const data = await verifyForResponder(
      String(req.body.token),
      { id: req.user?._id?.toString(), name: req.user?.profile?.fullName, role: req.user?.role },
      req.ip
    );
    return res.json({ success: true, data });
  } catch (error) {
    return fail(res, error, 'Verification failed');
  }
});

export default router;
