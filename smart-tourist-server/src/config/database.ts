import dotenv from 'dotenv';
import path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';
import { Tourist } from '../models/Tourist';
import {
  LocationHistory,
  GeoFence,
  GeoFenceBreach,
  TrackingSession,
  TouristSafetyZone,
  LocationAnalytics
} from '../models/LocationHistory';

// Load environment variables with explicit path
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log("Database URI loaded:", process.env.MONGODB_URI ? "✅ Found" : "❌ Missing");

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI environment variable is missing!");
  console.error("Please check your .env file in the project root.");
  throw new Error("Invalid/missing environment variable MONGODB_URI");
}

const uri = process.env.MONGODB_URI;
const options = {
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  serverSelectionTimeoutMS: 30000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true
};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  let globalWithMongo = global as typeof global & {
    _mongoClientPromise?: Promise<MongoClient>
  }

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

// Database collections interface
export interface DatabaseCollections {
  tourists: Collection<Tourist>;
  locationHistory: Collection<LocationHistory>;
  geoFences: Collection<GeoFence>;
  geoFenceBreaches: Collection<GeoFenceBreach>;
  trackingSessions: Collection<TrackingSession>;
  touristSafetyZones: Collection<TouristSafetyZone>;
  locationAnalytics: Collection<LocationAnalytics>;
  users: Collection<any>;
  userSessions: Collection<any>;
  alerts: Collection<any>;
  notifications: Collection<any>;
  // Health & emergency-response collections
  healthTelemetry: Collection<any>;
  medicalFacilities: Collection<any>;
  rescueRoutes: Collection<any>;
  sbtLedger: Collection<any>;
  clinicalAccessLog: Collection<any>;
}

// Function to get database instance
async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(); // Uses default database name from connection string
}

// Function to get all collections with proper typing
async function getCollections(): Promise<DatabaseCollections> {
  const db = await getDb();
  
  return {
    tourists: db.collection<Tourist>('tourists'),
    locationHistory: db.collection<LocationHistory>('locationHistory'),
    geoFences: db.collection<GeoFence>('geoFences'),
    geoFenceBreaches: db.collection<GeoFenceBreach>('geoFenceBreaches'),
    trackingSessions: db.collection<TrackingSession>('trackingSessions'),
    touristSafetyZones: db.collection<TouristSafetyZone>('touristSafetyZones'),
    locationAnalytics: db.collection<LocationAnalytics>('locationAnalytics'),
    users: db.collection('users'),
    userSessions: db.collection('userSessions'),
    alerts: db.collection('alerts'),
    notifications: db.collection('notifications'),
    healthTelemetry: db.collection('healthTelemetry'),
    medicalFacilities: db.collection('medicalFacilities'),
    rescueRoutes: db.collection('rescueRoutes'),
    sbtLedger: db.collection('sbtLedger'),
    clinicalAccessLog: db.collection('clinicalAccessLog'),
  };
}

