import { getCollections } from '../config/database';
import { GeoFence, GeoFenceBreach, TouristSafetyZone } from '../models/LocationHistory';
import * as geolib from 'geolib';
import { pointInPolygonPruned, LngLat } from '../health/geoMedical';
import { ObjectId } from 'mongodb';

interface Point {
  latitude: number;
  longitude: number;
}

interface GeoFenceCheckResult {
  isInside: boolean;
  geoFence: GeoFence;
  distance?: number; // Distance to boundary in meters
}

export class GeoFencingService {
  private activeGeoFences: Map<string, GeoFence> = new Map();
  private touristSafetyZones: Map<string, TouristSafetyZone[]> = new Map();

  constructor() {
    this.loadActiveGeoFences();
    console.log('🔄 Geo-fencing service initialized');
  }

  // Load active geo-fences from database
  private async loadActiveGeoFences(): Promise<void> {
    try {
      const collections = await getCollections();
      const geoFences = await collections.geoFences.find({ isActive: true }).toArray();
      
      for (const geoFence of geoFences) {
        this.activeGeoFences.set(geoFence._id!.toString(), geoFence);
      }

      console.log(`[GeoFence] Loaded ${geoFences.length} active geo-fences`);
    } catch (error) {
      console.error('[GeoFence] Failed to load active geo-fences:', error);
    }
  }

