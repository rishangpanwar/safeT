import QRCode from 'qrcode';
import { getCollections } from '../config/database';
import {
  ClinicalProfile, computeTokenId, newPrivateSalt, computeClinicalHash, encryptProfile, decryptProfile,
  issueEmergencyToken, verifyEmergencyToken,
} from '../health/healthIdentity';
import healthRegistryService from './healthRegistryService';

export interface HealthRegistrationInput {
  nationalId: string;
  age?: number;
  bloodGroup: string;
  allergies?: string[];
  chronicConditions?: string[];
  medications?: string[];
  emergencyContacts?: { name: string; phone: string; relationship?: string }[];
  notes?: string;
  consent: boolean;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'];
const list = (xs: unknown) => (Array.isArray(xs) ? xs.map(String).map((s) => s.trim()).filter(Boolean) : []);

export function validateHealthInput(h: any): string | null {
  if (!h) return null;
  if (h.consent !== true) return 'Explicit consent is required to store an emergency health profile (DPDP Act 2023, s.6)';
  if (!h.nationalId || String(h.nationalId).trim().length < 4) return 'A national ID / passport number is required for the health permit';
  if (!BLOOD_GROUPS.includes(String(h.bloodGroup || '').toUpperCase())) return `bloodGroup must be one of ${BLOOD_GROUPS.join(', ')}`;
  return null;
}

/**
 * Phase 1 — pre-expedition Digital Health ID minting.
 * Stores only: TokenID, ClinicalHash, the AES-GCM encrypted profile and the permit receipt.
 */
export async function issueHealthIdentity(params: { fullName: string; input: HealthRegistrationInput; validUntil: Date }) {
  const { fullName, input, validUntil } = params;
  const tokenId = computeTokenId(input.nationalId);

  const { tourists } = await getCollections();
  const clash = await tourists.findOne({ 'healthProfile.tokenId': tokenId, isActive: true });
  if (clash) throw Object.assign(new Error('An active health permit already exists for this national ID'), { status: 409 });

  const profile: ClinicalProfile = {
    fullName,
    age: input.age ? Number(input.age) : undefined,
    bloodGroup: String(input.bloodGroup).toUpperCase(),
    allergies: list(input.allergies),
    chronicConditions: list(input.chronicConditions),
    medications: list(input.medications),
    emergencyContacts: (input.emergencyContacts ?? [])
      .filter((c) => c?.name && c?.phone)
      .map((c) => ({ name: String(c.name).trim(), phone: String(c.phone).trim(), relationship: c.relationship })),
    notes: input.notes,
  };
  const privateSalt = newPrivateSalt();
  const clinicalHash = computeClinicalHash(profile, privateSalt);
  const sbt = await healthRegistryService.issuePermit(tokenId, clinicalHash, validUntil);

  return {
    tokenId,
    clinicalHash,
    encryptedProfile: encryptProfile({ profile, clinicalHash, privateSalt }),
    sbt,
    validUntil,
    consent: { given: true, at: new Date(), purpose: 'emergency medical response', version: 'dpdp-2023-v1' },
  };
}

/**
 * Renews a seeded demo/sample tourist's permit that has expired or expires within 2 days, and
 * re-anchors it in the registry. A demo database outlives the short permits it was seeded with;
 * without this the Responder page shows "Permit expired" and "Hash NOT on registry".
 */
export async function renewPermitIfExpiring(digitalId: string, days: number): Promise<boolean> {
  const { tourists } = await getCollections();
  const tourist: any = await tourists.findOne({ digitalId }, { projection: { healthProfile: 1, validUntil: 1 } });
  const hp = tourist?.healthProfile;
  if (!hp?.tokenId || !hp?.clinicalHash) return false;
  const expiresAt = new Date(hp.validUntil ?? tourist.validUntil ?? 0).getTime();
  if (expiresAt >= Date.now() + 2 * 864e5) return false;
  const validUntil = new Date(Date.now() + days * 864e5);
  const sbt = await healthRegistryService.issuePermit(hp.tokenId, hp.clinicalHash, validUntil);
  await tourists.updateOne(
    { digitalId },
    { $set: { validUntil: validUntil.toISOString(), 'healthProfile.validUntil': validUntil, 'healthProfile.sbt': sbt } }
  );
  return true;
}

/** Phase 6 — signed, encrypted Emergency QR, cached by the phone for offline display. */
export async function emergencyQrFor(digitalId: string) {
  const { tourists } = await getCollections();
  const tourist: any = await tourists.findOne({ digitalId }, { projection: { digitalId: 1, healthProfile: 1, validUntil: 1 } });
  if (!tourist) throw Object.assign(new Error('Tourist not found'), { status: 404 });
  const hp = tourist.healthProfile;
  if (!hp?.encryptedProfile) throw Object.assign(new Error('No health profile registered for this tourist'), { status: 404 });

  const payload = decryptProfile<{ profile: ClinicalProfile; clinicalHash: string; privateSalt: string }>(hp.encryptedProfile);
  const validUntil = new Date(hp.validUntil ?? tourist.validUntil ?? Date.now() + 30 * 864e5);
  const token = issueEmergencyToken({ tid: hp.tokenId, did: digitalId, exp: Math.floor(validUntil.getTime() / 1000) }, payload);
  const qrDataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 1, width: 480 });
  return { token, qrDataUrl, validUntil, tokenId: hp.tokenId, sbt: hp.sbt };
}

/** Responder scan: verify signature, decrypt, check the hash against the SBT registry, audit the access. */
export async function verifyForResponder(token: string, responder: { id?: string; name?: string; role?: string }, ip?: string) {
  const { clinicalAccessLog, tourists } = await getCollections();
  let verified;
  try {
    verified = verifyEmergencyToken(token);
  } catch (error) {
    await clinicalAccessLog.insertOne({ at: new Date(), responder, ip, outcome: 'rejected', reason: (error as Error).message });
    throw Object.assign(error as Error, { status: 400 });
  }

  const chain = await healthRegistryService.verifyClinicalHash(verified.header.tid, verified.clinicalHash);
  const tourist: any = await tourists.findOne({ digitalId: verified.header.did }, { projection: { health: 1, currentLocation: 1, safetyStatus: 1 } });

  await clinicalAccessLog.insertOne({
    at: new Date(),
    responder,
    ip,
    outcome: 'decrypted',
    digitalId: verified.header.did,
    tokenId: verified.header.tid,
    integrity: chain,
  });

  return {
    digitalId: verified.header.did,
    tokenId: verified.header.tid,
    profile: verified.profile,
    issuedAt: new Date(verified.header.iat * 1000),
    expiresAt: new Date(verified.header.exp * 1000),
    expired: verified.expired,
    signatureValid: true,
    hashConsistent: verified.hashConsistent,
    registry: chain,
    liveStatus: tourist ? { safetyStatus: tourist.safetyStatus, health: tourist.health ?? null } : null,
  };
}
