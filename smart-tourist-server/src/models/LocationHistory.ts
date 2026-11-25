import { ObjectId } from 'mongodb';

// Location history for storing all location updates
export interface LocationHistory {
  _id?: ObjectId;
  touristId: string; // Digital ID of the tourist
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
  isEmergency?: boolean;
  source: 'mobile_app' | 'manual' | 'iot_device';
  metadata?: {
    deviceId?: string;
    appVersion?: string;
    networkType?: string;
    [key: string]: any;
  };
}

// Geo-fence for defining safe/restricted areas
export interface GeoFence {
  _id?: ObjectId;
  name: string;
  description?: string;
  type: 'safe_zone' | 'restricted_zone' | 'alert_zone' | 'emergency_zone';
  geometry: {
    type: 'Polygon' | 'Circle';
    coordinates: number[][] | number[]; // For polygon: [[lng, lat], [lng, lat], ...] For circle: [lng, lat]
    radius?: number; // For circle type in meters
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // Admin user ID
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: any;
  alertSettings: {
    onEntry: boolean;
    onExit: boolean;
    alertLevel: 'info' | 'warning' | 'danger';
    notifyAuthorities: boolean;
    customMessage?: string;
  };
}

// Geo-fence breach events
export interface GeoFenceBreach {
  _id?: ObjectId;
  touristId: string;
  geoFenceId: ObjectId;
  geoFenceName: string;
  breachType: 'entry' | 'exit';
  location: {
    latitude: number;
    longitude: number;
  };
  timestamp: Date;
  alertLevel: 'info' | 'warning' | 'danger';
  isResolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes?: string;
}

// Real-time tracking sessions
export interface TrackingSession {
  _id?: ObjectId;
  touristId: string;
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  trackingSettings: {
    updateInterval: number; // in seconds
    highAccuracyMode: boolean;
    backgroundTracking: boolean;
  };
  lastUpdate?: Date;
  totalDistance?: number; // in meters
  averageSpeed?: number; // in m/s
  locationCount: number;
}

// Tourist safety zones (personalized geo-fences)
export interface TouristSafetyZone {
  _id?: ObjectId;
  touristId: string;
  zoneName: string;
  zoneType: 'accommodation' | 'planned_destination' | 'emergency_contact' | 'custom';
  location: {
    latitude: number;
    longitude: number;
  };
  radius: number; // in meters
  isActive: boolean;
  createdAt: Date;
  metadata?: {
    address?: string;
    contactInfo?: string;
    notes?: string;
  };
}

// Location analytics and insights
export interface LocationAnalytics {
  _id?: ObjectId;
  touristId: string;
  date: Date; // Daily analytics
  stats: {
    totalDistance: number;
    averageSpeed: number;
    maxSpeed: number;
    timeInSafeZones: number; // in minutes
    timeInRestrictedZones: number; // in minutes
    locationUpdates: number;
    geoFenceBreaches: number;
  };
  heatmapData: {
    latitude: number;
    longitude: number;
    duration: number; // time spent in this location in minutes
  }[];
  riskScore: number; // 0-100, calculated based on various factors
  calculatedAt: Date;
}

