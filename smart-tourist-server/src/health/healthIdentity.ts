import crypto from 'crypto';

/**
 * Privacy-preserving health identity (report §2.2-F).
 *
 *   TokenID      = SHA-256( NationalID || Salt )
 *   ClinicalHash = SHA-256( BloodGroup || ChronicConditions || Allergies || EmergencyContacts || PrivateSalt )   (Eq. 2.9)
 *
 * Only these hashes go on-chain. The clinical profile itself is AES-256-GCM encrypted
 * with the responder key and wrapped in an Ed25519-signed Emergency QR token, so an
 * authorised paramedic can verify authenticity with the public key and decrypt locally.
 *
 * Token format:  STHS1.<header b64url>.<iv|ciphertext|tag b64url>.<signature b64url>
 */

export interface ClinicalProfile {
  fullName: string;
  age?: number;
  bloodGroup: string;
  allergies: string[];
  chronicConditions: string[];
  medications: string[];
  emergencyContacts: { name: string; phone: string; relationship?: string }[];
  notes?: string;
}

export interface EmergencyTokenHeader {
  v: 1;
  tid: string; // TokenID (hex)
  did: string; // digital tourist ID
  iat: number;
  exp: number;
}

const PREFIX = 'STHS1';
const DEV_FALLBACK = 'smart-tourist-health-dev-only';

let warnedDevKeys = false;
function devWarn() {
  if (!warnedDevKeys) {
    console.warn('[HealthIdentity] Using development keys. Set HEALTH_ID_SALT, RESPONDER_KEY and QR_SIGNING_SEED in .env for real deployments.');
    warnedDevKeys = true;
  }
}

const sha256Hex = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

function keyFromEnv(name: string, label: string): Buffer {
  const hex = process.env[name];
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  devWarn();
  return crypto.createHash('sha256').update(`${DEV_FALLBACK}:${label}`).digest();
}

/** 32-byte AES key held by authorised responders. */
export const responderKey = () => keyFromEnv('RESPONDER_KEY', 'responder');

/** Deterministic Ed25519 key pair from a 32-byte seed (PKCS#8 DER prefix + seed). */
function signingKeys() {
  const seed = keyFromEnv('QR_SIGNING_SEED', 'qr-signing');
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function signingPublicKeyPem(): string {
  return signingKeys().publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/** Raw 32-byte public key, base64url — what the browser's WebCrypto imports. */
export function signingPublicKeyRaw(): string {
  const spki = signingKeys().publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return spki.subarray(spki.length - 32).toString('base64url');
}

export function computeTokenId(nationalId: string): string {
  const salt = process.env.HEALTH_ID_SALT || (devWarn(), DEV_FALLBACK);
  return sha256Hex(`${nationalId.trim().toUpperCase()}||${salt}`);
}

export function newPrivateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function computeClinicalHash(profile: ClinicalProfile, privateSalt: string): string {
  const list = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).filter(Boolean).sort().join(',');
  const contacts = profile.emergencyContacts.map((c) => `${c.name.trim()}:${c.phone.replace(/\s+/g, '')}`).sort().join(',');
  return sha256Hex(
    [profile.bloodGroup.trim().toUpperCase(), list(profile.chronicConditions), list(profile.allergies), contacts, privateSalt].join('||')
  );
}

export function encryptProfile(payload: object, key = responderKey()): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url');
}

export function decryptProfile<T = unknown>(blob: string, key = responderKey()): T {
  const buf = Buffer.from(blob, 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')) as T;
}

/** Builds the signed Emergency QR token for a tourist. */
export function issueEmergencyToken(
  header: Omit<EmergencyTokenHeader, 'v' | 'iat'>,
  payload: { profile: ClinicalProfile; clinicalHash: string; privateSalt: string }
): string {
  const h: EmergencyTokenHeader = { v: 1, iat: Math.floor(Date.now() / 1000), ...header };
  const head = Buffer.from(JSON.stringify(h)).toString('base64url');
  const body = encryptProfile(payload);
  const signed = `${PREFIX}.${head}.${body}`;
  const sig = crypto.sign(null, Buffer.from(signed), signingKeys().privateKey).toString('base64url');
  return `${signed}.${sig}`;
}

export interface VerifiedEmergencyToken {
  header: EmergencyTokenHeader;
  profile: ClinicalProfile;
  clinicalHash: string;
  /** Recomputed hash matches the one sealed in the token. */
  hashConsistent: boolean;
  expired: boolean;
}

export function verifyEmergencyToken(token: string): VerifiedEmergencyToken {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Not a Smart Tourist emergency token');
  const [prefix, head, body, sig] = parts;
  const ok = crypto.verify(null, Buffer.from(`${prefix}.${head}.${body}`), signingKeys().publicKey, Buffer.from(sig, 'base64url'));
  if (!ok) throw new Error('Signature verification failed — token is forged or altered');

  const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as EmergencyTokenHeader;
  const payload = decryptProfile<{ profile: ClinicalProfile; clinicalHash: string; privateSalt: string }>(body);
  return {
    header,
    profile: payload.profile,
    clinicalHash: payload.clinicalHash,
    hashConsistent: computeClinicalHash(payload.profile, payload.privateSalt) === payload.clinicalHash,
    expired: header.exp * 1000 < Date.now(),
  };
}
