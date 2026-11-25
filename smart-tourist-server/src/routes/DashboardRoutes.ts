import { Router, Request, Response } from 'express';
import { getCollections } from '../config/database';
import { ObjectId } from 'mongodb';

const router = Router();

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    
    // Get active tourists count
    const activeTourists = await collections.tourists.countDocuments({ isActive: true });
    
    // Get active alerts count
    const activeAlerts = await collections.geoFenceBreaches.countDocuments({ 
      isResolved: false,
      alertLevel: { $in: ['warning', 'danger'] }
    });
    
    // Get high-risk zones count
    const highRiskZones = await collections.geoFences.countDocuments({ 
      isActive: true,
      type: 'restricted_zone'
    });
    
    // Get tourists in danger
    const touristsInDanger = await collections.tourists.countDocuments({ 
      safetyStatus: 'Danger',
      isActive: true
    });
    
    // Get recent location updates count (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentLocationUpdates = await collections.locationHistory.countDocuments({
      timestamp: { $gte: oneHourAgo }
    });

    // Clinical triage tiers (MEWS + Isolation Forest)
    const [redTier, yellowTier, monitored, activeIncidents] = await Promise.all([
      collections.tourists.countDocuments({ isActive: true, 'health.tier': 'red' }),
      collections.tourists.countDocuments({ isActive: true, 'health.tier': 'yellow' }),
      collections.tourists.countDocuments({ isActive: true, health: { $exists: true } }),
      collections.alerts.countDocuments({ 'metadata.source': 'health_monitor', status: { $in: ['active', 'acknowledged'] } }),
    ]);

    // Response time: incident raised → rescue unit dispatched (or acknowledged), last 7 days, median.
    const responded = await collections.alerts
      .find(
        { 'timeline.createdAt': { $gte: new Date(Date.now() - 7 * 864e5) }, $or: [{ 'dispatch.dispatchedAt': { $exists: true } }, { 'timeline.acknowledgedAt': { $exists: true } }] },
        { projection: { 'timeline.createdAt': 1, 'timeline.acknowledgedAt': 1, 'dispatch.dispatchedAt': 1 } }
      )
      .toArray();
    const responseMinutes = responded
      .map((a: any) => (new Date(a.dispatch?.dispatchedAt ?? a.timeline.acknowledgedAt).getTime() - new Date(a.timeline.createdAt).getTime()) / 60_000)
      .filter((m) => Number.isFinite(m) && m >= 0)
      .sort((a, b) => a - b);
    const medianResponse = responseMinutes.length ? responseMinutes[Math.floor(responseMinutes.length / 2)] : null;

    const stats = {
      responseTime: {
        medianMinutes: medianResponse == null ? null : Math.round(medianResponse * 10) / 10,
        samples: responseMinutes.length,
      },
      activeTourists: {
        count: activeTourists,
        change: "+12.5%", // You can calculate this based on historical data
        changeType: "positive"
      },
      activeAlerts: {
        count: activeAlerts,
        change: activeAlerts > 0 ? `${activeAlerts} active` : "No active alerts",
        changeType: activeAlerts > 0 ? "negative" : "positive"
      },
      highRiskZones: {
        count: highRiskZones,
        change: "No change",
        changeType: "neutral"
      },
      touristsInDanger: {
        count: touristsInDanger,
        change: touristsInDanger > 0 ? `${touristsInDanger} in danger` : "All safe",
        changeType: touristsInDanger > 0 ? "negative" : "positive"
      },
      recentLocationUpdates: {
        count: recentLocationUpdates,
        change: "Last hour",
        changeType: "neutral"
      },
      health: {
        monitored,
        red: redTier,
        yellow: yellowTier,
        green: Math.max(0, monitored - redTier - yellowTier),
        activeIncidents
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('[Dashboard] Failed to get stats:', error);
    res.status(500).json({ message: 'Failed to get dashboard stats' });
  }
});