  // Create a new geo-fence (legacy method)
  public async createGeoFenceLegacy(geoFenceData: Omit<GeoFence, '_id' | 'createdAt' | 'updatedAt'>): Promise<GeoFence> {
    try {
      const collections = await getCollections();
      
      const geoFence: GeoFence = {
        ...geoFenceData,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collections.geoFences.insertOne(geoFence);
      geoFence._id = result.insertedId;

      if (geoFence.isActive) {
        this.activeGeoFences.set(result.insertedId.toString(), geoFence);
      }

      console.log(`[GeoFence] Created geo-fence: ${geoFence.name}`);
      return geoFence;
    } catch (error) {
      console.error('[GeoFence] Failed to create geo-fence:', error);
      throw error;
    }
  }

  // Update an existing geo-fence (legacy method)
  public async updateGeoFenceLegacy(geoFenceId: string, updates: Partial<GeoFence>): Promise<boolean> {
    try {
      const collections = await getCollections();
      
      const result = await collections.geoFences.updateOne(
        { _id: new ObjectId(geoFenceId) },
        {
          $set: {
            ...updates,
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount > 0) {
        // Update in-memory cache
        const updatedGeoFence = await collections.geoFences.findOne({ _id: new ObjectId(geoFenceId) });
        if (updatedGeoFence) {
          if (updatedGeoFence.isActive) {
            this.activeGeoFences.set(geoFenceId, updatedGeoFence);
          } else {
            this.activeGeoFences.delete(geoFenceId);
          }
        }

        console.log(`[GeoFence] Updated geo-fence: ${geoFenceId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[GeoFence] Failed to update geo-fence:', error);
      throw error;
    }
  }


  // Check if a point is inside a geo-fence
  public checkPointInGeoFence(point: Point, geoFence: GeoFence): GeoFenceCheckResult {
    try {
      let isInside = false;
      let distance: number | undefined;

      if (geoFence.geometry.type === 'Circle') {
        // For circle: coordinates are [longitude, latitude] as a simple array
        const coords = geoFence.geometry.coordinates as number[];
        const center = {
          latitude: coords[1],
          longitude: coords[0]
        };
        
        distance = geolib.getDistance(point, center);
        isInside = distance <= (geoFence.geometry.radius || 1000);
      } else if (geoFence.geometry.type === 'Polygon') {
        // Ray casting (Jordan curve theorem) behind an O(1) bounding-box pre-filter — report Eq. 2.7
        const coords = geoFence.geometry.coordinates as number[][];
        const polygon = coords.map(coord => ({
          latitude: coord[1],
          longitude: coord[0]
        }));

        isInside = pointInPolygonPruned(point.longitude, point.latitude, coords as LngLat[]);
        
        // Calculate distance to polygon boundary
        if (polygon.length >= 2) {
          distance = geolib.getDistanceFromLine(point, polygon[0], polygon[polygon.length - 1]);
        }
      }

      return {
        isInside,
        geoFence,
        distance
      };
    } catch (error) {
      console.error('[GeoFence] Error checking point in geo-fence:', error);
      return {
        isInside: false,
        geoFence,
        distance: undefined
      };
    }
  }

  // Check all geo-fences for a tourist location
  public async checkGeoFenceBreaches(touristId: string, point: Point): Promise<GeoFenceBreach[]> {
    try {
      const collections = await getCollections();
      const breaches: GeoFenceBreach[] = [];

      // Check against all active geo-fences
      for (const [geoFenceId, geoFence] of this.activeGeoFences) {
        const checkResult = this.checkPointInGeoFence(point, geoFence);
        
        // Get previous breach status for this tourist and geo-fence
        const lastBreach = await collections.geoFenceBreaches
          .findOne(
            { touristId, geoFenceId: new ObjectId(geoFenceId) },
            { sort: { timestamp: -1 } }
          );

        const wasInside = lastBreach?.breachType === 'entry' && !lastBreach.isResolved;
        const isNowInside = checkResult.isInside;

        // Determine if there's a breach
        let breachType: 'entry' | 'exit' | null = null;
        
        if (!wasInside && isNowInside && geoFence.alertSettings.onEntry) {
          breachType = 'entry';
        } else if (wasInside && !isNowInside && geoFence.alertSettings.onExit) {
          breachType = 'exit';
        }

        if (breachType) {
          const breach: GeoFenceBreach = {
            touristId,
            geoFenceId: new ObjectId(geoFenceId),
            geoFenceName: geoFence.name,
            breachType,
            location: point,
            timestamp: new Date(),
            alertLevel: geoFence.alertSettings.alertLevel,
            isResolved: false
          };

          // Save breach to database
          const result = await collections.geoFenceBreaches.insertOne(breach);
          breach._id = result.insertedId;
          
          breaches.push(breach);

          // Resolve previous opposite breach if exists
          if (lastBreach && !lastBreach.isResolved) {
            await collections.geoFenceBreaches.updateOne(
              { _id: lastBreach._id },
              {
                $set: {
                  isResolved: true,
                  resolvedAt: new Date()
                }
              }
            );
          }

          console.log(`[GeoFence] Breach detected: Tourist ${touristId} ${breachType} ${geoFence.name}`);
        }
      }

      // Check tourist safety zones
      await this.checkTouristSafetyZones(touristId, point);

      return breaches;
    } catch (error) {
      console.error('[GeoFence] Failed to check geo-fence breaches:', error);
      return [];
    }
  }

  // Check tourist-specific safety zones
  private async checkTouristSafetyZones(touristId: string, point: Point): Promise<void> {
    try {
      const collections = await getCollections();
      
      // Get tourist safety zones
      let safetyZones = this.touristSafetyZones.get(touristId);
      if (!safetyZones) {
        safetyZones = await collections.touristSafetyZones
          .find({ touristId, isActive: true })
          .toArray();
        this.touristSafetyZones.set(touristId, safetyZones);
      }

      for (const zone of safetyZones) {
        const distance = geolib.getDistance(point, zone.location);
        const isInZone = distance <= zone.radius;

        // You can add logic here to track when tourists enter/exit their safety zones
        // and generate appropriate alerts or notifications
      }
    } catch (error) {
      console.error('[GeoFence] Failed to check tourist safety zones:', error);
    }
  }

  // Create a tourist safety zone
  public async createTouristSafetyZone(zoneData: Omit<TouristSafetyZone, '_id' | 'createdAt'>): Promise<TouristSafetyZone> {
    try {
      const collections = await getCollections();
      
      const safetyZone: TouristSafetyZone = {
        ...zoneData,
        createdAt: new Date()
      };

      const result = await collections.touristSafetyZones.insertOne(safetyZone);
      safetyZone._id = result.insertedId;

      // Update cache
      const existingZones = this.touristSafetyZones.get(zoneData.touristId) || [];
      existingZones.push(safetyZone);
      this.touristSafetyZones.set(zoneData.touristId, existingZones);

      console.log(`[GeoFence] Created safety zone for tourist ${zoneData.touristId}: ${zoneData.zoneName}`);
      return safetyZone;
    } catch (error) {
      console.error('[GeoFence] Failed to create tourist safety zone:', error);
      throw error;
    }
  }

  // Get all geo-fences (legacy method)
  public async getAllGeoFencesLegacy(includeInactive: boolean = false): Promise<GeoFence[]> {
    try {
      const collections = await getCollections();
      const filter = includeInactive ? {} : { isActive: true };
      return await collections.geoFences.find(filter).toArray();
    } catch (error) {
      console.error('[GeoFence] Failed to get geo-fences:', error);
      throw error;
    }
  }

  // Get geo-fence breaches for a tourist
  public async getTouristBreaches(touristId: string, limit: number = 50): Promise<GeoFenceBreach[]> {
    try {
      const collections = await getCollections();
      return await collections.geoFenceBreaches
        .find({ touristId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      console.error('[GeoFence] Failed to get tourist breaches:', error);
      throw error;
    }
  }

  // Get recent breaches for authorities
  public async getRecentBreaches(limit: number = 100): Promise<GeoFenceBreach[]> {
    try {
      const collections = await getCollections();
      return await collections.geoFenceBreaches
        .find({})
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      console.error('[GeoFence] Failed to get recent breaches:', error);
      throw error;
    }
  }

  // Resolve a breach
  public async resolveBreach(breachId: string, resolvedBy: string, notes?: string): Promise<boolean> {
    try {
      const collections = await getCollections();
      
      const result = await collections.geoFenceBreaches.updateOne(
        { _id: new ObjectId(breachId) },
        {
          $set: {
            isResolved: true,
            resolvedAt: new Date(),
            resolvedBy,
            notes
          }
        }
      );

      return result.matchedCount > 0;
    } catch (error) {
      console.error('[GeoFence] Failed to resolve breach:', error);
      throw error;
    }
  }

  // Refresh geo-fences cache
  public async refreshGeoFences(): Promise<void> {
    this.activeGeoFences.clear();
    this.touristSafetyZones.clear();
    await this.loadActiveGeoFences();
  }

  // Enhanced geo-fence management methods

  // Create new geo-fence
  public async createGeoFence(geoFenceData: {
    name: string;
    description: string;
    type: GeoFence['type'];
    geometry: GeoFence['geometry'];
    createdBy: string;
    alertSettings?: GeoFence['alertSettings'];
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    metadata?: any;
  }): Promise<{ success: boolean; geoFence?: GeoFence; message: string }> {
    try {
      const collections = await getCollections();

      const newGeoFence: GeoFence = {
        ...geoFenceData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        alertSettings: geoFenceData.alertSettings || {
          onEntry: true,
          onExit: true,
          alertLevel: 'warning',
          notifyAuthorities: true,
        },
        riskLevel: geoFenceData.riskLevel || 'medium',
        metadata: geoFenceData.metadata || {},
      };

      const result = await collections.geoFences.insertOne(newGeoFence);
      newGeoFence._id = result.insertedId;

      // Update active geo-fences cache
      this.activeGeoFences.set(result.insertedId.toString(), newGeoFence);

      console.log(`[GeoFence] Created ${geoFenceData.type} geo-fence: ${geoFenceData.name}`);

      return {
        success: true,
        geoFence: newGeoFence,
        message: 'Geo-fence created successfully'
      };
    } catch (error) {
      console.error('Error creating geo-fence:', error);
      return { success: false, message: 'Failed to create geo-fence' };
    }
  }

  // Update geo-fence
  public async updateGeoFence(
    geoFenceId: string,
    updateData: Partial<GeoFence>,
    updatedBy: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const collections = await getCollections();

      const result = await collections.geoFences.updateOne(
        { _id: new ObjectId(geoFenceId) },
        {
          $set: {
            ...updateData,
            updatedAt: new Date(),
            updatedBy
          }
        }
      );

      if (result.matchedCount === 0) {
        return { success: false, message: 'Geo-fence not found' };
      }

      // Update cache
      const updatedGeoFence = await collections.geoFences.findOne({ _id: new ObjectId(geoFenceId) });
      if (updatedGeoFence) {
        this.activeGeoFences.set(geoFenceId, updatedGeoFence);
      }

      return { success: true, message: 'Geo-fence updated successfully' };
    } catch (error) {
      console.error('Error updating geo-fence:', error);
      return { success: false, message: 'Failed to update geo-fence' };
    }
  }

  // Delete geo-fence
  public async deleteGeoFence(geoFenceId: string): Promise<{ success: boolean; message: string }> {
    try {
      const collections = await getCollections();

      const result = await collections.geoFences.deleteOne({ _id: new ObjectId(geoFenceId) });

      if (result.deletedCount === 0) {
        return { success: false, message: 'Geo-fence not found' };
      }

      // Remove from cache
      this.activeGeoFences.delete(geoFenceId);

      return { success: true, message: 'Geo-fence deleted successfully' };
    } catch (error) {
      console.error('Error deleting geo-fence:', error);
      return { success: false, message: 'Failed to delete geo-fence' };
    }
  }

  // Get all geo-fences with pagination
  public async getAllGeoFences(
    page: number = 1,
    limit: number = 20,
    type?: GeoFence['type'],
    isActive?: boolean
  ): Promise<{ geoFences: GeoFence[]; total: number; page: number; totalPages: number }> {
    try {
      const collections = await getCollections();

      const filter: any = {};
      if (type) filter.type = type;
      if (isActive !== undefined) filter.isActive = isActive;

      const total = await collections.geoFences.countDocuments(filter);
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;

      const geoFences = await collections.geoFences
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return { geoFences, total, page, totalPages };
    } catch (error) {
      console.error('Error fetching geo-fences:', error);
      return { geoFences: [], total: 0, page: 1, totalPages: 0 };
    }
  }

  // Create automatic geo-fence around tourist's itinerary
  public async createTouristItineraryGeoFence(
    touristId: string,
    city: string,
    coordinates: [number, number],
    createdBy: string
  ): Promise<{ success: boolean; geoFence?: GeoFence; message: string }> {
    try {
      return await this.createGeoFence({
        name: `${city} - Tourist Zone (${touristId})`,
        description: `Automatic safety zone for tourist ${touristId} visiting ${city}`,
        type: 'safe_zone',
        geometry: {
          type: 'Circle',
          coordinates: coordinates as number[], // [longitude, latitude]
          radius: 100000, // 100km radius
        },
        createdBy,
        alertSettings: {
          onEntry: false,
          onExit: true,
          alertLevel: 'warning',
          notifyAuthorities: true,
          customMessage: `Tourist ${touristId} has left the designated safe zone for ${city}`,
        },
        riskLevel: 'low',
        metadata: {
          touristId,
          city,
          autoGenerated: true,
          category: 'tourist_zone',
        },
      });
    } catch (error) {
      console.error('Error creating tourist itinerary geo-fence:', error);
      return { success: false, message: 'Failed to create tourist itinerary geo-fence' };
    }
  }

  public async checkLocationAgainstGeoFences(point: { latitude: number; longitude: number }): Promise<GeoFence[]> {
    try {
      const matchingGeoFences: GeoFence[] = [];
      const pointData = { latitude: point.latitude, longitude: point.longitude };

      // Check against all active geo-fences
      for (const [geoFenceId, geoFence] of this.activeGeoFences) {
        const checkResult = this.checkPointInGeoFence(pointData, geoFence);
        
        if (checkResult.isInside) {
          matchingGeoFences.push(geoFence);
        }
      }

      return matchingGeoFences;
    } catch (error) {
      console.error('Error checking location against geo-fences:', error);
      throw new Error('Failed to check location against geo-fences');
    }
  }
}

export default GeoFencingService;
