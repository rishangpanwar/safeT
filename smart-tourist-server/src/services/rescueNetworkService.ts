import { getCollections } from '../config/database';
import { planEvacuation, DispatchPlan, RescueNode, RescueEdge } from '../health/routing';
import { pointInZone } from '../health/geoMedical';

/** Facilities considered for a casualty — anything further is not a realistic first response. */
const SEARCH_RADIUS_M = 250_000;

export async function getRescueNetwork(near?: { lat: number; lng: number }) {
  const { medicalFacilities, rescueRoutes } = await getCollections();
  const filter = near
    ? { location: { $near: { $geometry: { type: 'Point', coordinates: [near.lng, near.lat] }, $maxDistance: SEARCH_RADIUS_M } } }
    : {};
  const docs = await medicalFacilities.find(filter).toArray();
  const nodes: RescueNode[] = docs.map((d: any) => ({
    nodeId: d.nodeId,
    name: d.name,
    kind: d.kind,
    lat: d.location.coordinates[1],
    lng: d.location.coordinates[0],
    elevation: d.elevation ?? 0,
    airAmbulance: d.airAmbulance,
    traumaLevel: d.traumaLevel,
    phone: d.phone,
  }));
  const ids = nodes.map((n) => n.nodeId);
  const edges = (await rescueRoutes.find({ from: { $in: ids }, to: { $in: ids } }).toArray()) as unknown as RescueEdge[];
  return { nodes, edges };
}

/** Ravines and dense canopy can ground helicopters — zones flag this in metadata. */
async function airEvacuationPossible(lat: number, lng: number): Promise<boolean> {
  const { geoFences } = await getCollections();
  const restricting = await geoFences.find({ isActive: true, 'metadata.restrictsAirEvacuation': true }).toArray();
  return !restricting.some((z: any) => pointInZone(lat, lng, z.geometry));
}

export async function computeDispatchPlan(victim: { lat: number; lng: number; elevation?: number }): Promise<DispatchPlan> {
  const network = await getRescueNetwork(victim);
  return planEvacuation(victim, network, { airEvacuationPossible: await airEvacuationPossible(victim.lat, victim.lng) });
}

export interface EFir {
  firNumber: string;
  generatedAt: string;
  incidentType: string;
  occurredAt: string;
  location: { lat: number; lng: number; altitude?: number; nearestLandmark?: string; mapsUrl: string };
  subject: { digitalId: string; name?: string; nationality?: string; permitTokenId?: string };
  clinicalSummary: { triageTier: string; mews: number; anomalyScore: number | null; reasons: string[] };
  response: { recommendedUnit?: string; mode?: string; etaMinutes?: number; destination?: string; withinGoldenHour: boolean };
  narrative: string;
}

/**
 * Automated Electronic First Information Report (report Objective 6, Phase 5).
 * Deliberately excludes clinical directives (blood group, allergies…): those are only
 * released to medical responders through the signed emergency QR.
 */
export function generateEFir(params: {
  alertId: string;
  trigger: string;
  occurredAt: Date;
  tourist: any;
  location: { lat: number; lng: number; altitude?: number };
  assessment: { tier: string; mews: { total: number }; anomalyScore: number | null; reasons: string[] };
  plan: DispatchPlan;
}): EFir {
  const { alertId, trigger, occurredAt, tourist, location, assessment, plan } = params;
  const d = new Date();
  const firNumber = `EFIR-${d.toISOString().slice(0, 10).replace(/-/g, '')}-${alertId.slice(-6).toUpperCase()}`;
  const name = tourist?.kyc?.name || tourist?.personalInfo?.fullName;
  const nationality = tourist?.kyc?.nationality || tourist?.personalInfo?.nationality;
  const incidentType =
    trigger === 'fall' ? 'Traumatic fall with suspected incapacitation'
      : trigger === 'vital_anomaly' ? 'Acute physiological decompensation (AI-detected)'
      : trigger === 'manual_sos' ? 'Manual SOS distress signal'
      : 'Unacknowledged critical health alert (server escalation)';
  const r = plan.recommended;

  const narrative = [
    `At ${occurredAt.toISOString()} the Smart Tourist Health system recorded: ${incidentType.toLowerCase()}.`,
    `Subject ${name ?? 'unknown'} (${nationality ?? 'nationality unknown'}), digital tourist ID ${tourist?.digitalId}.`,
    `Last known position ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${location.altitude ? ` at ${Math.round(location.altitude)} m ASL` : ''}` +
      (plan.nearestMedicalPost ? `, ${plan.nearestMedicalPost.distanceKm} km from ${plan.nearestMedicalPost.name}.` : '.'),
    `Clinical triage: ${assessment.tier.toUpperCase()} (MEWS ${assessment.mews.total}${assessment.anomalyScore != null ? `, anomaly score ${assessment.anomalyScore.toFixed(2)}` : ''}).`,
    r ? `Recommended response: ${r.mode} unit from ${r.unit.name}, ETA ${r.etaMinutes} min${plan.destinationFacility ? `, onward to ${plan.destinationFacility.name}` : ''}.` : 'No rescue asset reachable in the configured network.',
    plan.withinGoldenHour ? 'Response is projected within the clinical Golden Hour.' : 'WARNING: projected response exceeds the Golden Hour.',
  ].join(' ');

  return {
    firNumber,
    generatedAt: d.toISOString(),
    incidentType,
    occurredAt: occurredAt.toISOString(),
    location: {
      ...location,
      nearestLandmark: plan.nearestMedicalPost?.name,
      mapsUrl: `https://www.google.com/maps?q=${location.lat},${location.lng}`,
    },
    subject: { digitalId: tourist?.digitalId, name, nationality, permitTokenId: tourist?.healthProfile?.tokenId },
    clinicalSummary: { triageTier: assessment.tier, mews: assessment.mews.total, anomalyScore: assessment.anomalyScore, reasons: assessment.reasons },
    response: {
      recommendedUnit: r?.unit.name,
      mode: r?.mode,
      etaMinutes: r?.etaMinutes,
      destination: plan.destinationFacility?.name,
      withinGoldenHour: plan.withinGoldenHour,
    },
    narrative,
  };
}
