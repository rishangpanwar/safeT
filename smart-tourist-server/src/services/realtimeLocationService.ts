import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { getCollections } from '../config/database';
import { LocationHistory, TrackingSession } from '../models/LocationHistory';
import { v4 as uuidv4 } from 'uuid';
import * as geolib from 'geolib';
import GeoFencingService from './geoFencingService';

interface LocationUpdate {
  touristId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  address?: string;
  batteryLevel?: number;
  isEmergency?: boolean;
  timestamp?: Date;
}

interface ConnectedClient {
  socketId: string;
  touristId?: string;
  userType: 'tourist' | 'admin' | 'authority';
  connectedAt: Date;
  lastActivity: Date;
}

export class RealtimeLocationService {
  private io: SocketIOServer;
  private connectedClients: Map<string, ConnectedClient> = new Map();
  private activeTrackingSessions: Map<string, TrackingSession> = new Map();
  private geoFencingService: GeoFencingService;

  constructor(server: HttpServer) {
    this.geoFencingService = new GeoFencingService();
    this.io = new SocketIOServer(server, {
      cors: {
        origin: "*", // Configure this properly for production
        methods: ["GET", "POST"]
      }
    });

    this.setupSocketHandlers();
    console.log('🔄 Real-time location service initialized');
  }

  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      // Handle client authentication
      socket.on('authenticate', async (data: { touristId?: string, userType: 'tourist' | 'admin' | 'authority', token?: string }) => {
        try {
          // In production, verify the token here
          const client: ConnectedClient = {
            socketId: socket.id,
            touristId: data.touristId,
            userType: data.userType,
            connectedAt: new Date(),
            lastActivity: new Date()
          };

          this.connectedClients.set(socket.id, client);
          
          if (data.userType === 'tourist' && data.touristId) {
            socket.join(`tourist_${data.touristId}`);
            await this.startTrackingSession(data.touristId, socket.id);
          } else if (data.userType === 'admin' || data.userType === 'authority') {
            socket.join('authorities');
          }

          socket.emit('authenticated', { success: true, clientId: socket.id });
          console.log(`[WebSocket] Client authenticated: ${socket.id} as ${data.userType}`);
        } catch (error) {
          socket.emit('authentication_error', { message: 'Authentication failed' });
          console.error('[WebSocket] Authentication error:', error);
        }
      });

      // Handle location updates from mobile app
      socket.on('location_update', async (data: LocationUpdate) => {
        try {
          const client = this.connectedClients.get(socket.id);
          if (!client || client.userType !== 'tourist') {
            socket.emit('error', { message: 'Unauthorized location update' });
            return;
          }

          await this.processLocationUpdate(data);
          client.lastActivity = new Date();
          
          // Broadcast to authorities
          this.io.to('authorities').emit('tourist_location_update', {
            touristId: data.touristId,
            location: {
              latitude: data.latitude,
              longitude: data.longitude
            },
            timestamp: data.timestamp || new Date(),
            isEmergency: data.isEmergency
          });

        } catch (error) {
          console.error('[WebSocket] Location update error:', error);
          socket.emit('error', { message: 'Failed to process location update' });
        }
      });

      // Handle emergency alerts
      socket.on('emergency_alert', async (data: { touristId: string, location: { latitude: number, longitude: number }, message?: string }) => {
        try {
          const client = this.connectedClients.get(socket.id);
          if (!client || client.userType !== 'tourist') {
            socket.emit('error', { message: 'Unauthorized emergency alert' });
            return;
          }

          // Process emergency location update
          await this.processLocationUpdate({
            ...data.location,
            touristId: data.touristId,
            isEmergency: true,
            timestamp: new Date()
          });

          // Broadcast emergency alert to all authorities
          this.io.to('authorities').emit('emergency_alert', {
            touristId: data.touristId,
            location: data.location,
            message: data.message || 'Emergency alert triggered',
            timestamp: new Date(),
            alertId: uuidv4()
          });

          socket.emit('emergency_alert_sent', { success: true });
          console.log(`[WebSocket] Emergency alert from tourist ${data.touristId}`);

        } catch (error) {
          console.error('[WebSocket] Emergency alert error:', error);
          socket.emit('error', { message: 'Failed to send emergency alert' });
        }
      });

      // Handle requests for tourist locations (from authorities)
      socket.on('get_tourist_locations', async (data: { touristIds?: string[], includeHistory?: boolean }) => {
        try {
          const client = this.connectedClients.get(socket.id);
          if (!client || (client.userType !== 'admin' && client.userType !== 'authority')) {
            socket.emit('error', { message: 'Unauthorized access' });
            return;
          }

          const locations = await this.getTouristLocations(data.touristIds, data.includeHistory);
          socket.emit('tourist_locations', locations);

        } catch (error) {
          console.error('[WebSocket] Get tourist locations error:', error);
          socket.emit('error', { message: 'Failed to get tourist locations' });
        }
      });