// GET /api/dashboard/tourists - Get all tourists with their current locations
router.get('/tourists', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const { includeInactive = false } = req.query;
    
    const filter: any = {};
    if (!includeInactive) {
      filter.isActive = true;
    }

    const tourists = await collections.tourists.find(filter, {
      projection: {
        digitalId: 1,
        'personalInfo.fullName': 1,
        'personalInfo.nationality': 1,
        'kyc.name': 1,
        'kyc.nationality': 1,
        currentLocation: 1,
        safetyStatus: 1,
        lastLocationUpdate: 1,
        isActive: 1,
        'health.tier': 1,
        'health.mews': 1,
        'health.anomalyScore': 1,
        'health.vitals': 1
      }
    }).toArray();

    // Transform data for frontend
    const transformedTourists = tourists.map((tourist: any) => ({
      _id: tourist._id,
      digitalId: tourist.digitalId,
      lastLocation: tourist.currentLocation ? {
        lat: tourist.currentLocation.latitude,
        lng: tourist.currentLocation.longitude,
        altitude: tourist.currentLocation.altitude,
        timestamp: tourist.currentLocation.timestamp,
        address: tourist.currentLocation.address
      } : null,
      safetyStatus: tourist.safetyStatus?.toLowerCase() || 'normal',
      kyc: {
        name: tourist.personalInfo?.fullName || tourist.kyc?.name,
        nationality: tourist.personalInfo?.nationality || tourist.kyc?.nationality
      },
      health: tourist.health ?? null,
      isActive: tourist.isActive,
      lastLocationUpdate: tourist.lastLocationUpdate
    }));

    res.json(transformedTourists);
  } catch (error) {
    console.error('[Dashboard] Failed to get tourists:', error);
    res.status(500).json({ message: 'Failed to get tourists data' });
  }
});



// GET /api/dashboard/geofences - Get all geo-fences
router.get('/geofences', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const { includeInactive = false } = req.query;
    
    const filter: any = {};
    if (!includeInactive) {
      filter.isActive = true;
    }

    const geoFences = await collections.geoFences.find(filter).toArray();
    res.json(geoFences);
  } catch (error) {
    console.error('[Dashboard] Failed to get geo-fences:', error);
    res.status(500).json({ message: 'Failed to get geo-fences data' });
  }
});

// GET /api/dashboard/tourist/:digitalId/history - Get location history for a specific tourist
router.get('/tourist/:digitalId/history', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const { digitalId } = req.params;
    const { limit = 100, hours = 24 } = req.query;
    
    const hoursAgo = new Date(Date.now() - Number(hours) * 60 * 60 * 1000);
    
    const locationHistory = await collections.locationHistory
      .find({
        touristId: digitalId,
        timestamp: { $gte: hoursAgo }
      })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .toArray();

    res.json(locationHistory);
  } catch (error) {
    console.error('[Dashboard] Failed to get tourist history:', error);
    res.status(500).json({ message: 'Failed to get tourist location history' });
  }
});

// POST /api/dashboard/geofence - Create a new geo-fence
router.post('/geofence', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const geoFenceData = req.body;
    
    // Add timestamps
    geoFenceData.createdAt = new Date();
    geoFenceData.updatedAt = new Date();
    
    const result = await collections.geoFences.insertOne(geoFenceData);
    
    res.status(201).json({
      success: true,
      geoFenceId: result.insertedId,
      message: 'Geo-fence created successfully'
    });
  } catch (error) {
    console.error('[Dashboard] Failed to create geo-fence:', error);
    res.status(500).json({ message: 'Failed to create geo-fence' });
  }
});

