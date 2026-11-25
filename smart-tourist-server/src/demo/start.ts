/**
 * `npm run demo` — starts the API server with the live demo cohort.
 *
 * If MONGODB_URI is not configured (missing, or still the .env.example placeholder), a local
 * MongoDB is started automatically. Its data is kept in .demo-db/ so logins, registrations and
 * incident history survive restarts. The MongoDB binary is downloaded once on first run.
 * Set DEMO_DB=local to force the local database even when MONGODB_URI is set.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.DEMO_MODE ??= 'true';
process.env.NODE_ENV ??= 'development';

const uri = process.env.MONGODB_URI;
const needsLocalDb = process.env.DEMO_DB === 'local' || !uri || uri.includes('<');

async function main() {
  if (needsLocalDb) {
    console.log('🗄️  No MongoDB configured — starting a local demo database (the first run downloads MongoDB once, ~600 MB)…');
    const { MongoMemoryServer } = await import('mongodb-memory-server-core');
    const dbPath = path.resolve(__dirname, '../../.demo-db');
    fs.mkdirSync(dbPath, { recursive: true });
    const mongod = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger', port: Number(process.env.DEMO_DB_PORT || 27018) },
    });
    process.env.MONGODB_URI = mongod.getUri('smart_tourist');
    console.log(`🗄️  Local demo database ready at ${process.env.MONGODB_URI} (data in .demo-db/)`);

    const stop = async () => {
      await mongod.stop({ doCleanup: false }).catch(() => undefined);
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }

  // The server's modules connect at import time, so load them only once MONGODB_URI is final.
  require('../index');
}

main().catch((error) => {
  console.error('❌ Demo failed to start:', error);
  process.exit(1);
});
