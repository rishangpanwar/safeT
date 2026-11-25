import { getCollections } from '../config/database';
import { issueHealthIdentity, renewPermitIfExpiring } from '../services/healthIdentityService';

/**
 * Seed data for the health & emergency-response layer. Facility locations are approximate
 * and illustrative — replace them with the authoritative registry of the deploying
 * district before real use. Every insert is idempotent (upsert by natural key).
 */

type Zone = {
  name: string;
  description: string;
  type: 'alert_zone' | 'restricted_zone' | 'emergency_zone';
  riskLevel: 'high' | 'critical';
  geometry: { type: 'Polygon' | 'Circle'; coordinates: number[][] | number[]; radius?: number };
  category: 'high_altitude' | 'avalanche' | 'landslide' | 'medical_dead_zone';
  restrictsAirEvacuation?: boolean;
  message: string;
};

const GEO_MEDICAL_ZONES: Zone[] = [
  {
    name: 'Kedarnath High-Altitude Hypoxia Corridor (>3,000 m)',
    description: 'Linchauli to Kedarnath. Elevated risk of Acute Mountain Sickness, HAPE and HACE.',
    type: 'alert_zone',
    riskLevel: 'high',
    geometry: { type: 'Polygon', coordinates: [[79.035, 30.704], [79.085, 30.704], [79.085, 30.75], [79.035, 30.75], [79.035, 30.704]] },
    category: 'high_altitude',
    message: 'You are above 3,000 m. Ascend slowly, hydrate, and report headache or breathlessness.',
  },
  {
    name: 'Chorabari Glacier Avalanche Zone',
    description: 'Unstable snowfields above Kedarnath temple.',
    type: 'restricted_zone',
    riskLevel: 'critical',
    geometry: { type: 'Circle', coordinates: [79.062, 30.752], radius: 1500 },
    category: 'avalanche',
    message: 'DANGER: avalanche terrain. Do not proceed without a registered guide.',
  },
  {
    name: 'Mandakini River Gorge (helicopter-restricted)',
    description: 'Narrow ravine between Gaurikund and Bhimbali — rotary-wing evacuation not possible.',
    type: 'alert_zone',
    riskLevel: 'high',
    geometry: { type: 'Polygon', coordinates: [[79.022, 30.652], [79.034, 30.652], [79.042, 30.69], [79.032, 30.69], [79.022, 30.652]] },
    category: 'medical_dead_zone',
    restrictsAirEvacuation: true,
    message: 'Medical dead zone: no helicopter access and patchy signal. Stay on the main trail.',
  },
  {
    name: 'Rohtang Pass Hypoxia Corridor',
    description: 'Rohtang Pass (3,978 m) and approaches above Marhi.',
    type: 'alert_zone',
    riskLevel: 'high',
    geometry: { type: 'Polygon', coordinates: [[77.205, 32.345], [77.29, 32.345], [77.29, 32.40], [77.205, 32.40], [77.205, 32.345]] },
    category: 'high_altitude',
    message: 'You are near 4,000 m. Limit exertion and watch for altitude sickness.',
  },
  {
    name: 'Gulaba–Marhi Landslide Belt',
    description: 'Active slide slopes along the Rohtang highway.',
    type: 'restricted_zone',
    riskLevel: 'critical',
    geometry: { type: 'Circle', coordinates: [77.216, 32.34], radius: 1800 },
    category: 'landslide',
    message: 'Landslide-prone slope. Do not stop or leave the road.',
  },
];

type Facility = {
  nodeId: string; name: string; kind: string; lat: number; lng: number; elevation: number;
  airAmbulance?: boolean; traumaLevel?: 1 | 2 | 3; phone?: string;
};

