#!/usr/bin/env node

/**
 * Blockchain Health Check Script
 * Quickly verifies if blockchain components are ready
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BlockchainHealthCheck {
  constructor() {
    this.checks = [];
  }

  async runCheck(name, checkFn) {
    try {
      const result = await checkFn();
      this.checks.push({ name, status: 'PASS', details: result });
      console.log(`✅ ${name}: PASS`);
      if (result) console.log(`   ${result}`);
    } catch (error) {
      this.checks.push({ name, status: 'FAIL', error: error.message });
      console.log(`❌ ${name}: FAIL`);
      console.log(`   Error: ${error.message}`);
    }
  }

  async checkNodeVersion() {
    return new Promise((resolve, reject) => {
      exec('node --version', (error, stdout) => {
        if (error) reject(error);
        else {
          const version = stdout.trim();
          const majorVersion = parseInt(version.substring(1).split('.')[0]);
          if (majorVersion >= 16) {
            resolve(`Node.js ${version} (compatible)`);
          } else {
            reject(new Error(`Node.js ${version} is too old. Minimum v16 required.`));
          }
        }
      });
    });
  }

  async checkHardhat() {
    return new Promise((resolve, reject) => {
      exec('npx hardhat --version', (error, stdout) => {
        if (error) reject(new Error('Hardhat not installed'));
        else resolve(`Hardhat ${stdout.trim()}`);
      });
    });
  }

  async checkPackageJson() {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!fs.existsSync(packagePath)) {
      throw new Error('package.json not found');
    }
    
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const requiredDeps = ['ethers', 'hardhat'];
    const missing = requiredDeps.filter(dep => 
      !packageData.dependencies?.[dep] && !packageData.devDependencies?.[dep]
    );
    
    if (missing.length > 0) {
      throw new Error(`Missing dependencies: ${missing.join(', ')}`);
    }
    
    return 'All required blockchain dependencies found';
  }

  async checkEnvFile() {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      throw new Error('.env file not found');
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    const requiredVars = [
      'BLOCKCHAIN_RPC_URL',
      'PRIVATE_KEY'
    ];
    
    const missing = requiredVars.filter(varName => 
      !envContent.includes(`${varName}=`) || 
      envContent.includes(`${varName}=\n`) ||
      envContent.includes(`${varName}=""`)
    );
    
    if (missing.length > 0) {
      throw new Error(`Missing or empty variables: ${missing.join(', ')}`);
    }
    
    return 'Environment variables configured';
  }

  async checkBlockchainConnection() {
    const { ethers } = require('ethers');
    require('dotenv').config();
    
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
    if (!rpcUrl) {
      throw new Error('BLOCKCHAIN_RPC_URL not configured');
    }
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const blockNumber = await provider.getBlockNumber();
      return `Connected to blockchain (Block: ${blockNumber})`;
    } catch (error) {
      throw new Error(`Cannot connect to ${rpcUrl}: ${error.message}`);
    }
  }

  async checkContract() {
    const { ethers } = require('ethers');
    require('dotenv').config();
    
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error('CONTRACT_ADDRESS not configured');
    }
    
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const code = await provider.getCode(contractAddress);
    
    if (code === '0x') {
      throw new Error(`No contract deployed at ${contractAddress}`);
    }
    
    return `Smart contract found at ${contractAddress}`;
  }

  async checkWallet() {
    const { ethers } = require('ethers');
    require('dotenv').config();
    
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY not configured');
    }
    
    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    
    return `Wallet ${wallet.address} (Balance: ${ethers.formatEther(balance)} ETH)`;
  }

  async runAllChecks() {
    console.log('🏥 Smart Tourist Blockchain Health Check');
    console.log('========================================\n');
    
    await this.runCheck('Node.js Version', () => this.checkNodeVersion());
    await this.runCheck('Package Dependencies', () => this.checkPackageJson());
    await this.runCheck('Hardhat Installation', () => this.checkHardhat());
    await this.runCheck('Environment Configuration', () => this.checkEnvFile());
    await this.runCheck('Blockchain Connection', () => this.checkBlockchainConnection());
    await this.runCheck('Smart Contract', () => this.checkContract());
    await this.runCheck('Wallet Configuration', () => this.checkWallet());
    
    this.displaySummary();
  }

  displaySummary() {
    console.log('\n📊 HEALTH CHECK SUMMARY');
    console.log('========================');
    
    const passed = this.checks.filter(c => c.status === 'PASS').length;
    const total = this.checks.length;
    
    console.log(`Tests Passed: ${passed}/${total}`);
    
    if (passed === total) {
      console.log('🎉 ALL CHECKS PASSED! Blockchain is ready to use.');
      console.log('\n🚀 Next steps:');
      console.log('1. Test blockchain service: node scripts/test-service.js');
      console.log('2. Run comprehensive tests: node scripts/test-blockchain.js');
      console.log('3. Start your server: npm run dev');
    } else {
      console.log('⚠️  Some checks failed. Please fix the issues above.');
      console.log('\n🔧 Quick fixes:');
      console.log('- Install missing dependencies: npm install');
      console.log('- Start local blockchain: npx hardhat node');
      console.log('- Deploy contract: npx hardhat run scripts/deploy.ts --network localhost');
    }
  }
}

// Run health check if this script is executed directly
if (require.main === module) {
  const healthCheck = new BlockchainHealthCheck();
  healthCheck.runAllChecks().catch(console.error);
}

module.exports = BlockchainHealthCheck;