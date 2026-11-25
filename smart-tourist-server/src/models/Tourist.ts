import { ObjectId } from 'mongodb';

export interface Tourist {
  _id?: ObjectId;
  digitalId: string;
  blockchainId?: string;
  personalInfo: {
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    nationality: string;
    passportNumber: string;
    address: {
      street: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
    };
  };
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
  };
  travelInfo: {
    destination: string;
    arrivalDate: string;
    departureDate: string;
    accommodation: string;
    localGuide?: string;
  };
  safetyStatus: 'Normal' | 'Alert' | 'Danger';
  isActive: boolean;
  registrationDate: Date;
  lastLocationUpdate?: Date;
  currentLocation?: {
    latitude: number;
    longitude: number;
    altitude?: number;
    timestamp: Date;
    address?: string;
  };
  alerts?: Alert[];
  /** Latest clinical triage (MEWS + Isolation Forest), maintained by healthMonitoringService. */
  health?: {
    tier: 'green' | 'yellow' | 'red';
    mews: number;
    anomalyScore: number;
    anomalyLevel: 'normal' | 'watch' | 'critical';
    reasons: string[];
    vitals: { hr: number; spo2: number; skinTemp: number; hrvRmssd: number; mobility: number; altitude?: number };
    updatedAt: Date;
    [key: string]: any;
  };
  /** Soulbound health permit. Only hashes and an AES-GCM encrypted blob — never plaintext clinical data. */
  healthProfile?: {
    tokenId: string;
    clinicalHash: string;
    encryptedProfile: string;
    sbt: { network: string; txHash: string; soul: string; contract?: string; blockNumber?: number };
    validUntil: Date;
    consent: { given: boolean; at: Date; purpose: string; version: string };
  };
}

export interface Alert {
  _id?: ObjectId;
  touristId: string;
  type: 'Emergency' | 'Check-in' | 'Location' | 'Custom';
  message: string;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  status: 'Active' | 'Acknowledged' | 'Resolved';
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  timestamp: Date;
  resolvedAt?: Date;
  acknowledgedBy?: string;
  metadata?: {
    [key: string]: any;
  };
}

export interface LocationUpdate {
  _id?: ObjectId;
  touristId: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
  };
  timestamp: Date;
  address?: string;
  batteryLevel?: number;
  isEmergency: boolean;
}

export interface TouristSession {
  _id?: ObjectId;
  touristId: string;
  deviceInfo: {
    deviceId: string;
    platform: string;
    version: string;
    appVersion: string;
  };
  sessionStart: Date;
  sessionEnd?: Date;
  lastActivity: Date;
  isActive: boolean;
}