const FACILITIES: Facility[] = [
  // Kedarnath trek (Uttarakhand)
  { nodeId: 'ked_base', name: 'Kedarnath Base Medical Relief Post', kind: 'medical_post', lat: 30.7346, lng: 79.0669, elevation: 3583 },
  { nodeId: 'ked_rudra', name: 'Rudra Point', kind: 'waypoint', lat: 30.7265, lng: 79.0595, elevation: 3400 },
  { nodeId: 'ked_linch', name: 'Linchauli Medical Aid Post', kind: 'medical_post', lat: 30.712, lng: 79.048, elevation: 3000 },
  { nodeId: 'ked_bhimbali', name: 'Bhimbali Aid Post', kind: 'medical_post', lat: 30.686, lng: 79.036, elevation: 2700 },
  { nodeId: 'ked_jungle', name: 'Jungle Chatti', kind: 'waypoint', lat: 30.669, lng: 79.03, elevation: 2400 },
  { nodeId: 'ked_gaurikund', name: 'Gaurikund Trailhead Aid Post', kind: 'medical_post', lat: 30.6526, lng: 79.0247, elevation: 1982 },
  { nodeId: 'ked_sonprayag', name: 'SDRF Mountain Rescue Base, Sonprayag', kind: 'sar_base', lat: 30.6337, lng: 78.9989, elevation: 1829, phone: '112' },
  { nodeId: 'ked_phata', name: 'Phata Helibase (Air Ambulance)', kind: 'helipad', lat: 30.5797, lng: 79.0386, elevation: 1500, airAmbulance: true, phone: '108' },
  { nodeId: 'ked_guptkashi', name: 'Guptkashi Community Health Centre', kind: 'medical_post', lat: 30.5236, lng: 79.079, elevation: 1319 },
  { nodeId: 'ked_rudraprayag', name: 'District Hospital Rudraprayag', kind: 'trauma_center', lat: 30.2844, lng: 78.9811, elevation: 895, traumaLevel: 2 },
  { nodeId: 'ked_aiims', name: 'AIIMS Rishikesh Trauma Centre', kind: 'trauma_center', lat: 30.0869, lng: 78.2676, elevation: 340, traumaLevel: 1, airAmbulance: true },
  // Manali – Rohtang (Himachal Pradesh)
  { nodeId: 'man_sar', name: 'Mountain Rescue Base, Manali', kind: 'sar_base', lat: 32.2396, lng: 77.1887, elevation: 2000, phone: '112' },
  { nodeId: 'man_hospital', name: 'Civil Hospital Manali', kind: 'trauma_center', lat: 32.2432, lng: 77.1892, elevation: 2050, traumaLevel: 3 },
  { nodeId: 'man_kothi', name: 'Kothi Aid Post', kind: 'medical_post', lat: 32.317, lng: 77.194, elevation: 2500 },
  { nodeId: 'man_gulaba', name: 'Gulaba Checkpost', kind: 'waypoint', lat: 32.329, lng: 77.205, elevation: 2900 },
  { nodeId: 'man_marhi', name: 'Marhi Medical Aid Post', kind: 'medical_post', lat: 32.353, lng: 77.228, elevation: 3300 },
  { nodeId: 'man_rohtang', name: 'Rohtang Pass', kind: 'waypoint', lat: 32.3716, lng: 77.2466, elevation: 3978 },
  { nodeId: 'man_kullu', name: 'Regional Hospital Kullu', kind: 'trauma_center', lat: 31.9578, lng: 77.1095, elevation: 1220, traumaLevel: 2 },
  { nodeId: 'man_bhuntar', name: 'Bhuntar Helibase (Air Ambulance)', kind: 'helipad', lat: 31.8763, lng: 77.1544, elevation: 1100, airAmbulance: true, phone: '108' },
  // Jaipur (existing demo city)
  { nodeId: 'jpr_sms', name: 'SMS Hospital Jaipur', kind: 'trauma_center', lat: 26.905, lng: 75.8156, elevation: 430, traumaLevel: 1 },
  { nodeId: 'jpr_sdrf', name: 'SDRF Rescue Unit, Jaipur', kind: 'sar_base', lat: 26.9196, lng: 75.7997, elevation: 431, phone: '112' },
  { nodeId: 'jpr_amer', name: 'Amer Fort First-Aid Post', kind: 'medical_post', lat: 26.9855, lng: 75.8513, elevation: 520 },
];

const ROUTES: [string, string, string][] = [
  ['ked_gaurikund', 'ked_jungle', 'trail'], ['ked_jungle', 'ked_bhimbali', 'trail'], ['ked_bhimbali', 'ked_linch', 'trail'],
  ['ked_linch', 'ked_rudra', 'trail'], ['ked_rudra', 'ked_base', 'trail'], ['ked_sonprayag', 'ked_gaurikund', 'jeep_track'],
  ['ked_sonprayag', 'ked_phata', 'road'], ['ked_phata', 'ked_guptkashi', 'road'], ['ked_guptkashi', 'ked_rudraprayag', 'road'],
  ['ked_rudraprayag', 'ked_aiims', 'road'],
  ['man_sar', 'man_hospital', 'road'], ['man_hospital', 'man_kothi', 'road'], ['man_kothi', 'man_gulaba', 'road'],
  ['man_gulaba', 'man_marhi', 'road'], ['man_marhi', 'man_rohtang', 'road'], ['man_hospital', 'man_kullu', 'road'],
  ['man_kullu', 'man_bhuntar', 'road'],
  ['jpr_sdrf', 'jpr_sms', 'road'], ['jpr_sms', 'jpr_amer', 'road'], ['jpr_sdrf', 'jpr_amer', 'road'],
];

