import { MongoClient, Db, Collection } from 'mongodb';
import { Tourist, Alert, LocationUpdate, TouristSession } from './Tourist';
import {
  LocationHistory,
  GeoFence,
  GeoFenceBreach,
  TrackingSession,
  TouristSafetyZone,
  LocationAnalytics
} from './LocationHistory';

class DatabaseModels {
  private db: Db;

  constructor(database: Db) {
    this.db = database;
  }

  // Tourist Collection
  get tourists(): Collection<Tourist> {
    return this.db.collection<Tourist>('tourists');
  }

  // Alerts Collection
  get alerts(): Collection<Alert> {
    return this.db.collection<Alert>('alerts');
  }

  // Location Updates Collection
  get locationUpdates(): Collection<LocationUpdate> {
    return this.db.collection<LocationUpdate>('locationUpdates');
  }

  // Tourist Sessions Collection
  get touristSessions(): Collection<TouristSession> {
    return this.db.collection<TouristSession>('touristSessions');
  }

  // Enhanced Location Collections
  get locationHistory(): Collection<LocationHistory> {
    return this.db.collection<LocationHistory>('locationHistory');
  }

  get geoFences(): Collection<GeoFence> {
    return this.db.collection<GeoFence>('geoFences');
  }

  get geoFenceBreaches(): Collection<GeoFenceBreach> {
    return this.db.collection<GeoFenceBreach>('geoFenceBreaches');
  }

  get trackingSessions(): Collection<TrackingSession> {
    return this.db.collection<TrackingSession>('trackingSessions');
  }

  get touristSafetyZones(): Collection<TouristSafetyZone> {
    return this.db.collection<TouristSafetyZone>('touristSafetyZones');
  }

  get locationAnalytics(): Collection<LocationAnalytics> {
    return this.db.collection<LocationAnalytics>('locationAnalytics');
  }

  // Helper methods for common operations
  async createIndexes() {
    try {
      // Tourist indexes
      await this.tourists.createIndex({ digitalId: 1 }, { unique: true });
      await this.tourists.createIndex({ 'personalInfo.email': 1 }, { unique: true });
      await this.tourists.createIndex({ 'personalInfo.passportNumber': 1 }, { unique: true });
      await this.tourists.createIndex({ safetyStatus: 1 });
      await this.tourists.createIndex({ isActive: 1 });
      await this.tourists.createIndex({ registrationDate: -1 });

      // Alert indexes
      await this.alerts.createIndex({ touristId: 1 });
      await this.alerts.createIndex({ timestamp: -1 });
      await this.alerts.createIndex({ status: 1 });
      await this.alerts.createIndex({ severity: 1 });
      await this.alerts.createIndex({ type: 1 });

      // Location updates indexes
      await this.locationUpdates.createIndex({ touristId: 1 });
      await this.locationUpdates.createIndex({ timestamp: -1 });
      await this.locationUpdates.createIndex({ 
        'location.latitude': 1, 
        'location.longitude': 1 
      });
      await this.locationUpdates.createIndex({ isEmergency: 1 });

      // Session indexes
      await this.touristSessions.createIndex({ touristId: 1 });
      await this.touristSessions.createIndex({ 'deviceInfo.deviceId': 1 });
      await this.touristSessions.createIndex({ isActive: 1 });
      await this.touristSessions.createIndex({ lastActivity: -1 });

      console.log('Database indexes created successfully');
    } catch (error) {
      console.error('Error creating database indexes:', error);
    }
  }

  // Validation helpers
  validateTourist(tourist: Partial<Tourist>): string[] {
    const errors: string[] = [];

    if (!tourist.digitalId) errors.push('digitalId is required');
    if (!tourist.personalInfo?.fullName) errors.push('fullName is required');
    if (!tourist.personalInfo?.email) errors.push('email is required');
    if (!tourist.personalInfo?.phone) errors.push('phone is required');
    if (!tourist.personalInfo?.passportNumber) errors.push('passportNumber is required');
    if (!tourist.emergencyContact?.name) errors.push('emergency contact name is required');
    if (!tourist.emergencyContact?.phone) errors.push('emergency contact phone is required');

    // Email validation
    if (tourist.personalInfo?.email && !/\S+@\S+\.\S+/.test(tourist.personalInfo.email)) {
      errors.push('invalid email format');
    }

    return errors;
  }

  validateAlert(alert: Partial<Alert>): string[] {
    const errors: string[] = [];

    if (!alert.touristId) errors.push('touristId is required');
    if (!alert.type) errors.push('alert type is required');
    if (!alert.message) errors.push('alert message is required');
    if (!alert.severity) errors.push('alert severity is required');

    return errors;
  }
}

module.exports = DatabaseModels;