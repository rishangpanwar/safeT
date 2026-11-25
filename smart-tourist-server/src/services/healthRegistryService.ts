import crypto from 'crypto';
import { ethers } from 'ethers';
import { getCollections } from '../config/database';

/**
 * Soulbound health-permit registry (report §2.2-F, Tier 4c).
 *
 * Writes to the TouristHealthRegistry ERC-5192 contract when HEALTH_REGISTRY_ADDRESS,
 * PRIVATE_KEY and BLOCKCHAIN_RPC_URL are configured (local Hardhat node or Polygon Amoy).
 * Otherwise it records permits in a hash-chained MongoDB ledger (`sbtLedger`) so the
 * rest of the system behaves the same; records made that way are labelled
 * network: 'fallback-ledger' and are never presented as on-chain.
 */

const ABI = [
  'function issuePermit(address soul, uint256 tokenId, bytes32 clinicalHash, uint64 validUntil)',
  'function updateClinicalHash(uint256 tokenId, bytes32 clinicalHash)',
  'function updateSafetyStatus(uint256 tokenId, uint8 status)',
  'function verifyClinicalHash(uint256 tokenId, bytes32 clinicalHash) view returns (bool)',
];

export type SbtStatus = 0 | 1 | 2; // Normal, Alert, Danger

export interface PermitRecord {
  network: string; // e.g. 'polygon-amoy (80002)' or 'fallback-ledger'
  contract?: string;
  soul: string;
  txHash: string;
  blockNumber?: number;
  issuedAt: Date;
  validUntil: Date;
}

const toUint = (hexHash: string) => BigInt('0x' + hexHash.replace(/^0x/, ''));
const toBytes32 = (hexHash: string) => '0x' + hexHash.replace(/^0x/, '');

/** Deterministic custodial "soul" address for tourists without a wallet. */
export function soulAddressFor(tokenIdHex: string): string {
  return ethers.getAddress('0x' + ethers.keccak256(toBytes32(tokenIdHex)).slice(-40));
}

class HealthRegistryService {
  private contract: ethers.Contract | null = null;
  private networkLabel = 'fallback-ledger';
  private ready: Promise<void>;

  constructor() {
    this.ready = this.connect();
  }

  private async connect() {
    const address = process.env.HEALTH_REGISTRY_ADDRESS;
    const key = process.env.PRIVATE_KEY;
    if (!address || !key) {
      console.log('[HealthRegistry] HEALTH_REGISTRY_ADDRESS/PRIVATE_KEY not set — using fallback ledger');
      return;
    }
    try {
      const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545');
      const net = await provider.getNetwork();
      this.contract = new ethers.Contract(address, ABI, new ethers.Wallet(key, provider));
      this.networkLabel = `${net.chainId === 80002n ? 'polygon-amoy' : net.name} (${net.chainId})`;
      console.log(`[HealthRegistry] Connected to TouristHealthRegistry at ${address} on ${this.networkLabel}`);
    } catch (error) {
      console.warn('[HealthRegistry] Chain unreachable — using fallback ledger:', (error as Error).message);
      this.contract = null;
    }
  }

  async status() {
    await this.ready;
    return { onChain: !!this.contract, network: this.networkLabel, contract: process.env.HEALTH_REGISTRY_ADDRESS || null };
  }

  async issuePermit(tokenIdHex: string, clinicalHashHex: string, validUntil: Date): Promise<PermitRecord> {
    await this.ready;
    const soul = soulAddressFor(tokenIdHex);
    const issuedAt = new Date();

    if (this.contract) {
      try {
        const tx = await this.contract.issuePermit(soul, toUint(tokenIdHex), toBytes32(clinicalHashHex), BigInt(Math.floor(validUntil.getTime() / 1000)));
        const receipt = await tx.wait();
        return { network: this.networkLabel, contract: await this.contract.getAddress(), soul, txHash: receipt.hash, blockNumber: receipt.blockNumber, issuedAt, validUntil };
      } catch (error) {
        console.error('[HealthRegistry] On-chain mint failed, recording in fallback ledger:', (error as Error).message);
      }
    }
    return this.appendLedger({ op: 'issuePermit', tokenId: tokenIdHex, clinicalHash: clinicalHashHex, soul, validUntil, issuedAt });
  }

  async updateSafetyStatus(tokenIdHex: string, status: SbtStatus): Promise<void> {
    await this.ready;
    if (this.contract) {
      try {
        await (await this.contract.updateSafetyStatus(toUint(tokenIdHex), status)).wait();
        return;
      } catch (error) {
        console.error('[HealthRegistry] On-chain status update failed:', (error as Error).message);
      }
    }
    await this.appendLedger({ op: 'updateSafetyStatus', tokenId: tokenIdHex, status, issuedAt: new Date() });
  }

  /** First-responder integrity check of the hash sealed inside an emergency QR token. */
  async verifyClinicalHash(tokenIdHex: string, clinicalHashHex: string): Promise<{ verified: boolean; source: string }> {
    await this.ready;
    if (this.contract) {
      try {
        const ok: boolean = await this.contract.verifyClinicalHash(toUint(tokenIdHex), toBytes32(clinicalHashHex));
        return { verified: ok, source: this.networkLabel };
      } catch (error) {
        console.error('[HealthRegistry] On-chain verify failed:', (error as Error).message);
      }
    }
    const { sbtLedger } = await getCollections();
    const permit = await sbtLedger.findOne({ op: 'issuePermit', tokenId: tokenIdHex }, { sort: { seq: -1 } });
    const live = !!permit && new Date(permit.validUntil) >= new Date();
    return { verified: live && permit!.clinicalHash === clinicalHashHex, source: 'fallback-ledger' };
  }

  /** Append-only ledger where each record commits to the previous one's hash. */
  private async appendLedger(entry: Record<string, any>): Promise<PermitRecord> {
    const { sbtLedger } = await getCollections();
    const prev = await sbtLedger.findOne({}, { sort: { seq: -1 } });
    const seq = (prev?.seq ?? 0) + 1;
    const txHash = '0x' + crypto.createHash('sha256').update(JSON.stringify({ ...entry, seq, prevHash: prev?.txHash ?? null })).digest('hex');
    await sbtLedger.insertOne({ ...entry, seq, prevHash: prev?.txHash ?? null, txHash, recordedAt: new Date() });
    return { network: 'fallback-ledger', soul: entry.soul, txHash, blockNumber: seq, issuedAt: entry.issuedAt, validUntil: entry.validUntil };
  }
}

const healthRegistryService = new HealthRegistryService();
export default healthRegistryService;
