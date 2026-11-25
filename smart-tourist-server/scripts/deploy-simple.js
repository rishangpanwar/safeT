/**
 * Simple deployment script for TouristRegistry contract
 * Compatible with CommonJS module system
 */

const { ethers } = require('hardhat');

async function main() {
  console.log('🚀 Deploying TouristRegistry contract...');
  
  // Get the contract factory
  const TouristRegistry = await ethers.getContractFactory('TouristRegistry');
  
  // Deploy the contract
  console.log('📦 Deploying contract...');
  const touristRegistry = await TouristRegistry.deploy();
  
  // Wait for deployment to be mined
  await touristRegistry.waitForDeployment();
  
  const contractAddress = await touristRegistry.getAddress();
  
  console.log('✅ TouristRegistry deployed successfully!');
  console.log(`📍 Contract address: ${contractAddress}`);
  console.log(`🔗 Transaction hash: ${touristRegistry.deploymentTransaction()?.hash}`);
  
  // Test basic functionality
  console.log('\n🧪 Testing basic contract functionality...');
  
  // Test registering a tourist
  const testKycHash = ethers.keccak256(ethers.toUtf8Bytes('test-kyc-data'));
  const registerTx = await touristRegistry.registerTourist(testKycHash);
  const receipt = await registerTx.wait();
  
  console.log('✅ Test registration successful');
  console.log(`📋 Tourist registered in block: ${receipt.blockNumber}`);
  
  // Get the tourist data
  const touristData = await touristRegistry.tourists(1);
  console.log('✅ Test data retrieval successful');
  console.log(`📊 Tourist data: KYC Hash: ${touristData.kycHash}, Status: ${touristData.status}, Registered: ${touristData.isRegistered}`);
  
  console.log('\n📝 Update your .env file with the contract address:');
  console.log(`CONTRACT_ADDRESS=${contractAddress}`);
  
  return contractAddress;
}

// Execute deployment
if (require.main === module) {
  main()
    .then((address) => {
      console.log(`\n🎉 Deployment completed successfully!`);
      console.log(`Contract address: ${address}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Deployment failed:', error);
      process.exit(1);
    });
}

module.exports = main;