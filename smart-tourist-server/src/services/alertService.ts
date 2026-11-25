import { getCollections } from '../config/database';
import { Alert } from '../models/Tourist';
import { ObjectId } from 'mongodb';

export class AlertService {
  private models: any;

  constructor(models?: any) {
    this.models = models;
  }

  private async getModels() {
    if (!this.models) {
      return await getCollections();
    }
    return this.models;
  }

  private mapSeverityToPriority(severity: string): string {
    switch (severity.toLowerCase()) {
      case 'critical': return 'critical';
      case 'high': return 'high';
      case 'medium': return 'medium';
      case 'low': return 'low';
      default: return 'medium';
    }
  }

  async triggerAlert(
    touristId: string,
    alertData: {
      type: 'Emergency' | 'Check-in' | 'Location' | 'Custom';
      message: string;
      severity: 'Low' | 'Medium' | 'High' | 'Critical';
      location?: {
        latitude: number;
        longitude: number;
        address?: string;
      };
      metadata?: {
        [key: string]: any;
      };
    }
  ) {
    try {
      const collections = await this.getModels();

      // Verify tourist exists
      const tourist = await collections.tourists.findOne({ digitalId: touristId });
      if (!tourist) {
        throw new Error('Tourist not found');
      }

      // Create alert in new format
      const alert = {
        touristId,
        type: alertData.type.toLowerCase(),
        status: 'active',
        priority: this.mapSeverityToPriority(alertData.severity),
        location: alertData.location ? {
          latitude: alertData.location.latitude,
          longitude: alertData.location.longitude,
          address: alertData.location.address || `${alertData.location.latitude}, ${alertData.location.longitude}`
        } : tourist.currentLocation,
        message: alertData.message,
        timeline: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'mobile_app'
        },
        metadata: {
          ...alertData.metadata,
          source: 'mobile_app',
          deviceInfo: {},
          networkInfo: {},
          batteryLevel: 100
        }
      };

      // Save alert to database
      const result = await collections.alerts.insertOne(alert);

      // Update tourist's safety status based on alert severity
      let newSafetyStatus: 'Normal' | 'Alert' | 'Danger' = 'Normal';
      if (alertData.severity === 'Critical' || alertData.type === 'Emergency') {
        newSafetyStatus = 'Danger';
      } else if (alertData.severity === 'High' || alertData.severity === 'Medium') {
        newSafetyStatus = 'Alert';
      }

      // Update tourist's status
      await collections.tourists.updateOne(
        { digitalId: touristId },
        {
          $set: {
            safetyStatus: newSafetyStatus,
            lastLocationUpdate: new Date(),
          },
        }
      );

      console.log(`[Alert] ${alertData.type} alert triggered for tourist ${touristId} with severity ${alertData.severity}`);

      return {
        success: true,
        alertId: result.insertedId,
        message: 'Alert triggered successfully',
        safetyStatusUpdated: newSafetyStatus,
      };
    } catch (error) {
      console.error('[Alert] Failed to trigger alert:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to trigger alert');
    }
  }

  async updatePanicAlert(touristId: string) {
    try {
      // This is specifically for the panic button - critical emergency
      return await this.triggerAlert(touristId, {
        type: 'Emergency',
        message: 'PANIC BUTTON ACTIVATED - Tourist in immediate danger',
        severity: 'Critical',
        metadata: {
          source: 'panic_button',
          automated: true,
        },
      });
    } catch (error) {
      console.error('[Alert] Failed to trigger panic alert:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to trigger panic alert');
    }
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string) {
    try {
      const collections = await this.getModels();
      const result = await collections.alerts.updateOne(
        { _id: new ObjectId(alertId) },
        {
          $set: {
            status: 'acknowledged',
            'timeline.acknowledgedAt': new Date(),
            'timeline.acknowledgedBy': acknowledgedBy,
            'timeline.updatedAt': new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('Alert not found');
      }

      return {
        success: true,
        message: 'Alert acknowledged successfully',
      };
    } catch (error) {
      console.error('[Alert] Failed to acknowledge alert:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to acknowledge alert');
    }
  }

  async resolveAlert(alertId: string, resolvedBy: string) {
    try {
      const result = await this.models.alerts.updateOne(
        { _id: new ObjectId(alertId) },
        {
          $set: {
            status: 'Resolved',
            resolvedAt: new Date(),
            acknowledgedBy: resolvedBy, // Also mark as acknowledged
          },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('Alert not found');
      }

      // Check if this was the last active alert for the tourist
      const alert = await this.models.alerts.findOne({ _id: new ObjectId(alertId) });
      if (alert) {
        const activeAlerts = await this.models.alerts.countDocuments({
          touristId: alert.touristId,
          status: 'Active',
        });

        // If no more active alerts, reset tourist status to normal
        if (activeAlerts === 0) {
          await this.models.tourists.updateOne(
            { digitalId: alert.touristId },
            {
              $set: {
                safetyStatus: 'Normal',
                lastLocationUpdate: new Date(),
              },
            }
          );
        }
      }

      return {
        success: true,
        message: 'Alert resolved successfully',
      };
    } catch (error) {
      console.error('[Alert] Failed to resolve alert:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to resolve alert');
    }
  }

  async getAlertsByTourist(touristId: string, options: {
    status?: 'Active' | 'Acknowledged' | 'Resolved';
    limit?: number;
    skip?: number;
  } = {}) {
    try {
      const { status, limit = 100, skip = 0 } = options;

      const filter: any = { touristId };
      if (status) {
        filter.status = status;
      }

      const alerts = await this.models.alerts
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();

      return alerts;
    } catch (error) {
      console.error('[Alert] Failed to get alerts:', error);
      throw new Error('Failed to retrieve alerts');
    }
  }

  async getAllActiveAlerts(options: {
    severity?: 'Low' | 'Medium' | 'High' | 'Critical';
    limit?: number;
    skip?: number;
  } = {}) {
    try {
      const { severity, limit = 100, skip = 0 } = options;

      const filter: any = { status: 'Active' };
      if (severity) {
        filter.severity = severity;
      }

      const alerts = await this.models.alerts
        .find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();

      return alerts;
    } catch (error) {
      console.error('[Alert] Failed to get active alerts:', error);
      throw new Error('Failed to retrieve active alerts');
    }
  }
}

module.exports = { AlertService };