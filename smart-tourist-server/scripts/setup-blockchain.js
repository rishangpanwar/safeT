#!/usr/bin/env node

/**
 * Blockchain Setup Script for Smart Tourist System
 * This script helps set up the local blockchain environment
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class BlockchainSetup {
  constructor() {
    this.processes = [];
  }

  async checkHardhatInstallation() {
    console.log('🔍 Checking Hardhat installation...');
    
    return new Promise((resolve) => {
      exec('npx hardhat --version', (error, stdout, stderr) => {
        if (error) {
          console.log('❌ Hardhat not found. Installing Hardhat...');
          this.installHardhat().then(resolve);
        } else {
          console.log('✅ Hardhat is installed:', stdout.trim());
          resolve(true);
        }
      });
    });
  }

  async installHardhat() {
    console.log('📦 Installing Hardhat and dependencies...');
    
    return new Promise((resolve, reject) => {
      const install = spawn('npm', ['install', '--save-dev', 'hardhat', '@openzeppelin/contracts'], {
        stdio: 'inherit',
        shell: true
      });
      
      install.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Hardhat installation completed');
          resolve(true);
        } else {
          console.error('❌ Failed to install Hardhat');
          reject(new Error('Installation failed'));
        }
      });
    });
  }

  async startLocalBlockchain() {
    console.log('🚀 Starting local Hardhat blockchain...');
    
    return new Promise((resolve, reject) => {
      const hardhatNode = spawn('npx', ['hardhat', 'node'], {
        shell: true,
        detached: false
      });
      
      this.processes.push(hardhatNode);
      
      let output = '';
      hardhatNode.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log(text.trim());
        
        // Check if blockchain is ready
        if (text.includes('Started HTTP and WebSocket JSON-RPC server')) {
          console.log('✅ Local blockchain is running on http://127.0.0.1:8545');
          setTimeout(() => resolve(true), 2000); // Wait a bit for full startup
        }
      });
      
      hardhatNode.stderr.on('data', (data) => {
        console.error('Hardhat Error:', data.toString());
      });
      
      hardhatNode.on('close', (code) => {
        if (code !== 0) {
          console.error(`❌ Hardhat node exited with code ${code}`);
          reject(new Error('Failed to start blockchain'));
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!output.includes('Started HTTP and WebSocket JSON-RPC server')) {
          reject(new Error('Blockchain startup timeout'));
        }
      }, 30000);
    });
  }

  async deployContract() {
    console.log('📜 Deploying TouristRegistry smart contract...');
    
    return new Promise((resolve, reject) => {
      const deploy = spawn('npx', ['hardhat', 'run', 'scripts/deploy.ts', '--network', 'localhost'], {
        stdio: 'inherit',
        shell: true
      });
      
      deploy.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Smart contract deployed successfully');
          resolve(true);
        } else {
          console.error('❌ Failed to deploy smart contract');
          reject(new Error('Deployment failed'));
        }
      });
    });
  }

  async checkEnvironmentFile() {
    console.log('🔍 Checking .env configuration...');
    
    const envPath = path.join(process.cwd(), '.env');
    
    if (!fs.existsSync(envPath)) {
      console.log('❌ .env file not found');
      return false;
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    const requiredVars = [
      'BLOCKCHAIN_RPC_URL',
      'PRIVATE_KEY',
      'CONTRACT_ADDRESS'
    ];
    
    const missingVars = requiredVars.filter(varName => 
      !envContent.includes(varName) || envContent.includes(`${varName}=`)
    );
    
    if (missingVars.length > 0) {
      console.log('⚠️  Missing or empty environment variables:', missingVars);
      return false;
    }
    
    console.log('✅ Environment configuration looks good');
    return true;
  }

  async runSetup() {
    console.log('🏗️  Smart Tourist Blockchain Setup');
    console.log('==================================\n');
    
    try {
      // Step 1: Check Hardhat
      await this.checkHardhatInstallation();
      
      // Step 2: Check environment
      const envOk = await this.checkEnvironmentFile();
      if (!envOk) {
        console.log('\n📝 Please ensure your .env file contains:');
        console.log('BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545');
        console.log('PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
        console.log('CONTRACT_ADDRESS=<will_be_set_after_deployment>');
        return;
      }
      
      // Step 3: Start blockchain
      await this.startLocalBlockchain();
      
      // Step 4: Deploy contract
      await this.deployContract();
      
      console.log('\n🎉 Blockchain setup completed successfully!');
      console.log('\n📋 Next steps:');
      console.log('1. Run the blockchain test: node scripts/test-blockchain.js');
      console.log('2. Start your server: npm run dev');
      console.log('3. Test the mobile app connection');
      
      console.log('\n⚠️  Keep this terminal open to maintain the blockchain');
      console.log('Press Ctrl+C to stop the blockchain');
      
      // Keep the process alive
      process.stdin.resume();
      
    } catch (error) {
      console.error('❌ Setup failed:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  cleanup() {
    console.log('\n🧹 Cleaning up processes...');
    this.processes.forEach(proc => {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    });
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received termination signal');
  process.exit(0);
});

// Run setup if this script is executed directly
if (require.main === module) {
  const setup = new BlockchainSetup();
  setup.runSetup().catch(console.error);
}

module.exports = BlockchainSetup;