// PATCH /api/dashboard/alert/:alertId/resolve - Resolve an alert
router.patch('/alert/:alertId/resolve', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const { alertId } = req.params;
    const { resolvedBy, notes } = req.body;
    
    const result = await collections.geoFenceBreaches.updateOne(
      { _id: new ObjectId(alertId) },
      {
        $set: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy,
          notes
        }
      }
    );

    if (result.matchedCount > 0) {
      res.json({ success: true, message: 'Alert resolved successfully' });
    } else {
      res.status(404).json({ message: 'Alert not found' });
    }
  } catch (error) {
    console.error('[Dashboard] Failed to resolve alert:', error);
    res.status(500).json({ message: 'Failed to resolve alert' });
  }
});

// Helper function to calculate time ago
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return `${diffInSeconds} sec ago`;
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} min ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hr ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

// Enhanced Alert Management Routes

// POST /api/dashboard/alerts - Create a new alert (for testing)
router.post('/alerts', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();
    const { touristId, type, priority, location, message } = req.body;

    const alert = {
      touristId,
      type: type || 'distress',
      status: 'active',
      priority: priority || 'medium',
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || `${location.latitude}, ${location.longitude}`
      },
      message: message || 'Alert created',
      timeline: {
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'system'
      },
      metadata: {
        deviceInfo: {},
        networkInfo: {},
        batteryLevel: 100
      }
    };

    const result = await collections.alerts.insertOne(alert);

    // Update tourist safety status
    await collections.tourists.updateOne(
      { digitalId: touristId },
      { $set: { safetyStatus: 'Danger' } }
    );

    res.json({
      success: true,
      message: 'Alert created successfully',
      alertId: result.insertedId
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create alert'
    });
  }
});

// GET /api/dashboard/alerts - Get all alerts with pagination
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const priority = req.query.priority as string;

    const collections = await getCollections();

    const filter: any = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const total = await collections.alerts.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const alerts = await collections.alerts
      .find(filter)
      .sort({ 'timeline.createdAt': -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      }
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts'
    });
  }
});

// GET /api/dashboard/alerts/active - Get active alerts
router.get('/alerts/active', async (req: Request, res: Response) => {
  try {
    const collections = await getCollections();

    const activeAlerts = await collections.alerts
      .find({ status: { $in: ['active', 'acknowledged'] } })
      .sort({ 'timeline.createdAt': -1 })
      .toArray();

    res.json({
      success: true,
      data: activeAlerts
    });
  } catch (error) {
    console.error('Error fetching active alerts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active alerts'
    });
  }
});

// PUT /api/dashboard/alerts/:id/status - Update alert status
router.put('/alerts/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const userId = 'system'; // TODO: Get from authenticated user

    if (!['acknowledged', 'resolved', 'false_alarm'].includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
      return;
    }

    const collections = await getCollections();

    const updateData: any = {
      status,
      'timeline.updatedAt': new Date(),
    };

    if (status === 'acknowledged') {
      updateData['timeline.acknowledgedAt'] = new Date();
      updateData['timeline.acknowledgedBy'] = userId;
      updateData['assignedTo'] = userId;
    } else if (status === 'resolved' || status === 'false_alarm') {
      updateData['timeline.resolvedAt'] = new Date();
      updateData['timeline.resolvedBy'] = userId;
    }

    if (notes) {
      updateData['timeline.notes'] = notes;
    }

    const result = await collections.alerts.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({
        success: false,
        message: 'Alert not found'
      });
      return;
    }

    // If resolved, update tourist status back to normal if no other active alerts
    if (status === 'resolved') {
      const alert = await collections.alerts.findOne({ _id: new ObjectId(id) });
      if (alert) {
        const activeAlerts = await collections.alerts.countDocuments({
          touristId: alert.touristId,
          status: 'active'
        });

        if (activeAlerts === 0) {
          await collections.tourists.updateOne(
            { digitalId: alert.touristId },
            { $set: { safetyStatus: 'Normal' } }
          );
        }
      }
    }

    res.json({
      success: true,
      message: 'Alert status updated successfully'
    });
    return;
  } catch (error) {
    console.error('Error updating alert status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update alert status'
    });
    return;
  }
});

export default router;
