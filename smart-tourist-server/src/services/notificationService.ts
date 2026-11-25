import { getCollections } from '../config/database';
import { Notification } from '../models/User';
import * as geolib from 'geolib';

export class NotificationService {
  // Create and send notification
  public async createNotification(notificationData: {
    title: string;
    message: string;
    type: Notification['type'];
    targetLocation: {
      city: string;
      coordinates: {
        latitude: number;
        longitude: number;
      };
      radius: number;
    };
    createdBy: string;
    expiresAt?: Date;
    metadata?: Notification['metadata'];
  }): Promise<{ success: boolean; notification?: Notification; recipientCount?: number; message: string }> {
    try {
      const collections = await getCollections();

      // Create notification
      const newNotification: any = {
        ...notificationData,
        createdAt: new Date(),
        isActive: true,
        recipients: [],
      };

      const result = await collections.notifications.insertOne(newNotification);
      newNotification._id = result.insertedId.toString();

      // Find tourists within the target area
      const coordinates = [
        notificationData.targetLocation.coordinates.longitude,
        notificationData.targetLocation.coordinates.latitude
      ];
      const recipients = await this.findTouristsInArea(
        coordinates,
        notificationData.targetLocation.radius
      );

      // Send notification to each recipient
      const recipientUpdates = [];
      for (const tourist of recipients) {
        recipientUpdates.push({
          touristId: tourist.digitalId,
          sentAt: new Date(),
          deliveryStatus: 'sent' as const,
        });
      }

      // Update notification with recipients
      await collections.notifications.updateOne(
        { _id: result.insertedId },
        { $set: { recipients: recipientUpdates } }
      );

      console.log(`[Notification] Created notification "${notificationData.title}" for ${recipients.length} tourists in ${notificationData.targetLocation.city}`);

      return {
        success: true,
        notification: newNotification,
        recipientCount: recipients.length,
        message: `Notification sent to ${recipients.length} tourists`
      };
    } catch (error) {
      console.error('Error creating notification:', error);
      return { success: false, message: 'Failed to create notification' };
    }
  }

  // Find tourists within a specific area
  private async findTouristsInArea(
    centerCoordinates: number[],
    radiusKm: number
  ): Promise<any[]> {
    try {
      const collections = await getCollections();

      // Get all active tourists with recent location data
      const tourists = await collections.tourists.find({
        $and: [
          { isActive: { $ne: false } }, // Include active tourists
          {
            $or: [
              { lastLocationUpdate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
              { currentLocation: { $exists: true } }, // Within last 24 hours
              { lastLocation: { $exists: true } } // Or has location data
            ]
          }
        ]
      }).toArray();

      console.log(`Found ${tourists.length} tourists for notification`);
      console.log('Target coordinates:', centerCoordinates, 'Radius:', radiusKm);

      const touristsInArea = [];

      for (const tourist of tourists) {
        const touristAny = tourist as any;
        console.log(`Processing tourist ${touristAny.digitalId}:`, {
          hasCurrentLocation: !!touristAny.currentLocation,
          currentLocation: touristAny.currentLocation,
          hasLastLocation: !!touristAny.lastLocation,
          lastLocation: touristAny.lastLocation,
          isActive: touristAny.isActive,
          lastLocationUpdate: touristAny.lastLocationUpdate
        });

        let touristLocation = null;

        // First check if tourist has currentLocation in their document
        if (touristAny.currentLocation && touristAny.currentLocation.latitude && touristAny.currentLocation.longitude) {
          touristLocation = {
            latitude: touristAny.currentLocation.latitude,
            longitude: touristAny.currentLocation.longitude
          };
          console.log(`Found location in tourist document: ${touristLocation.latitude}, ${touristLocation.longitude}`);
        } else if (touristAny.lastLocation && touristAny.lastLocation.lat && touristAny.lastLocation.lng) {
          // Fallback to lastLocation field if it exists
          touristLocation = {
            latitude: touristAny.lastLocation.lat,
            longitude: touristAny.lastLocation.lng
          };
          console.log(`Found location in lastLocation field: ${touristLocation.latitude}, ${touristLocation.longitude}`);
        } else {
          console.log(`No location in tourist document, checking locationHistory...`);
          // Fallback to locationHistory collection
          const latestLocation = await collections.locationHistory.findOne(
            { touristId: touristAny.digitalId },
            { sort: { timestamp: -1 } }
          );

          if (latestLocation) {
            touristLocation = {
              latitude: latestLocation.location.latitude,
              longitude: latestLocation.location.longitude
            };
            console.log(`Found location in locationHistory: ${touristLocation.latitude}, ${touristLocation.longitude}`);
          } else {
            console.log(`No location found in locationHistory for ${touristAny.digitalId}`);
          }
        }

        if (touristLocation) {
          const centerPoint = { latitude: centerCoordinates[1], longitude: centerCoordinates[0] };
          const touristPoint = { latitude: touristLocation.latitude, longitude: touristLocation.longitude };

          console.log(`Calculating distance between:`, {
            center: centerPoint,
            tourist: touristPoint
          });

          const distance = geolib.getDistance(centerPoint, touristPoint);

          // Convert distance from meters to kilometers
          const distanceKm = distance / 1000;

          console.log(`Tourist ${touristAny.digitalId} at ${touristLocation.latitude}, ${touristLocation.longitude} - Distance: ${distanceKm}km`);

          if (distanceKm <= radiusKm) {
            touristsInArea.push(tourist);
            console.log(`Tourist ${touristAny.digitalId} is within range`);
          } else {
            console.log(`Tourist ${touristAny.digitalId} is outside range (${distanceKm}km > ${radiusKm}km)`);
          }
        } else {
          console.log(`No location data found for tourist ${touristAny.digitalId}`);
        }
      }

      console.log(`Found ${touristsInArea.length} tourists in target area`);

      return touristsInArea;
    } catch (error) {
      console.error('Error finding tourists in area:', error);
      return [];
    }
  }

  // Get notifications for a specific tourist
  public async getNotificationsForTourist(touristId: string): Promise<Notification[]> {
    try {
      const collections = await getCollections();

      console.log(`[Notification] Fetching notifications for tourist: ${touristId}`);

      // First, let's check all notifications for this tourist (without filters)
      const allNotifications = await collections.notifications.find({
        'recipients.touristId': touristId
      }).sort({ createdAt: -1 }).toArray();

      console.log(`[Notification] All notifications for ${touristId}: ${allNotifications.length}`);
      allNotifications.forEach(n => {
        console.log(`  - ${n.title} (${n._id}) - Active: ${n.isActive}, Expires: ${n.expiresAt}`);
      });

      const query = {
        'recipients.touristId': touristId,
        isActive: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } }
        ]
      };

