import { Router, Request, Response } from "express";
const DatabaseModels = require("../models/index");
const { RegistrationService } = require("../services/registrationService");
const { AlertService } = require("../services/alertService");
const { LocationService } = require("../services/locationService");
const { getDb } = require("../config/mongodb");
const { getCollections } = require("../config/database");
const { ObjectId } = require("mongodb");
const { issueHealthIdentity, validateHealthInput } = require("../services/healthIdentityService");

const router = Router();

// Initialize services (we'll pass the database instance when available)
let registrationService: any;
let alertService: any;
let locationService: any;

// Initialize services with database connection
const initializeServices = async () => {
  const db = await getDb();
  const models = new DatabaseModels(db);
  
  registrationService = new RegistrationService(models);
  alertService = new AlertService(models);
  locationService = new LocationService(models);
};

// Call initialization
initializeServices().catch(console.error);

// POST /api/tourists/register -> Register a new tourist
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { kyc, itinerary, emergencyContacts, tripDurationDays, health } = req.body;

    if (!kyc || !itinerary || !emergencyContacts || !tripDurationDays) {
      return res.status(400).json({
        message: "Missing required fields"
      });
    }

    const healthError = validateHealthInput(health);
    if (healthError) {
      return res.status(400).json({ message: healthError });
    }

    const collections = await getCollections();
    const validUntil = new Date(Date.now() + (tripDurationDays * 24 * 60 * 60 * 1000));

    // Phase 1: hash + encrypt the clinical profile and mint the soulbound health permit
    const healthProfile = health
      ? await issueHealthIdentity({ fullName: kyc.name, input: health, validUntil })
      : undefined;

    // Generate digital ID (simple format for now)
    const digitalId = `TID-${Date.now()}${Math.random().toString(36).substr(2, 6)}`;

    // Create tourist data
    const touristData = {
      digitalId,
      kyc: {
        name: kyc.name,
        nationality: kyc.nationality,
        passportNumber: kyc.passportNumber || kyc.passport,
        phoneNumber: kyc.phoneNumber,
        emergencyContact: emergencyContacts
      },
      itinerary: {
        startDate: itinerary.startDate,
        endDate: itinerary.endDate,
        destinations: itinerary.destinations || [],
        accommodations: itinerary.accommodations || [],
        activities: itinerary.activities || []
      },
      safetyStatus: "safe",
      isActive: true,
      registeredAt: new Date().toISOString(),
      lastLocationUpdate: new Date().toISOString(),
      validUntil: validUntil.toISOString(),
      ...(healthProfile ? { healthProfile } : {})
    };

    const result = await collections.tourists.insertOne(touristData);

    console.log(`[API] Registered tourist with ID: ${digitalId}`);

    return res.status(201).json({
      message: "Tourist registered successfully",
      digitalId: digitalId,
      dbId: result.insertedId,
      ...(healthProfile ? {
        healthPermit: {
          tokenId: healthProfile.tokenId,
          clinicalHash: healthProfile.clinicalHash,
          network: healthProfile.sbt.network,
          txHash: healthProfile.sbt.txHash,
          soul: healthProfile.sbt.soul,
        }
      } : {})
    });
  } catch (error: any) {
    console.error("Registration failed:", error);
    return res.status(error?.status ?? 500).json({
      message: error?.status ? error.message : "Internal server error"
    });
  }
});

// GET /api/tourists -> Get all tourists for the dashboard
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!registrationService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const {
      includeInactive = false,
      limit = 1000,
      skip = 0,
      includeSensitiveData = false,
    } = req.query;

    // Validate query parameters (optional, but ensures all paths return)
    if (
      typeof includeInactive !== 'string' ||
      typeof limit !== 'string' ||
      typeof skip !== 'string' ||
      typeof includeSensitiveData !== 'string'
    ) {
      return res.status(400).json({ message: "Invalid query parameters" });
    }

    const tourists = await registrationService.getAllTourists({
      includeInactive: includeInactive === 'true',
      limit: parseInt(limit as string) || 1000,
      skip: parseInt(skip as string) || 0,
      includeSensitiveData: includeSensitiveData === 'true',
    });

    return res.json(tourists);
  } catch (error) {
    console.error('[Routes] Failed to get tourists:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Internal Server Error' 
    });
  }
});

// PATCH /api/tourists/:digitalId/location -> Update tourist location from mobile
router.patch("/:digitalId/location", async (req: Request, res: Response) => {
  try {
    if (!locationService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const { lat, lng, accuracy, altitude, speed, heading, address, batteryLevel, isEmergency } = req.body;

    if (!digitalId || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: "Missing digitalId or location data" });
    }

    const result = await locationService.updateLocation(digitalId, {
      latitude: lat,
      longitude: lng,
      accuracy,
      altitude,
      speed,
      heading,
      address,
      batteryLevel,
      isEmergency,
    });

    // Geo-fence / geo-medical zone breach detection + live map broadcast
    req.app.locals.realtime?.handleRestLocation(digitalId, { latitude: lat, longitude: lng, altitude });

    return res.json(result);
  } catch (error) {
    console.error('[Routes] Location update failed:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Location update failed' 
    });
  }
});

