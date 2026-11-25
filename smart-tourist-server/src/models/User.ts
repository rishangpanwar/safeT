export interface User {
  _id?: string;
  username: string;
  email: string;
  password: string; // Will be hashed
  role: 'government' | 'agent';
  governmentId?: string; // Required for government officials
  agentId?: string; // Auto-generated for agents
  createdBy?: string; // ID of the government official who created this agent
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: {
    fullName: string;
    department?: string; // For government officials
    organization?: string; // For agents (hotel, tour company, etc.)
    phone: string;
    address: {
      street: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
    };
  };
  permissions: {
    canRegisterTourists: boolean;
    canViewAlerts: boolean;
    canManageAlerts: boolean;
    canManageGeoFences: boolean;
    canSendNotifications: boolean;
    canCreateAgents: boolean;
    canViewAnalytics: boolean;
  };
}

export interface Alert {
  _id?: string;
  touristId: string;
  type: 'emergency' | 'panic' | 'geofence_breach' | 'system';
  status: 'active' | 'acknowledged' | 'resolved' | 'false_alarm';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
    accuracy?: number;
  };
  metadata: {
    deviceInfo?: any;
    batteryLevel?: number;
    networkStatus?: string;
    additionalData?: any;
  };
  timeline: {
    createdAt: Date;
    acknowledgedAt?: Date;
    acknowledgedBy?: string; // User ID
    resolvedAt?: Date;
    resolvedBy?: string; // User ID
    notes?: string;
  };
  assignedTo?: string; // User ID
  escalationLevel: number; // 0 = initial, 1+ = escalated
}

export interface Notification {
  _id?: string;
  title: string;
  message: string;
  type: 'advisory' | 'warning' | 'emergency' | 'info';
  targetLocation: {
    city: string;
    coordinates: [number, number]; // [longitude, latitude]
    radius: number; // in kilometers
  };
  createdBy: string; // User ID
  createdAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  recipients: {
    touristId: string;
    sentAt: Date;
    deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed';
  }[];
  metadata: {
    weatherCondition?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    category?: 'weather' | 'security' | 'health' | 'transport' | 'general';
  };
}

// Enhanced GeoFence interface
export interface EnhancedGeoFence {
  _id?: string;
  name: string;
  description: string;
  type: 'safe_zone' | 'restricted_zone' | 'alert_zone' | 'emergency_zone' | 'high_risk_zone';
  geometry: {
    type: 'Polygon' | 'Circle';
    coordinates: number[][] | number[]; // Polygon uses number[][], Circle uses number[]
    radius?: number;
  };
  isActive: boolean;
  createdBy: string; // User ID
  createdAt: Date;
  updatedAt: Date;
  alertSettings: {
    onEntry: boolean;
    onExit: boolean;
    alertLevel: 'info' | 'warning' | 'danger';
    notifyAuthorities: boolean;
    customMessage?: string;
    autoEscalate?: boolean;
    escalationTime?: number; // minutes
  };
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata: {
    category?: 'crime' | 'natural_disaster' | 'health' | 'transport' | 'political' | 'other';
    lastIncident?: Date;
    incidentCount?: number;
    sources?: string[]; // Data sources for risk assessment
  };
}

// Session management
export interface UserSession {
  _id?: string;
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: Date;
  createdAt: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
}
