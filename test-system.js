#!/usr/bin/env node

/**
 * Quick system test script to verify the hybrid blockchain-MongoDB system
 */

const http = require('http');
const https = require('https');

const SERVER_URL = 'http://localhost:4000';
const PORTAL_URL = 'http://localhost:3001';

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

async function testEndpoint(name, url, options = {}) {
  try {
    console.log(`Testing ${name}...`);
    const result = await makeRequest(url, options);
    
    if (result.status >= 200 && result.status < 300) {
      console.log(`✅ ${name}: OK (${result.status})`);
      return true;
    } else {
      console.log(`❌ ${name}: Failed (${result.status})`);
      return false;
    }
  } catch (error) {
    console.log(`❌ ${name}: Error - ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Testing Smart Tourist Safety System\n');
  
  const tests = [
    // Server health check
    {
      name: 'Server Health Check',
      url: `${SERVER_URL}/health`
    },
    
    // Dashboard API tests
    {
      name: 'Dashboard Stats API',
      url: `${SERVER_URL}/api/dashboard/stats`
    },
    
    {
      name: 'Dashboard Tourists API',
      url: `${SERVER_URL}/api/dashboard/tourists`
    },
    
    {
      name: 'Dashboard Alerts API',
      url: `${SERVER_URL}/api/dashboard/alerts`
    },
    
    {
      name: 'Dashboard Geo-fences API',
      url: `${SERVER_URL}/api/dashboard/geofences`
    },
    
    // Portal health check
    {
      name: 'Portal Health Check',
      url: `${PORTAL_URL}`
    }
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    const success = await testEndpoint(test.name, test.url, test.options);
    if (success) passed++;
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
  }
  
  console.log('\n📊 Test Results:');
  console.log(`✅ Passed: ${passed}/${total}`);
  console.log(`❌ Failed: ${total - passed}/${total}`);
  
  if (passed === total) {
    console.log('\n🎉 All tests passed! Your system is ready to use.');
    console.log('\n📱 Next steps:');
    console.log('1. Open the mobile app and enter a digital ID');
    console.log('2. Grant location permissions');
    console.log('3. Watch real-time updates on the dashboard');
    console.log('4. Test the emergency panic button');
  } else {
    console.log('\n⚠️  Some tests failed. Please check:');
    console.log('1. Backend server is running on port 4000');
    console.log('2. Portal is running on port 3001');
    console.log('3. MongoDB connection is working');
    console.log('4. All dependencies are installed');
  }
  
  // Test sample data
  console.log('\n🔍 Checking sample data...');
  try {
    const touristsResult = await makeRequest(`${SERVER_URL}/api/dashboard/tourists`);
    const geoFencesResult = await makeRequest(`${SERVER_URL}/api/dashboard/geofences`);
    
    if (touristsResult.data && Array.isArray(touristsResult.data)) {
      console.log(`✅ Found ${touristsResult.data.length} tourists in database`);
    }
    
    if (geoFencesResult.data && Array.isArray(geoFencesResult.data)) {
      console.log(`✅ Found ${geoFencesResult.data.length} geo-fences in database`);
      
      if (geoFencesResult.data.length > 0) {
        console.log('   Sample geo-fences:');
        geoFencesResult.data.slice(0, 3).forEach(gf => {
          console.log(`   - ${gf.name} (${gf.type})`);
        });
      }
    }
  } catch (error) {
    console.log('❌ Could not check sample data');
  }
  
  console.log('\n🌐 System URLs:');
  console.log(`📊 Dashboard: ${PORTAL_URL}/dashboard`);
  console.log(`📝 Registration: ${PORTAL_URL}/register`);
  console.log(`🔧 API Base: ${SERVER_URL}/api`);
  
  console.log('\n📱 Mobile App Setup:');
  console.log('1. Update IP addresses in mobile app files');
  console.log('2. Run: cd smart-tourist-mobile-app && npm start');
  console.log('3. Use sample tourist ID: TID-sample123456');
}

// Run the tests
runTests().catch(console.error);
