import { Router, Request, Response } from 'express';
import { NotificationService } from '../services/notificationService';
import { authenticateToken, canSendNotifications } from '../middleware/auth';

const router = Router();
const notificationService = new NotificationService();

// POST /api/notifications/send - Send notification to tourists in area
router.post('/send', authenticateToken, canSendNotifications, async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, message, type, targetLocation, expiresAt, metadata } = req.body;

    if (!title || !message || !type || !targetLocation) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: title, message, type, targetLocation'
      });
      return;
    }

    if (!targetLocation.city || !targetLocation.coordinates || !targetLocation.radius) {
      res.status(400).json({
        success: false,
        message: 'targetLocation must include city, coordinates, and radius'
      });
      return;
    }

    const result = await notificationService.createNotification({
      title,
      message,
      type,
      targetLocation,
      createdBy: req.user!._id!,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      metadata
    });

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send notification'
    });
  }
});

// GET /api/notifications - Get all notifications with pagination
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as 'advisory' | 'warning' | 'emergency' | 'info' | undefined;

    const result = await notificationService.getAllNotifications(page, limit, type);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
});

// GET /api/notifications/tourist/:touristId - Get notifications for specific tourist
router.get('/tourist/:touristId', async (req: Request, res: Response) => {
  try {
    const { touristId } = req.params;

    const notifications = await notificationService.getNotificationsForTourist(touristId);

    res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching tourist notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tourist notifications'
    });
  }
});

// PUT /api/notifications/:id/delivery-status - Update delivery status
router.put('/:id/delivery-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { touristId, status } = req.body;

    if (!touristId || !status) {
      return res.status(400).json({
        success: false,
        message: 'touristId and status are required'
      });
    }

    if (!['delivered', 'read', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: delivered, read, or failed'
      });
    }

    const result = await notificationService.updateDeliveryStatus(id, touristId, status);

    if (result.success) {
      res.json(result);
      return;
    } else {
      res.status(400).json(result);
      return;
    }
  } catch (error) {
    console.error('Error updating delivery status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update delivery status'
    });
    return;
  }
});

// GET /api/notifications/stats - Get notification statistics
router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const stats = await notificationService.getNotificationStatistics();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching notification statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification statistics'
    });
  }
});

export default router;