// PATCH /api/tourists/:digitalId/alert -> Trigger a panic alert from mobile
router.patch("/:digitalId/alert", async (req: Request, res: Response) => {
  try {
    if (!alertService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;

    if (!digitalId) {
      return res.status(400).json({ message: "Missing digitalId" });
    }

    // Trigger panic alert
    const result = await alertService.updatePanicAlert(digitalId);

    return res.json(result);
  } catch (error) {
    console.error('[Routes] Alert trigger failed:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Alert trigger failed' 
    });
  }
});

// GET /api/tourists/:digitalId -> Get specific tourist details
router.get("/:digitalId", async (req: Request, res: Response) => {
  try {
    if (!registrationService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const tourist = await registrationService.getTouristByDigitalId(digitalId);

    if (!tourist) {
      return res.status(404).json({ message: "Tourist not found" });
    }

    // Never hand out the encrypted clinical blob; the phone gets it as a signed QR instead.
    const { healthProfile, ...publicTourist } = tourist as any;
    return res.json({
      ...publicTourist,
      healthProfile: healthProfile
        ? { tokenId: healthProfile.tokenId, sbt: healthProfile.sbt, validUntil: healthProfile.validUntil }
        : undefined,
    });
  } catch (error) {
    console.error('[Routes] Failed to get tourist:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to retrieve tourist' 
    });
  }
});

// GET /api/tourists/:digitalId/location -> Get tourist's current location
router.get("/:digitalId/location", async (req: Request, res: Response) => {
  try {
    if (!locationService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const location = await locationService.getCurrentLocation(digitalId);

    if (!location) {
      return res.status(404).json({ message: "Location not found" });
    }

    return res.json(location);
  } catch (error) {
    console.error('[Routes] Failed to get location:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to retrieve location' 
    });
  }
});

// GET /api/tourists/:digitalId/location/history -> Get tourist's location history
router.get("/:digitalId/location/history", async (req: Request, res: Response) => {
  try {
    if (!locationService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const { startDate, endDate, limit, skip, emergencyOnly } = req.query;

    const history = await locationService.getLocationHistory(digitalId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined,
      emergencyOnly: emergencyOnly === 'true',
    });

    return res.json(history);
  } catch (error) {
    console.error('[Routes] Failed to get location history:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to retrieve location history' 
    });
  }
});

// GET /api/tourists/:digitalId/alerts -> Get tourist's alerts
router.get("/:digitalId/alerts", async (req: Request, res: Response) => {
  try {
    if (!alertService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const { status, limit, skip } = req.query;

    const alerts = await alertService.getAlertsByTourist(digitalId, {
      status: status as any,
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined,
    });

    return res.json(alerts);
  } catch (error) {
    console.error('[Routes] Failed to get alerts:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to retrieve alerts' 
    });
  }
});

// POST /api/tourists/:digitalId/alerts -> Create custom alert
router.post("/:digitalId/alerts", async (req: Request, res: Response) => {
  try {
    if (!alertService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { digitalId } = req.params;
    const { type, message, severity, location, metadata } = req.body;

    if (!type || !message || !severity) {
      return res.status(400).json({ message: "Missing required alert fields" });
    }

    const result = await alertService.triggerAlert(digitalId, {
      type,
      message,
      severity,
      location,
      metadata,
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('[Routes] Failed to create alert:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to create alert' 
    });
  }
});

// GET /api/alerts -> Get all active alerts (for dashboard)
router.get("/alerts/active", async (req: Request, res: Response) => {
  try {
    if (!alertService) {
      return res.status(503).json({ message: "Service not initialized" });
    }

    const { severity, limit, skip } = req.query;

    const alerts = await alertService.getAllActiveAlerts({
      severity: severity as any,
      limit: limit ? parseInt(limit as string) : undefined,
      skip: skip ? parseInt(skip as string) : undefined,
    });

    return res.json(alerts);
  } catch (error) {
    console.error('[Routes] Failed to get active alerts:', error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : 'Failed to retrieve active alerts' 
    });
  }
});

// GET /api/tourists/:id/profile - Get tourist profile
router.get('/:id/profile', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const collections = await getCollections();

    const tourist = await collections.tourists.findOne({ digitalId: id });

    if (!tourist) {
      return res.status(404).json({
        success: false,
        message: 'Tourist not found'
      });
    }

    res.json({
      success: true,
      tourist: {
        digitalId: tourist.digitalId,
        kyc: tourist.kyc || {},
        itinerary: tourist.itinerary || {},
        safetyStatus: tourist.safetyStatus || 'safe',
        lastLocationUpdate: tourist.lastLocationUpdate || new Date().toISOString()
      }
    });
    return;
  } catch (error) {
    console.error('Error fetching tourist profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
    return;
  }
});

// PUT /api/tourists/:id/itinerary - Update tourist itinerary
router.put('/:id/itinerary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { itinerary } = req.body;
    const collections = await getCollections();

    const result = await collections.tourists.updateOne(
      { digitalId: id },
      {
        $set: {
          itinerary: itinerary,
          lastLocationUpdate: new Date().toISOString()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tourist not found'
      });
    }

    res.json({
      success: true,
      message: 'Itinerary updated successfully'
    });
    return;
  } catch (error) {
    console.error('Error updating itinerary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update itinerary'
    });
    return;
  }
});

module.exports = router;
