const DatabaseModels = require('../models/index');
import { LocationUpdate } from '../models/Tourist';

export class LocationService {
  private models: any;

  constructor(models: any) {
    this.models = models;
  }

  async updateLocation(
    touristId: string,
    locationData: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      altitude?: number;
      speed?: number;
      heading?: number;
      address?: string;
      batteryLevel?: number;
      isEmergency?: boolean;
    }
  ) {
    try {
      // Verify tourist exists - check both digitalId and _id
      let tourist = await this.models.tourists.findOne({ digitalId: touristId });
      if (!tourist) {
        // Try finding by _id as fallback
        try {
          const { ObjectId } = require('mongodb');
          tourist = await this.models.tourists.findOne({ _id: new ObjectId(touristId) });
        } catch (e) {
          // Not a valid ObjectId, continue with original error
        }
      }

      if (!tourist) {
        console.error(`[Location] Tourist not found with ID: ${touristId}`);

        // Check if there are similar IDs (for debugging typos)
        const allTourists = await this.models.tourists.find({}).toArray();
        const similarIds = allTourists
          .map((t: any) => t.digitalId)
          .filter((id: string) => {
            // Check for similar IDs (same length, mostly same characters)
            if (id.length === touristId.length) {
              let differences = 0;
              for (let i = 0; i < id.length; i++) {
                if (id[i] !== touristId[i]) differences++;
              }
              return differences <= 2; // Allow up to 2 character differences
            }
            return false;
          });

        if (similarIds.length > 0) {
          console.log(`[Location] Similar IDs found (possible typos):`, similarIds);
          throw new Error(`Tourist not found. Did you mean one of these IDs? ${similarIds.join(', ')}`);
        } else {
          console.log(`[Location] Available tourists:`, allTourists.map((t: any) => ({ digitalId: t.digitalId, _id: t._id })));
          throw new Error('Tourist not found');
        }
      }

      console.log(`[Location] Found tourist: ${tourist.digitalId} (${tourist._id})`);

      // Validate location data
      if (
        typeof locationData.latitude !== 'number' ||
        typeof locationData.longitude !== 'number' ||
        locationData.latitude < -90 ||
        locationData.latitude > 90 ||
        locationData.longitude < -180 ||
        locationData.longitude > 180
      ) {
        throw new Error('Invalid latitude or longitude values');
      }

      // Create location update
      const locationUpdate: LocationUpdate = {
        touristId,
        location: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy,
          altitude: locationData.altitude,
          speed: locationData.speed,
          heading: locationData.heading,
        },
        timestamp: new Date(),
        address: locationData.address,
        batteryLevel: locationData.batteryLevel,
        isEmergency: locationData.isEmergency || false,
      };

      // Save location update to history
      await this.models.locationUpdates.insertOne(locationUpdate);

      // Update tourist's current location
      await this.models.tourists.updateOne(
        { _id: tourist._id },
        {
          $set: {
            currentLocation: {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              altitude: locationData.altitude,
              timestamp: new Date(),
              address: locationData.address,
            },
            lastLocationUpdate: new Date(),
          },
        }
      );

      console.log(`[Location] Updated location for tourist ${touristId}: (${locationData.latitude}, ${locationData.longitude})`);

      // Check for geofencing alerts or emergency conditions
      await this.checkLocationAlerts(touristId, locationData);

      return {
        success: true,
        message: 'Location updated successfully',
        timestamp: locationUpdate.timestamp,
      };
    } catch (error) {
      console.error('[Location] Failed to update location:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to update location');
    }
  }

  async getLocationHistory(
    touristId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      skip?: number;
      emergencyOnly?: boolean;
    } = {}
  ) {
    try {
      const { startDate, endDate, limit = 100, skip = 0, emergencyOnly = false } = options;

      const filter: any = { touristId };

      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) filter.timestamp.$gte = startDate;
        if (endDate) filter.timestamp.$lte = endDate;
      }

      if (emergencyOnly) {
        filter.isEmergency = true;
      }

      const locations = await this.models.locationUpdates
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();

      return locations;
    } catch (error) {
      console.error('[Location] Failed to get location history:', error);
      throw new Error('Failed to retrieve location history');
    }
  }

  async getCurrentLocation(touristId: string) {
    try {
      const tourist = await this.models.tourists.findOne(
        { digitalId: touristId },
        { projection: { currentLocation: 1, lastLocationUpdate: 1 } }
      );

      if (!tourist) {
        throw new Error('Tourist not found');
      }

      return {
        currentLocation: tourist.currentLocation,
        lastUpdate: tourist.lastLocationUpdate,
      };
    } catch (error) {
      console.error('[Location] Failed to get current location:', error);
      throw new Error('Failed to retrieve current location');
    }
  }

  async getAllTouristLocations(options: {
    includeInactive?: boolean;
    recentOnly?: boolean; // Only locations updated in the last 24 hours
  } = {}) {
    try {
      const { includeInactive = false, recentOnly = false } = options;

      const filter: any = {};
      if (!includeInactive) {
        filter.isActive = true;
      }

      if (recentOnly) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        filter.lastLocationUpdate = { $gte: yesterday };
      }

      const tourists = await this.models.tourists
        .find(filter, {
          projection: {
            digitalId: 1,
            'personalInfo.fullName': 1,
            safetyStatus: 1,
            currentLocation: 1,
            lastLocationUpdate: 1,
          },
        })
        .toArray();

      return tourists;
    } catch (error) {
      console.error('[Location] Failed to get all tourist locations:', error);
      throw new Error('Failed to retrieve tourist locations');
    }
  }

  private async checkLocationAlerts(
    touristId: string,
    locationData: {
      latitude: number;
      longitude: number;
      isEmergency?: boolean;
    }
  ) {
    try {
      // Check if this is an emergency location update
      if (locationData.isEmergency) {
        // Use require for AlertService to avoid circular import issues
        const { AlertService } = require('./alertService');
        const alertService = new AlertService(this.models);
        
        await alertService.triggerAlert(touristId, {
          type: 'Emergency',
          message: 'Emergency location update received',
          severity: 'High',
          location: {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
          },
          metadata: {
            source: 'location_service',
            automated: true,
          },
        });
      }

      // You can add more geofencing logic here:
      // - Check if tourist is in restricted areas
      // - Check if tourist is outside safe zones
      // - Check for unusual movement patterns
      // - Alert if tourist hasn't moved for too long

    } catch (error) {
      console.error('[Location] Failed to check location alerts:', error);
      // Don't throw here as this is a background check
    }
  }

  async getLocationStatistics(touristId: string, days: number = 7) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const locations = await this.models.locationUpdates
        .find({
          touristId,
          timestamp: { $gte: startDate },
        })
        .sort({ timestamp: 1 })
        .toArray();

      if (locations.length === 0) {
        return {
          totalUpdates: 0,
          averageAccuracy: 0,
          distanceTraveled: 0,
          batteryStats: null,
        };
      }

      // Calculate statistics
      let totalDistance = 0;
      let totalAccuracy = 0;
      let accuracyCount = 0;
      const batteryLevels: number[] = [];

      for (let i = 1; i < locations.length; i++) {
        const prev = locations[i - 1];
        const curr = locations[i];

        // Calculate distance between consecutive points
        const distance = this.calculateDistance(
          prev.location.latitude,
          prev.location.longitude,
          curr.location.latitude,
          curr.location.longitude
        );
        totalDistance += distance;

        // Accuracy statistics
        if (curr.location.accuracy) {
          totalAccuracy += curr.location.accuracy;
          accuracyCount++;
        }

        // Battery statistics
        if (curr.batteryLevel !== undefined) {
          batteryLevels.push(curr.batteryLevel);
        }
      }

      const batteryStats = batteryLevels.length > 0 ? {
        average: batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length,
        minimum: Math.min(...batteryLevels),
        maximum: Math.max(...batteryLevels),
      } : null;

      return {
        totalUpdates: locations.length,
        averageAccuracy: accuracyCount > 0 ? totalAccuracy / accuracyCount : 0,
        distanceTraveled: totalDistance,
        batteryStats,
      };
    } catch (error) {
      console.error('[Location] Failed to get location statistics:', error);
      throw new Error('Failed to retrieve location statistics');
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula to calculate distance between two points
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

module.exports = { LocationService };