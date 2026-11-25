/**
 * Smart Tourist Blockchain Service Test
 * Tests the actual BlockchainService class used in the application
 */

const path = require('path');
require('dotenv').config();

// Import the actual blockchain service
const BlockchainService = require('../src/services/blockchainService').default;

async function testBlockchainService() {
  console.log('🧪 Testing Smart Tourist BlockchainService');
  console.log('==========================================\n');
  
  try {
    // Initialize the service
    console.log('🔄 Initializing BlockchainService...');
    const blockchainService = new BlockchainService();
    
    // Test 1: Create Digital ID
    console.log('\n📝 Test 1: Creating Digital ID...');
    const testKyc = {
      name: 'John Doe',
      passport: 'P123456789',
      nationality: 'India',
      dateOfBirth: '1990-01-01'
    };
    
    const testItinerary = [
      'Delhi - Red Fort',
      'Agra - Taj Mahal', 
      'Jaipur - Hawa Mahal'
    ];
    
    const testEmergencyContacts = [
      '+91-9876543210',
      'john.doe@email.com'
    ];
    
    const digitalId = await blockchainService.createDigitalId(
      testKyc,
      testItinerary,
      testEmergencyContacts
    );
    
    console.log('✅ Digital ID created:', {
      id: digitalId.id,
      blockchainId: digitalId.blockchainId,
      transactionHash: digitalId.transactionHash,
      validUntil: digitalId.validUntil
    });
    
    // Test 2: Update Safety Status
    if (digitalId.blockchainId) {
      console.log('\n🚨 Test 2: Updating Safety Status...');
      const updateResult = await blockchainService.updateSafetyStatus(
        digitalId.blockchainId,
        'Alert' // Change from Normal to Alert
      );
      
      console.log('✅ Safety status updated:', updateResult);
    } else {
      console.log('\n⚠️  Test 2: Skipped (using fallback mode - no blockchain ID)');
    }
    
    // Test 3: Verify Digital ID
    console.log('\n🔍 Test 3: Verifying Digital ID...');
    const verification = await blockchainService.verifyDigitalId(digitalId.id);
    
    console.log('✅ Digital ID verification:', verification);
    
    // Test 4: Get All Digital IDs
    console.log('\n📋 Test 4: Getting All Digital IDs...');
    const allIds = await blockchainService.getAllDigitalIds();
    
    console.log(`✅ Total Digital IDs: ${allIds.length}`);
    allIds.forEach((id, index) => {
      console.log(`   ${index + 1}. ID: ${id.id} | Blockchain ID: ${id.blockchainId || 'Fallback'}`);
    });
    
    console.log('\n🎉 All BlockchainService tests completed successfully!');
    
    // Display service status
    console.log('\n📊 Service Status:');
    console.log(`- Blockchain Connection: ${digitalId.blockchainId ? '✅ Connected' : '⚠️  Fallback Mode'}`);
    console.log(`- Smart Contract: ${digitalId.transactionHash ? '✅ Active' : '⚠️  Not Available'}`);
    console.log(`- Total Registered IDs: ${allIds.length}`);
    
  } catch (error) {
    console.error('❌ BlockchainService test failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Ensure local blockchain is running: npx hardhat node');
    console.log('2. Check .env file has correct configuration');
    console.log('3. Verify smart contract is deployed');
    console.log('4. Check wallet has sufficient test ETH');
  }
}

// Run test if this script is executed directly
if (require.main === module) {
  testBlockchainService();
}

module.exports = testBlockchainService;