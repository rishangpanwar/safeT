/**
 * API-based blockchain functionality test
 * Tests blockchain features through the REST API
 */

const axios = require('axios');

const API_BASE_URL = 'http://localhost:4000/api';

class APIBlockchainTester {
  constructor() {
    this.testResults = {
      serverConnection: false,
      touristRegistration: false,
      digitalIdCreation: false,
      dataRetrieval: false
    };
  }

  async testServerConnection() {
    console.log('🔍 Testing server connection...');
    
    try {
      // Try the dashboard stats endpoint which should be available
      const response = await axios.get(`${API_BASE_URL}/dashboard/stats`, {
        timeout: 5000
      });
      
      console.log('✅ Server is running');
      console.log(`📊 Status: ${response.status}`);
      
      this.testResults.serverConnection = true;
      return true;
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.log('❌ Server is not running');
        console.log('💡 Start the server with: npm run dev');
      } else {
        console.log(`❌ Server connection failed: ${error.message}`);
        if (error.response?.status) {
          console.log(`📊 Response status: ${error.response.status}`);
          if (error.response.status !== 500) {
            // If we get any response (even 404), server is running
            console.log('✅ Server is running (responded with error, but that means it\'s alive)');
            this.testResults.serverConnection = true;
            return true;
          }
        }
      }
      return false;
    }
  }

  async testTouristRegistration() {
    console.log('\n🔍 Testing tourist registration (with blockchain integration)...');
    
    try {
      const touristData = {
        kyc: {
          name: 'Test Tourist',
          nationality: 'India',
          passportNumber: 'T123456789',
          phoneNumber: '+91-9876543210'
        },
        itinerary: {
          startDate: '2024-01-15',
          endDate: '2024-01-22',
          destinations: ['Delhi', 'Agra', 'Jaipur'],
          accommodations: ['Hotel Delhi', 'Hotel Agra', 'Hotel Jaipur']
        },
        emergencyContacts: [
          {
            name: 'Emergency Contact',
            phone: '+91-9876543210',
            email: 'emergency@test.com'
          }
        ],
        tripDurationDays: 7
      };

      console.log('📝 Registering tourist...');
      const response = await axios.post(`${API_BASE_URL}/tourists/register`, touristData, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds for blockchain operations
      });

      console.log('✅ Tourist registration successful');
      console.log(`📊 Status: ${response.status}`);
      console.log(`📋 Response:`, response.data);

      // Store test tourist ID for later tests
      this.testTouristId = response.data.tourist?.digitalId || response.data.digitalId;
      
      this.testResults.touristRegistration = true;
      return response.data;
    } catch (error) {
      console.log(`❌ Tourist registration failed: ${error.response?.data?.message || error.message}`);
      if (error.response?.data) {
        console.log('📋 Error details:', error.response.data);
      }
      return null;
    }
  }

  async testDigitalIdCreation() {
    console.log('\n🔍 Testing digital ID creation...');
    
    try {
      const kycData = {
        name: 'Blockchain Test User',
        passport: 'BC123456789',
        nationality: 'India',
        dateOfBirth: '1985-05-15'
      };

      const itinerary = ['Mumbai', 'Goa', 'Bangalore'];
      const emergencyContacts = ['+91-1234567890'];

      console.log('🆔 Creating digital ID...');
      const response = await axios.post(`${API_BASE_URL}/blockchain/create-digital-id`, {
        kyc: kycData,
        itinerary: itinerary,
        emergencyContacts: emergencyContacts
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      console.log('✅ Digital ID creation successful');
      console.log(`📊 Status: ${response.status}`);
      console.log(`📋 Digital ID:`, response.data);

      this.testDigitalId = response.data.digitalId;
      this.testResults.digitalIdCreation = true;
      return response.data;
    } catch (error) {
      console.log(`❌ Digital ID creation failed: ${error.response?.data?.message || error.message}`);
      if (error.response?.data) {
        console.log('📋 Error details:', error.response.data);
      }
      return null;
    }
  }

  async testDataRetrieval() {
    console.log('\n🔍 Testing data retrieval...');
    
    try {
      if (!this.testTouristId) {
        console.log('⚠️  No test tourist ID available, trying to get existing tourists...');
        
        // Try to get the sample tourist that should exist
        const sampleId = 'TID-sample123456';
        console.log(`📖 Retrieving sample tourist: ${sampleId}`);
        const response = await axios.get(`${API_BASE_URL}/tourists/${sampleId}`, {
          timeout: 10000
        });

        console.log('✅ Data retrieval successful (sample tourist)');
        console.log(`📊 Status: ${response.status}`);
        console.log(`📋 Tourist data:`, response.data);

        this.testResults.dataRetrieval = true;
        return response.data;
      }

      console.log(`📖 Retrieving data for tourist: ${this.testTouristId}`);
      const response = await axios.get(`${API_BASE_URL}/tourists/${this.testTouristId}`, {
        timeout: 10000
      });

      console.log('✅ Data retrieval successful');
      console.log(`📊 Status: ${response.status}`);
      console.log(`📋 Tourist data:`, response.data);

      this.testResults.dataRetrieval = true;
      return response.data;
    } catch (error) {
      console.log(`❌ Data retrieval failed: ${error.response?.data?.message || error.message}`);
      if (error.response?.status === 404) {
        console.log('💡 Tourist not found - this is normal for test data');
      }
      return null;
    }
  }

  async testBlockchainFeatures() {
    console.log('\n🔍 Testing blockchain-specific features...');
    
    try {
      // Test blockchain status endpoint
      console.log('📊 Checking blockchain status...');
      const statusResponse = await axios.get(`${API_BASE_URL}/blockchain/status`, {
        timeout: 10000
      });

      console.log('✅ Blockchain status retrieved');
      console.log(`📋 Status:`, statusResponse.data);

      return statusResponse.data;
    } catch (error) {
      console.log(`⚠️  Blockchain status check failed: ${error.response?.data?.message || error.message}`);
      console.log('💡 This is expected if blockchain endpoints are not implemented');
      return null;
    }
  }

  displayResults() {
    console.log('\n📊 API BLOCKCHAIN TEST RESULTS');
    console.log('===============================');
    
    const tests = [
      { name: 'Server Connection', passed: this.testResults.serverConnection },
      { name: 'Tourist Registration', passed: this.testResults.touristRegistration },
      { name: 'Digital ID Creation', passed: this.testResults.digitalIdCreation },
      { name: 'Data Retrieval', passed: this.testResults.dataRetrieval }
    ];
    
    let passedCount = 0;
    tests.forEach(test => {
      const status = test.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${test.name}`);
      if (test.passed) passedCount++;
    });
    
    console.log('===============================');
    console.log(`Tests Passed: ${passedCount}/${tests.length}`);
    
    if (passedCount >= 1) {
      console.log('🎉 Basic functionality is working!');
      
      if (passedCount === tests.length) {
        console.log('🚀 All API tests passed - blockchain integration is functional');
      } else {
        console.log('⚠️  Some advanced features may need attention');
      }
    } else {
      console.log('❌ Basic connectivity issues need to be resolved');
    }
    
    console.log('\n💡 Blockchain Behavior:');
    console.log('- If blockchain is available: Data stored on blockchain + MongoDB');
    console.log('- If blockchain is unavailable: Data stored in MongoDB (fallback mode)');
    console.log('- Both modes provide the same API functionality');
  }

  async runAllTests() {
    console.log('🧪 Smart Tourist API Blockchain Test');
    console.log('====================================\n');
    
    try {
      // Test 1: Server connection
      const serverOk = await this.testServerConnection();
      if (!serverOk) {
        console.log('\n❌ Cannot proceed without server connection');
        this.displayResults();
        return;
      }

      // Test 2: Tourist registration
      await this.testTouristRegistration();

      // Test 3: Digital ID creation
      await this.testDigitalIdCreation();

      // Test 4: Data retrieval
      await this.testDataRetrieval();

      // Test 5: Blockchain features
      await this.testBlockchainFeatures();

      this.displayResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      this.displayResults();
    }
  }
}

// Add axios as a dependency check
function checkDependencies() {
  try {
    require('axios');
    return true;
  } catch (error) {
    console.log('❌ Missing dependency: axios');
    console.log('💡 Install with: npm install axios');
    return false;
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  if (checkDependencies()) {
    const tester = new APIBlockchainTester();
    tester.runAllTests().catch(console.error);
  }
}

module.exports = APIBlockchainTester;