      // Handle disconnect
      socket.on('disconnect', async () => {
        const client = this.connectedClients.get(socket.id);
        if (client && client.touristId) {
          await this.endTrackingSession(client.touristId);
        }
        this.connectedClients.delete(socket.id);
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      });
    });
  }

  private async processLocationUpdate(data: LocationUpdate): Promise<void> {
    try {
      const collections = await getCollections();
      
      // Create location history entry
      const locationHistory: LocationHistory = {
        touristId: data.touristId,
        location: {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy,
          altitude: data.altitude,
          speed: data.speed,
          heading: data.heading
        },
        timestamp: data.timestamp || new Date(),
        address: data.address,
        batteryLevel: data.batteryLevel,
        isEmergency: data.isEmergency || false,
        source: 'mobile_app'
      };

      // Save to location history
      await collections.locationHistory.insertOne(locationHistory);

      // Update tourist's current location
      await collections.tourists.updateOne(
        { digitalId: data.touristId },
        {
          $set: {
            currentLocation: {
              latitude: data.latitude,
              longitude: data.longitude,
              timestamp: locationHistory.timestamp,
              address: data.address
            },
            lastLocationUpdate: locationHistory.timestamp
          }
        }
      );

      // Update tracking session
      const session = this.activeTrackingSessions.get(data.touristId);
      if (session) {
        session.lastUpdate = locationHistory.timestamp;
        session.locationCount += 1;
        
        await collections.trackingSessions.updateOne(
          { sessionId: session.sessionId },
          {
            $set: {
              lastUpdate: session.lastUpdate,
              locationCount: session.locationCount
            }
          }
        );
      }

      // Check for geo-fence breaches
      await this.checkGeoFenceBreaches(data.touristId, data.latitude, data.longitude);

      console.log(`[Location] Processed location update for tourist ${data.touristId}`);

    } catch (error) {
      console.error('[Location] Failed to process location update:', error);
      throw error;
    }
  }

  private async startTrackingSession(touristId: string, socketId: string): Promise<void> {
    try {
      const collections = await getCollections();
      
      const session: TrackingSession = {
        touristId,
        sessionId: uuidv4(),
        startTime: new Date(),
        isActive: true,
        trackingSettings: {
          updateInterval: 300, // 5 minutes default
          highAccuracyMode: false,
          backgroundTracking: true
        },
        locationCount: 0
      };

      await collections.trackingSessions.insertOne(session);
      this.activeTrackingSessions.set(touristId, session);
      
      console.log(`[Tracking] Started session for tourist ${touristId}`);
    } catch (error) {
      console.error('[Tracking] Failed to start tracking session:', error);
    }
  }

  private async endTrackingSession(touristId: string): Promise<void> {
    try {
      const session = this.activeTrackingSessions.get(touristId);
      if (!session) return;

      const collections = await getCollections();
      
      await collections.trackingSessions.updateOne(
        { sessionId: session.sessionId },
        {
          $set: {
            endTime: new Date(),
            isActive: false
          }
        }
      );

      this.activeTrackingSessions.delete(touristId);
      console.log(`[Tracking] Ended session for tourist ${touristId}`);
    } catch (error) {
      console.error('[Tracking] Failed to end tracking session:', error);
    }
  }

  private async checkGeoFenceBreaches(touristId: string, latitude: number, longitude: number): Promise<void> {
    try {
      const breaches = await this.geoFencingService.checkGeoFenceBreaches(
        touristId,
        { latitude, longitude }
      );

      // Broadcast geo-fence breaches to authorities
      for (const breach of breaches) {
        this.io.to('authorities').emit('geofence_breach', {
          touristId: breach.touristId,
          geoFenceName: breach.geoFenceName,
          breachType: breach.breachType,
          location: breach.location,
          alertLevel: breach.alertLevel,
          timestamp: breach.timestamp,
          breachId: breach._id
        });

        // Send notification to the tourist if it's a restricted zone
        if (breach.alertLevel === 'warning' || breach.alertLevel === 'danger') {
          this.sendToTourist(touristId, 'geofence_alert', {
            message: `You have ${breach.breachType === 'entry' ? 'entered' : 'exited'} ${breach.geoFenceName}`,
            alertLevel: breach.alertLevel,
            geoFenceName: breach.geoFenceName,
            breachType: breach.breachType
          });
        }
      }
    } catch (error) {
      console.error('[GeoFence] Failed to check geo-fence breaches:', error);
    }
  }

  private async getTouristLocations(touristIds?: string[], includeHistory?: boolean): Promise<any> {
    try {
      const collections = await getCollections();
      
      const filter: any = {};
      if (touristIds && touristIds.length > 0) {
        filter.digitalId = { $in: touristIds };
      }

      const tourists = await collections.tourists.find(filter, {
        projection: {
          digitalId: 1,
          'personalInfo.fullName': 1,
          currentLocation: 1,
          safetyStatus: 1,
          lastLocationUpdate: 1
        }
      }).toArray();

      if (includeHistory) {
        // Add recent location history for each tourist
        for (const tourist of tourists) {
          const history = await collections.locationHistory
            .find({ touristId: tourist.digitalId })
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();
          
          (tourist as any).locationHistory = history;
        }
      }

      return tourists;
    } catch (error) {
      console.error('[Location] Failed to get tourist locations:', error);
      throw error;
    }
  }

  // Public methods for external services

  /** Location received over REST (the mobile background task): run geo-fence checks and update live maps. */
  public handleRestLocation(touristId: string, loc: { latitude: number; longitude: number; altitude?: number }): void {
    this.io.to('authorities').emit('tourist_location_update', {
      touristId,
      location: { latitude: loc.latitude, longitude: loc.longitude, altitude: loc.altitude },
      timestamp: new Date(),
    });
    this.checkGeoFenceBreaches(touristId, loc.latitude, loc.longitude).catch((error) =>
      console.error('[GeoFence] REST breach check failed:', error)
    );
  }

  public broadcastToAuthorities(event: string, data: any): void {
    this.io.to('authorities').emit(event, data);
  }

  public sendToTourist(touristId: string, event: string, data: any): void {
    this.io.to(`tourist_${touristId}`).emit(event, data);
  }

  public getConnectedClients(): ConnectedClient[] {
    return Array.from(this.connectedClients.values());
  }

  public getActiveTrackingSessions(): TrackingSession[] {
    return Array.from(this.activeTrackingSessions.values());
  }

  public getGeoFencingService(): GeoFencingService {
    return this.geoFencingService;
  }
}

export default RealtimeLocationService;