// Function to create database indexes for optimal performance
async function createIndexes(): Promise<void> {
  try {
    const collections = await getCollections();
    
    console.log('🔄 Creating database indexes...');

    // Tourist indexes
    try {
      await collections.tourists.createIndex({ digitalId: 1 }, { unique: true });
    } catch (error) {
      console.log('Digital ID index already exists or has conflicts, skipping...');
    }

    try {
      await collections.tourists.createIndex({ 'personalInfo.email': 1 }, { unique: true, sparse: true });
    } catch (error) {
      console.log('Email index already exists or has conflicts, skipping...');
    }

    try {
      await collections.tourists.createIndex({ 'personalInfo.passportNumber': 1 }, { unique: true, sparse: true });
    } catch (error) {
      console.log('Passport number index already exists or has conflicts, skipping...');
    }

    await collections.tourists.createIndex({ safetyStatus: 1 });
    await collections.tourists.createIndex({ isActive: 1 });

    // Location history indexes
    await collections.locationHistory.createIndex({ touristId: 1, timestamp: -1 });
    await collections.locationHistory.createIndex({ timestamp: -1 });
    await collections.locationHistory.createIndex({ 'location.latitude': 1, 'location.longitude': 1 });
    await collections.locationHistory.createIndex({ isEmergency: 1 });
    
    // Geospatial index for location queries
    await collections.locationHistory.createIndex({ 
      location: '2dsphere' 
    });

    // Geo-fence indexes
    await collections.geoFences.createIndex({ isActive: 1 });
    await collections.geoFences.createIndex({ type: 1 });
    await collections.geoFences.createIndex({ 'metadata.category': 1 });
    // Geo-fence geometry is not GeoJSON (raw rings, custom "Circle" type), so a 2dsphere index on it
    // makes MongoDB reject every insert. Containment is computed in code (ray casting, Eq. 2.7);
    // drop the index if an older version of this server created it.
    await collections.geoFences.dropIndex('geometry.coordinates_2dsphere').catch(() => undefined);

    // Geo-fence breach indexes
    await collections.geoFenceBreaches.createIndex({ touristId: 1, timestamp: -1 });
    await collections.geoFenceBreaches.createIndex({ geoFenceId: 1, timestamp: -1 });
    await collections.geoFenceBreaches.createIndex({ isResolved: 1 });
    await collections.geoFenceBreaches.createIndex({ alertLevel: 1 });

    // Tracking session indexes
    await collections.trackingSessions.createIndex({ touristId: 1, startTime: -1 });
    await collections.trackingSessions.createIndex({ sessionId: 1 }, { unique: true });
    await collections.trackingSessions.createIndex({ isActive: 1 });

    // Tourist safety zone indexes
    await collections.touristSafetyZones.createIndex({ touristId: 1 });
    await collections.touristSafetyZones.createIndex({ isActive: 1 });
    await collections.touristSafetyZones.createIndex({ 
      location: '2dsphere' 
    });

    // Location analytics indexes
    await collections.locationAnalytics.createIndex({ touristId: 1, date: -1 });
    await collections.locationAnalytics.createIndex({ date: -1 });
    await collections.locationAnalytics.createIndex({ riskScore: -1 });

    // User indexes
    try {
      await collections.users.createIndex({ email: 1 }, { unique: true, sparse: true });
    } catch (error) {
      console.log('Email index already exists or has conflicts, skipping...');
    }

    try {
      await collections.users.createIndex({ username: 1 }, { unique: true });
    } catch (error) {
      console.log('Username index already exists or has conflicts, skipping...');
    }

    try {
      await collections.users.createIndex({ governmentId: 1 }, { unique: true, sparse: true });
    } catch (error) {
      console.log('Government ID index already exists or has conflicts, skipping...');
    }

    try {
      await collections.users.createIndex({ agentId: 1 }, { unique: true, sparse: true });
    } catch (error) {
      console.log('Agent ID index already exists or has conflicts, skipping...');
    }

    await collections.users.createIndex({ role: 1 });
    await collections.users.createIndex({ isActive: 1 });
    await collections.users.createIndex({ createdAt: -1 });

    // User session indexes
    await collections.userSessions.createIndex({ userId: 1 });
    await collections.userSessions.createIndex({ token: 1 }, { unique: true });
    await collections.userSessions.createIndex({ refreshToken: 1 });
    await collections.userSessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await collections.userSessions.createIndex({ isActive: 1 });

    // Alert indexes
    await collections.alerts.createIndex({ touristId: 1 });
    await collections.alerts.createIndex({ status: 1 });
    await collections.alerts.createIndex({ priority: 1 });
    await collections.alerts.createIndex({ type: 1 });
    await collections.alerts.createIndex({ 'timeline.createdAt': -1 });
    await collections.alerts.createIndex({ assignedTo: 1 });
    await collections.alerts.createIndex({ escalationLevel: 1 });

    // Notification indexes
    await collections.notifications.createIndex({ createdBy: 1 });
    await collections.notifications.createIndex({ type: 1 });
    await collections.notifications.createIndex({ isActive: 1 });
    await collections.notifications.createIndex({ createdAt: -1 });
    await collections.notifications.createIndex({ 'targetLocation.city': 1 });
    await collections.notifications.createIndex({ 'recipients.touristId': 1 });
    await collections.notifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // Health telemetry: per-tourist time series, auto-expired after 30 days (DPDP storage limitation)
    await collections.healthTelemetry.createIndex({ touristId: 1, t: -1 });
    await collections.healthTelemetry.createIndex({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

    // Rescue network: S2 spherical index for $near proximity queries (report §2.2-D Layer 2)
    await collections.medicalFacilities.createIndex({ location: '2dsphere' });
    await collections.medicalFacilities.createIndex({ nodeId: 1 }, { unique: true });
    await collections.rescueRoutes.createIndex({ from: 1, to: 1 });
    await collections.sbtLedger.createIndex({ seq: 1 }, { unique: true });
    await collections.sbtLedger.createIndex({ tokenId: 1 });
    await collections.clinicalAccessLog.createIndex({ at: -1 });
    await collections.tourists.createIndex({ 'health.tier': 1 });

    console.log('✅ Database indexes created successfully');
  } catch (error) {
    console.error('❌ Failed to create database indexes:', error);
    throw error;
  }
}

export { getDb, getCollections, createIndexes, clientPromise };
export default clientPromise;
