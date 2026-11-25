/**
 * Comprehensive Blockchain Testing Script for Smart Tourist System
 * This script verifies all blockchain functionalities including:
 * - Local blockchain connection
 * - Smart contract deployment and interaction
 * - Tourist registration on blockchain
 * - Safety status updates
 * - Event listening and verification
 */

const { ethers } = require('ethers');
require('dotenv').config();

// Configuration
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Smart Contract ABI
const TOURIST_REGISTRY_ABI = [
  "function registerTourist(bytes32 _kycHash) public returns (uint256)",
  "function updateSafetyStatus(uint256 _touristId, uint8 _newStatus) public",
  "function tourists(uint256) public view returns (bytes32 kycHash, uint8 status, bool isRegistered)",
  "function getTouristCount() public view returns (uint256)",
  "event TouristRegistered(uint256 indexed touristId, bytes32 kycHash)",
  "event SafetyStatusUpdated(uint256 indexed touristId, uint8 newStatus)"
];

class BlockchainTester {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.contract = null;
    this.testResults = {
      connection: false,
      contractDeployed: false,
      touristRegistration: false,
      safetyStatusUpdate: false,
      eventListening: false,
      dataRetrieval: false
    };
  }

  async runAllTests() {
    console.log('🚀 Starting Comprehensive Blockchain Tests for Smart Tourist System\n');
    
    try {
      await this.testBlockchainConnection();
      await this.testContractConnection();
      await this.testTouristRegistration();
      await this.testSafetyStatusUpdate();
      await this.testEventListening();
      await this.testDataRetrieval();
      
      this.displayResults();
    } catch (error) {
      console.error('❌ Fatal error during testing:', error.message);
      this.displayResults();
    }
  }

  async testBlockchainConnection() {
    console.log('🔍 Testing Blockchain Connection...');
    
    try {
      // Test provider connection
      this.provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      console.log(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
      console.log(`✅ Current block number: ${blockNumber}`);
      
      // Test wallet creation
      if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY not configured in .env file');
      }
      
      this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
      const balance = await this.provider.getBalance(this.wallet.address);
      
      console.log(`✅ Wallet address: ${this.wallet.address}`);
      console.log(`✅ Wallet balance: ${ethers.formatEther(balance)} ETH`);
      
      if (balance === 0n) {
        console.warn('⚠️  Warning: Wallet balance is 0 ETH. You may need test funds.');
      }
      
      this.testResults.connection = true;
      console.log('✅ Blockchain connection test PASSED\n');
      
    } catch (error) {
      console.error('❌ Blockchain connection test FAILED:', error.message);
      throw error;
    }
  }

  async testContractConnection() {
    console.log('🔍 Testing Smart Contract Connection...');
    
    try {
      if (!CONTRACT_ADDRESS) {
        throw new Error('CONTRACT_ADDRESS not configured in .env file');
      }
      
      this.contract = new ethers.Contract(CONTRACT_ADDRESS, TOURIST_REGISTRY_ABI, this.wallet);
      
      // Test contract code exists
      const code = await this.provider.getCode(CONTRACT_ADDRESS);
      if (code === '0x') {
        throw new Error('No contract deployed at the specified address');
      }
      
      console.log(`✅ Contract found at address: ${CONTRACT_ADDRESS}`);
      console.log(`✅ Contract code length: ${code.length} characters`);
      
      // Test a simple read operation
      try {
        const touristCount = await this.contract.getTouristCount();
        console.log(`✅ Current tourist count: ${touristCount.toString()}`);
      } catch (error) {
        console.log('ℹ️  Note: getTouristCount() method may not be implemented');
      }
      
      this.testResults.contractDeployed = true;
      console.log('✅ Smart contract connection test PASSED\n');
      
    } catch (error) {
      console.error('❌ Smart contract connection test FAILED:', error.message);
      throw error;
    }
  }

  async testTouristRegistration() {
    console.log('🔍 Testing Tourist Registration...');
    
    try {
      // Generate test KYC hash
      const testKyc = {
        name: 'Test Tourist',
        passport: 'T12345678',
        timestamp: Date.now()
      };
      const kycHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(testKyc)));
      
      console.log(`ℹ️  Registering tourist with KYC hash: ${kycHash}`);
      
      // Call registerTourist function
      const tx = await this.contract.registerTourist(kycHash);
      console.log(`ℹ️  Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      console.log(`✅ Transaction mined in block: ${receipt.blockNumber}`);
      
      // Find the TouristRegistered event
      const registrationEvent = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === 'TouristRegistered';
        } catch {
          return false;
        }
      });
      
      if (registrationEvent) {
        const parsed = this.contract.interface.parseLog(registrationEvent);
        const touristId = parsed.args.touristId;
        console.log(`✅ Tourist registered with ID: ${touristId.toString()}`);
        
        // Store for later tests
        this.testTouristId = touristId;
        this.testKycHash = kycHash;
      } else {
        throw new Error('TouristRegistered event not found in transaction logs');
      }
      
      this.testResults.touristRegistration = true;
      console.log('✅ Tourist registration test PASSED\n');
      
    } catch (error) {
      console.error('❌ Tourist registration test FAILED:', error.message);
      throw error;
    }
  }

  async testSafetyStatusUpdate() {
    console.log('🔍 Testing Safety Status Update...');
    
    try {
      if (!this.testTouristId) {
        throw new Error('No test tourist ID available from previous test');
      }
      
      // Update safety status to Alert (1)
      console.log(`ℹ️  Updating safety status for tourist ID: ${this.testTouristId.toString()}`);
      
      const tx = await this.contract.updateSafetyStatus(this.testTouristId, 1); // 1 = Alert
      console.log(`ℹ️  Transaction submitted: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`✅ Transaction mined in block: ${receipt.blockNumber}`);
      
      // Find the SafetyStatusUpdated event
      const statusEvent = receipt.logs.find(log => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed.name === 'SafetyStatusUpdated';
        } catch {
          return false;
        }
      });
      
      if (statusEvent) {
        const parsed = this.contract.interface.parseLog(statusEvent);
        const touristId = parsed.args.touristId;
        const newStatus = parsed.args.newStatus;
        console.log(`✅ Safety status updated for tourist ${touristId.toString()} to status: ${newStatus}`);
      } else {
        throw new Error('SafetyStatusUpdated event not found in transaction logs');
      }
      
      this.testResults.safetyStatusUpdate = true;
      console.log('✅ Safety status update test PASSED\n');
      
    } catch (error) {
      console.error('❌ Safety status update test FAILED:', error.message);
      throw error;
    }
  }

  async testEventListening() {
    console.log('🔍 Testing Event Listening...');
    
    try {
      let eventReceived = false;
      
      // Set up event listener
      const eventPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Event listening timeout'));
        }, 10000); // 10 second timeout
        
        this.contract.on('TouristRegistered', (touristId, kycHash, event) => {
          clearTimeout(timeout);
          console.log(`✅ Event received - Tourist ID: ${touristId.toString()}, KYC Hash: ${kycHash}`);
          eventReceived = true;
          resolve(event);
        });
      });
      
      // Register another tourist to trigger event
      const testKyc2 = {
        name: 'Test Tourist 2',
        passport: 'T87654321',
        timestamp: Date.now()
      };
      const kycHash2 = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(testKyc2)));
      
      console.log('ℹ️  Registering another tourist to test event listening...');
      const tx = await this.contract.registerTourist(kycHash2);
      
      // Wait for event
      await eventPromise;
      
      // Clean up event listener
      this.contract.removeAllListeners('TouristRegistered');
      
      this.testResults.eventListening = true;
      console.log('✅ Event listening test PASSED\n');
      
    } catch (error) {
      console.error('❌ Event listening test FAILED:', error.message);
      this.contract.removeAllListeners();
    }
  }

  async testDataRetrieval() {
    console.log('🔍 Testing Data Retrieval...');
    
    try {
      if (!this.testTouristId) {
        throw new Error('No test tourist ID available from previous test');
      }
      
      // Retrieve tourist data
      const touristData = await this.contract.tourists(this.testTouristId);
      
      console.log(`✅ Retrieved tourist data:`);
      console.log(`   - KYC Hash: ${touristData.kycHash}`);
      console.log(`   - Safety Status: ${touristData.status}`);
      console.log(`   - Is Registered: ${touristData.isRegistered}`);
      
      // Verify data integrity
      if (touristData.kycHash !== this.testKycHash) {
        throw new Error('KYC hash mismatch');
      }
      
      if (!touristData.isRegistered) {
        throw new Error('Tourist should be registered');
      }
      
      if (touristData.status !== 1n) { // Should be Alert status from previous test
        console.warn(`⚠️  Expected status 1 (Alert), got ${touristData.status}`);
      }
      
      this.testResults.dataRetrieval = true;
      console.log('✅ Data retrieval test PASSED\n');
      
    } catch (error) {
      console.error('❌ Data retrieval test FAILED:', error.message);
    }
  }

  displayResults() {
    console.log('📊 BLOCKCHAIN TEST RESULTS SUMMARY');
    console.log('=====================================');
    
    const tests = [
      { name: 'Blockchain Connection', passed: this.testResults.connection },
      { name: 'Smart Contract Deployment', passed: this.testResults.contractDeployed },
      { name: 'Tourist Registration', passed: this.testResults.touristRegistration },
      { name: 'Safety Status Update', passed: this.testResults.safetyStatusUpdate },
      { name: 'Event Listening', passed: this.testResults.eventListening },
      { name: 'Data Retrieval', passed: this.testResults.dataRetrieval }
    ];
    
    let passedCount = 0;
    tests.forEach(test => {
      const status = test.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${test.name}`);
      if (test.passed) passedCount++;
    });
    
    console.log('=====================================');
    console.log(`Tests Passed: ${passedCount}/${tests.length}`);
    
    if (passedCount === tests.length) {
      console.log('🎉 ALL BLOCKCHAIN TESTS PASSED! Your blockchain integration is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Please check the configuration and try again.');
    }
    
    console.log('\n📝 Troubleshooting Tips:');
    console.log('- Ensure Hardhat local blockchain is running: npx hardhat node');
    console.log('- Verify .env file has correct BLOCKCHAIN_RPC_URL, PRIVATE_KEY, and CONTRACT_ADDRESS');
    console.log('- Deploy contract if needed: npx hardhat run scripts/deploy.ts --network localhost');
    console.log('- Check wallet has sufficient test ETH for transactions');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new BlockchainTester();
  tester.runAllTests().catch(console.error);
}

module.exports = BlockchainTester;