      console.log(`[Notification] Query:`, JSON.stringify(query, null, 2));

      const notifications = await collections.notifications.find(query).sort({ createdAt: -1 }).toArray();

      console.log(`[Notification] Found ${notifications.length} notifications for ${touristId}`);
      notifications.forEach(n => {
        console.log(`  - ${n.title} (${n._id}) - Recipients: ${n.recipients?.length || 0}`);
      });

      return notifications;
    } catch (error) {
      console.error('Error fetching tourist notifications:', error);
      return [];
    }
  }

  // Get all notifications with pagination
  public async getAllNotifications(
    page: number = 1,
    limit: number = 20,
    type?: Notification['type']
  ): Promise<{ notifications: Notification[]; total: number; page: number; totalPages: number }> {
    try {
      const collections = await getCollections();
      
      const filter: any = {};
      if (type) filter.type = type;

      const total = await collections.notifications.countDocuments(filter);
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;

      const notifications = await collections.notifications
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return { notifications, total, page, totalPages };
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return { notifications: [], total: 0, page: 1, totalPages: 0 };
    }
  }

  // Update notification delivery status
  public async updateDeliveryStatus(
    notificationId: string,
    touristId: string,
    status: 'delivered' | 'read' | 'failed'
  ): Promise<{ success: boolean; message: string }> {
    try {
      const collections = await getCollections();

      const result = await collections.notifications.updateOne(
        { 
          _id: notificationId,
          'recipients.touristId': touristId 
        },
        { 
          $set: { 
            'recipients.$.deliveryStatus': status,
            'recipients.$.updatedAt': new Date()
          } 
        }
      );

      if (result.matchedCount === 0) {
        return { success: false, message: 'Notification or recipient not found' };
      }

      return { success: true, message: 'Delivery status updated' };
    } catch (error) {
      console.error('Error updating delivery status:', error);
      return { success: false, message: 'Failed to update delivery status' };
    }
  }

  // Deactivate expired notifications
  public async deactivateExpiredNotifications(): Promise<void> {
    try {
      const collections = await getCollections();

      await collections.notifications.updateMany(
        {
          isActive: true,
          expiresAt: { $lt: new Date() }
        },
        { $set: { isActive: false } }
      );

      console.log('[Notification] Deactivated expired notifications');
    } catch (error) {
      console.error('Error deactivating expired notifications:', error);
    }
  }

  // Get notification statistics
  public async getNotificationStatistics(): Promise<{
    total: number;
    active: number;
    expired: number;
    byType: { [key: string]: number };
    recentActivity: { date: string; count: number }[];
  }> {
    try {
      const collections = await getCollections();

      const [
        total,
        active,
        expired,
        typeStats,
        recentActivity
      ] = await Promise.all([
        collections.notifications.countDocuments(),
        collections.notifications.countDocuments({ isActive: true }),
        collections.notifications.countDocuments({ 
          isActive: false,
          expiresAt: { $lt: new Date() }
        }),
        collections.notifications.aggregate([
          { $group: { _id: '$type', count: { $sum: 1 } } }
        ]).toArray(),
        collections.notifications.aggregate([
          {
            $match: {
              createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
            }
          },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]).toArray()
      ]);

      const byType: { [key: string]: number } = {};
      typeStats.forEach(stat => {
        byType[stat._id] = stat.count;
      });

      const recentActivityFormatted = recentActivity.map(activity => ({
        date: activity._id,
        count: activity.count
      }));

      return {
        total,
        active,
        expired,
        byType,
        recentActivity: recentActivityFormatted
      };
    } catch (error) {
      console.error('Error fetching notification statistics:', error);
      return {
        total: 0,
        active: 0,
        expired: 0,
        byType: {},
        recentActivity: []
      };
    }
  }
}
