import { Router, Request, Response } from 'express';
import { GeoFencingService } from '../services/geoFencingService';
import { authenticateToken, canManageGeoFences } from '../middleware/auth';

const router = Router();
const geoFencingService = new GeoFencingService();

// GET /api/geofences - Get all geo-fences with pagination
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    // Validate type parameter
    const validTypes = ['safe_zone', 'restricted_zone', 'alert_zone', 'emergency_zone'];
    const validatedType = type && validTypes.includes(type) ? type as 'safe_zone' | 'restricted_zone' | 'alert_zone' | 'emergency_zone' : undefined;

    const result = await geoFencingService.getAllGeoFences(page, limit, validatedType, isActive);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching geo-fences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch geo-fences'
    });
  }
});

// POST /api/geofences - Create new geo-fence
router.post('/', authenticateToken, canManageGeoFences, async (req: Request, res: Response) => {
  try {
    const { name, description, type, geometry, alertSettings, riskLevel, metadata } = req.body;

    if (!name || !type || !geometry) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, type, geometry'
      });
    }

    if (!geometry.type || !geometry.coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Geometry must include type and coordinates'
      });
    }

    if (geometry.type === 'Circle' && !geometry.radius) {
      return res.status(400).json({
        success: false,
        message: 'Circle geometry must include radius'
      });
    }

    const result = await geoFencingService.createGeoFence({
      name,
      description: description || '',
      type,
      geometry,
      createdBy: req.user!._id!,
      alertSettings,
      riskLevel,
      metadata
    });

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error creating geo-fence:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create geo-fence'
    });
  }
});

// PUT /api/geofences/:id - Update geo-fence
router.put('/:id', authenticateToken, canManageGeoFences, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.createdBy;

    const result = await geoFencingService.updateGeoFence(id, updateData, req.user!._id!);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error updating geo-fence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update geo-fence'
    });
  }
});

// DELETE /api/geofences/:id - Delete geo-fence
router.delete('/:id', authenticateToken, canManageGeoFences, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await geoFencingService.deleteGeoFence(id);

    if (result) {
      res.json({
        success: true,
        message: 'Geo-fence deleted successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Failed to delete geo-fence'
      });
    }
  } catch (error) {
    console.error('Error deleting geo-fence:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete geo-fence'
    });
  }
});

// GET /api/geofences/high-risk - Get high-risk zones
router.get('/high-risk', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await geoFencingService.getAllGeoFences(1, 100, 'restricted_zone', true);

    res.json({
      success: true,
      data: result.geoFences
    });
  } catch (error) {
    console.error('Error fetching high-risk zones:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch high-risk zones'
    });
  }
});

// POST /api/geofences/tourist-zone - Create automatic tourist zone
router.post('/tourist-zone', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { touristId, city, coordinates } = req.body;

    if (!touristId || !city || !coordinates) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: touristId, city, coordinates'
      });
    }

    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Coordinates must be an array of [longitude, latitude]'
      });
    }

    const result = await geoFencingService.createTouristItineraryGeoFence(
      touristId,
      city,
      coordinates as [number, number],
      req.user!._id!
    );

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error creating tourist zone:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create tourist zone'
    });
  }
});

// GET /api/geofences/coordinates/:lat/:lng - Get geo-fences at specific coordinates
router.get('/coordinates/:lat/:lng', async (req: Request, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.params.lat);
    const lng = parseFloat(req.params.lng);

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
      return;
    }

    const geoFences = await geoFencingService.checkLocationAgainstGeoFences({
      latitude: lat,
      longitude: lng
    });

    res.json({
      success: true,
      data: geoFences
    });
  } catch (error) {
    console.error('Error checking geo-fences at coordinates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check geo-fences'
    });
  }
});

export default router;
