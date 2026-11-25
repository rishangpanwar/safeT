import { createHash } from "crypto";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Interface for Digital ID data structure
interface DigitalId {
  id: string;
  blockchainId?: number;
  kycHash: string;
  itinerary: string[];
  emergencyContacts: string[];
  validUntil: Date;
  issuedAt: Date;
  transactionHash?: string;
}

// Tourist Registry Smart Contract ABI
const TOURIST_REGISTRY_ABI = [
  "function registerTourist(bytes32 _kycHash) public returns (uint256)",
  "function updateSafetyStatus(uint256 _touristId, uint8 _newStatus) public",
  "function tourists(uint256) public view returns (bytes32 kycHash, uint8 status, bool isRegistered)",
  "event TouristRegistered(uint256 indexed touristId, bytes32 kycHash)",
  "event SafetyStatusUpdated(uint256 indexed touristId, uint8 newStatus)"
];

export enum SafetyStatus {
  Normal = 0,
  Alert = 1,
  Danger = 2
}

class BlockchainService {
  private provider?: ethers.JsonRpcProvider;
  private wallet!: ethers.Wallet; // Definite assignment assertion
  private contract: ethers.Contract | null = null;
  private fallbackLedger: Map<string, DigitalId> = new Map(); // Fallback for when blockchain is unavailable

  constructor() {
    // Initialize provider and wallet
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
      console.warn("[Blockchain] No private key provided, using fallback mode");
    }

    if (privateKey) {
      // Only connect when a key is configured: an unused provider retries the RPC URL forever.
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.initializeContract();
    }
  }

  private async initializeContract() {
    try {
      const contractAddress = process.env.CONTRACT_ADDRESS;
      if (contractAddress && contractAddress !== "") {
        this.contract = new ethers.Contract(contractAddress, TOURIST_REGISTRY_ABI, this.wallet);
        console.log(`[Blockchain] Connected to contract at ${contractAddress}`);
      } else {
        console.warn("[Blockchain] No contract address provided, using fallback mode");
      }
    } catch (error) {
      console.error("[Blockchain] Failed to initialize contract:", error);
    }
  }

  // Create a digital ID with hybrid blockchain-MongoDB approach
  public async createDigitalId(
    kycData: Record<string, any>,
    itinerary: string[],
    emergencyContacts: string[],
    durationInDays: number
  ): Promise<DigitalId> {
    try {
      // 1. Create hash of KYC data for blockchain storage
      const kycString = JSON.stringify(kycData);
      const kycHash = createHash("sha256").update(kycString).digest("hex");
      const kycHashBytes32 = "0x" + kycHash;

      // 2. Generate unique ID for MongoDB
      const uniqueId = `TID-${createHash("sha256")
        .update(kycHash + Date.now())
        .digest("hex")
        .substring(0, 12)}`;

      // 3. Set validity period
      const issuedAt = new Date();
      const validUntil = new Date();
      validUntil.setDate(issuedAt.getDate() + durationInDays);

      let blockchainId: number | undefined;
      let transactionHash: string | undefined;

      // 4. Try to register on blockchain
      if (this.contract && this.wallet) {
        try {
          console.log("[Blockchain] Registering tourist on blockchain...");
          const tx = await this.contract.registerTourist(kycHashBytes32);
          const receipt = await tx.wait();

          // Extract tourist ID from event logs
          const event = receipt.logs.find((log: any) => {
            try {
              const parsed = this.contract!.interface.parseLog(log);
              return parsed && parsed.name === 'TouristRegistered';
            } catch {
              return false;
            }
          });

          if (event) {
            const parsed = this.contract.interface.parseLog(event);
            if (parsed && parsed.args) {
              blockchainId = Number(parsed.args.touristId);
              transactionHash = receipt.hash;
              console.log(`[Blockchain] Tourist registered with blockchain ID: ${blockchainId}`);
            }
          }
        } catch (blockchainError) {
          console.error("[Blockchain] Failed to register on blockchain, using fallback:", blockchainError);
        }
      }

      // 5. Create digital ID object
      const digitalId: DigitalId = {
        id: uniqueId,
        blockchainId,
        kycHash,
        itinerary,
        emergencyContacts,
        validUntil,
        issuedAt,
        transactionHash,
      };

      // 6. Store in fallback ledger for quick access
      this.fallbackLedger.set(uniqueId, digitalId);

      console.log(`[Blockchain] Created digital ID: ${uniqueId}${blockchainId ? ` (Blockchain ID: ${blockchainId})` : ' (Fallback mode)'}`);
      return digitalId;

    } catch (error) {
      console.error("[Blockchain] Failed to create digital ID:", error);
      throw new Error("Failed to create digital ID");
    }
  }

  // Update safety status on blockchain
  public async updateSafetyStatus(digitalId: string, status: SafetyStatus): Promise<boolean> {
    try {
      const storedId = this.fallbackLedger.get(digitalId);
      if (!storedId || !storedId.blockchainId) {
        console.warn(`[Blockchain] No blockchain ID found for ${digitalId}, skipping blockchain update`);
        return false;
      }

      if (this.contract && this.wallet) {
        console.log(`[Blockchain] Updating safety status for blockchain ID ${storedId.blockchainId} to ${SafetyStatus[status]}`);
        const tx = await this.contract.updateSafetyStatus(storedId.blockchainId, status);
        await tx.wait();
        console.log(`[Blockchain] Safety status updated successfully`);
        return true;
      }

      return false;
    } catch (error) {
      console.error("[Blockchain] Failed to update safety status:", error);
      return false;
    }
  }

  // Get digital ID from fallback ledger
  public getDigitalId(id: string): DigitalId | undefined {
    return this.fallbackLedger.get(id);
  }

  // Verify digital ID on blockchain
  public async verifyDigitalId(digitalId: string): Promise<boolean> {
    try {
      const storedId = this.fallbackLedger.get(digitalId);
      if (!storedId || !storedId.blockchainId) {
        return false;
      }

      if (this.contract) {
        const result = await this.contract.tourists(storedId.blockchainId);
        return result.isRegistered && result.kycHash === "0x" + storedId.kycHash;
      }

      return false;
    } catch (error) {
      console.error("[Blockchain] Failed to verify digital ID:", error);
      return false;
    }
  }

  // Check if blockchain is available
  public async isBlockchainAvailable(): Promise<boolean> {
    try {
      if (!this.provider) return false;
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  // Deploy contract (for development)
  public async deployContract(): Promise<string | null> {
    try {
      if (!this.wallet) {
        throw new Error("Wallet not initialized");
      }

      // This would be used to deploy the contract if needed
      // For now, we'll assume the contract is already deployed
      console.log("[Blockchain] Contract deployment not implemented in this version");
      return null;
    } catch (error) {
      console.error("[Blockchain] Failed to deploy contract:", error);
      return null;
    }
  }
}

// Export singleton instance
const blockchainService = new BlockchainService();
export default blockchainService;
export { BlockchainService, DigitalId };


