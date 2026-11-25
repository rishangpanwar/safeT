/**
 * Direct deployment script using ethers.js
 * Bypasses Hardhat's ESM requirement for testing
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Contract ABI and bytecode would normally come from compilation
// For this test, we'll use a simplified approach

const TOURIST_REGISTRY_CONTRACT = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TouristRegistry {
    enum SafetyStatus { Normal, Alert, Danger }
    
    struct Tourist {
        bytes32 kycHash;
        SafetyStatus status;
        bool isRegistered;
    }
    
    mapping(uint256 => Tourist) public tourists;
    uint256 private _nextTouristId = 1;
    
    event TouristRegistered(uint256 indexed touristId, bytes32 kycHash);
    event SafetyStatusUpdated(uint256 indexed touristId, SafetyStatus newStatus);
    
    function registerTourist(bytes32 _kycHash) public returns (uint256) {
        uint256 touristId = _nextTouristId++;
        tourists[touristId] = Tourist(_kycHash, SafetyStatus.Normal, true);
        emit TouristRegistered(touristId, _kycHash);
        return touristId;
    }
    
    function updateSafetyStatus(uint256 _touristId, SafetyStatus _newStatus) public {
        require(tourists[_touristId].isRegistered, "Tourist not registered");
        tourists[_touristId].status = _newStatus;
        emit SafetyStatusUpdated(_touristId, _newStatus);
    }
    
    function getTouristCount() public view returns (uint256) {
        return _nextTouristId - 1;
    }
}
`;

async function deployDirect() {
  console.log('🚀 Direct Blockchain Deployment (Bypass Hardhat)');
  console.log('================================================\n');
  
  try {
    require('dotenv').config();
    
    // Connect to blockchain
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log('✅ Connected to blockchain');
    console.log(`📍 Wallet: ${wallet.address}`);
    
    // For testing purposes, let's use the contract address that's already in .env
    // and test if we can interact with it, or use fallback mode
    
    const testContractAddress = process.env.CONTRACT_ADDRESS;
    
    if (testContractAddress && testContractAddress !== '') {
      console.log(`🔍 Testing existing contract at: ${testContractAddress}`);
      
      // Simple ABI for testing
      const testABI = [
        "function registerTourist(bytes32 _kycHash) public returns (uint256)",
        "function tourists(uint256) public view returns (bytes32 kycHash, uint8 status, bool isRegistered)",
        "function updateSafetyStatus(uint256 _touristId, uint8 _newStatus) public"
      ];
      
      try {
        const contract = new ethers.Contract(testContractAddress, testABI, wallet);
        
        // Test read operation (this should work even if contract doesn't exist)
        const code = await provider.getCode(testContractAddress);
        
        if (code === '0x') {
          console.log('⚠️  No contract deployed at specified address');
          console.log('💡 Recommendation: Use fallback mode for testing');
          return null;
        } else {
          console.log('✅ Contract found and accessible');
          
          // Test a simple transaction
          const testKycHash = ethers.keccak256(ethers.toUtf8Bytes('test-deployment-verification'));
          
          console.log('🧪 Testing contract interaction...');
          const tx = await contract.registerTourist(testKycHash);
          const receipt = await tx.wait();
          
          console.log(`✅ Test transaction successful: ${receipt.hash}`);
          console.log(`📦 Block: ${receipt.blockNumber}`);
          
          return testContractAddress;
        }
      } catch (error) {
        console.log(`❌ Error testing contract: ${error.message}`);
        console.log('💡 Recommendation: Use fallback mode for testing');
        return null;
      }
    } else {
      console.log('⚠️  No CONTRACT_ADDRESS configured in .env');
      console.log('💡 Recommendation: Use fallback mode for testing');
      return null;
    }
    
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    return null;
  }
}

if (require.main === module) {
  deployDirect()
    .then((address) => {
      if (address) {
        console.log('\n🎉 Contract verification completed!');
        console.log(`📍 Contract address: ${address}`);
        console.log('\n🔄 Next step: Run blockchain service tests');
      } else {
        console.log('\n⚠️  Contract deployment/verification incomplete');
        console.log('💡 The system will use fallback mode (MongoDB-only)');
        console.log('🔄 You can still test the service functionality');
      }
    })
    .catch(console.error);
}

module.exports = deployDirect;