const SAMPLE_TREKKERS = [
  {
    digitalId: 'TID-trek-kedarnath-01',
    kyc: { name: 'Aarav Mehta', nationality: 'Indian', passportNumber: 'Z9876543', phoneNumber: '+91-9000000001' },
    location: { latitude: 30.7095, longitude: 79.0462, altitude: 2985 },
    health: {
      nationalId: 'Z9876543', age: 29, bloodGroup: 'B+', allergies: ['Penicillin'], chronicConditions: ['Mild asthma'],
      medications: ['Salbutamol inhaler'], emergencyContacts: [{ name: 'Nisha Mehta', phone: '+91-9000000002', relationship: 'Sister' }], consent: true,
    },
  },
  {
    digitalId: 'TID-trek-rohtang-01',
    kyc: { name: 'Emma Clarke', nationality: 'British', passportNumber: 'GB5551234', phoneNumber: '+44-7700900001' },
    location: { latitude: 32.3512, longitude: 77.2265, altitude: 3290 },
    health: {
      nationalId: 'GB5551234', age: 46, bloodGroup: 'O-', allergies: [], chronicConditions: ['Hypertension'],
      medications: ['Amlodipine 5 mg'], emergencyContacts: [{ name: 'Tom Clarke', phone: '+44-7700900002', relationship: 'Spouse' }], consent: true,
    },
  },
];

export async function seedHealthData(): Promise<void> {
  const { geoFences, medicalFacilities, rescueRoutes, tourists } = await getCollections();

  let zones = 0;
  for (const z of GEO_MEDICAL_ZONES) {
    const r = await geoFences.updateOne(
      { name: z.name },
      {
        $setOnInsert: {
          name: z.name, description: z.description, type: z.type, riskLevel: z.riskLevel, geometry: z.geometry,
          isActive: true, createdBy: 'system', createdAt: new Date(), updatedAt: new Date(),
          alertSettings: { onEntry: true, onExit: false, alertLevel: z.riskLevel === 'critical' ? 'danger' : 'warning', notifyAuthorities: true, customMessage: z.message },
          metadata: { category: z.category, restrictsAirEvacuation: !!z.restrictsAirEvacuation, seedSet: 'geo-medical-v1' },
        },
      },
      { upsert: true }
    );
    zones += r.upsertedCount;
  }

  let nodes = 0;
  for (const f of FACILITIES) {
    const { lat, lng, ...rest } = f;
    const r = await medicalFacilities.updateOne(
      { nodeId: f.nodeId },
      { $setOnInsert: { ...rest, location: { type: 'Point', coordinates: [lng, lat] } } },
      { upsert: true }
    );
    nodes += r.upsertedCount;
  }

  let edges = 0;
  for (const [from, to, terrain] of ROUTES) {
    const r = await rescueRoutes.updateOne({ from, to }, { $setOnInsert: { from, to, terrain, passable: true } }, { upsert: true });
    edges += r.upsertedCount;
  }

  let trekkers = 0;
  for (const t of SAMPLE_TREKKERS) {
    if (await tourists.findOne({ digitalId: t.digitalId })) {
      await renewPermitIfExpiring(t.digitalId, 14);
      continue;
    }
    const validUntil = new Date(Date.now() + 14 * 864e5);
    const healthProfile = await issueHealthIdentity({ fullName: t.kyc.name, input: t.health, validUntil });
    await tourists.insertOne({
      digitalId: t.digitalId,
      kyc: { ...t.kyc, emergencyContact: t.health.emergencyContacts.map((c) => c.phone) },
      itinerary: { destinations: [] },
      safetyStatus: 'Normal',
      isActive: true,
      registeredAt: new Date().toISOString(),
      validUntil: validUntil.toISOString(),
      currentLocation: { ...t.location, timestamp: new Date() },
      lastLocationUpdate: new Date(),
      healthProfile,
    } as any);
    trekkers++;
  }

  console.log(`[Seed] Health layer: +${zones} geo-medical zones, +${nodes} facilities, +${edges} rescue routes, +${trekkers} sample trekkers`);
}
