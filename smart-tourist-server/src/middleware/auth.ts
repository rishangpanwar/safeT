import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getCollections } from '../config/database';
import { User } from '../models/User';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: Partial<User>;
    }
  }
}

// Authenticate JWT token
export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from cookie or Authorization header
    const token = req.cookies?.authToken || req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Verify token
    const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    const decoded = jwt.verify(token, jwtSecret) as any;

    // Get user from database
    const collections = await getCollections();
    const { ObjectId } = require('mongodb');

    // Try to find user by ObjectId or string ID
    let user;
    try {
      user = await collections.users.findOne({
        _id: new ObjectId(decoded.userId),
        isActive: true
      });
    } catch (error) {
      // If ObjectId conversion fails, try with string ID
      user = await collections.users.findOne({
        _id: decoded.userId,
        isActive: true
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token - user not found'
      });
    }

    // Check if session is still active
    const session = await collections.userSessions.findOne({
      token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Session expired or invalid'
      });
    }

    // Update last activity
    await collections.userSessions.updateOne(
      { token },
      { $set: { lastActivity: new Date() } }
    );

    // Remove password from user object
    const { password, ...userWithoutPassword } = user;
    req.user = userWithoutPassword;

    next();
    return;
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Require specific role
export const requireRole = (requiredRole: 'government' | 'agent') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== requiredRole) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${requiredRole} role required.`
      });
    }

    next();
    return;
  };
};

// Require specific permission
export const requirePermission = (permission: keyof User['permissions']) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.permissions || !req.user.permissions[permission]) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${permission} permission required.`
      });
    }

    next();
    return;
  };
};

// Check if user can manage alerts
export const canManageAlerts = requirePermission('canManageAlerts');

// Check if user can manage geo-fences
export const canManageGeoFences = requirePermission('canManageGeoFences');

// Check if user can send notifications
export const canSendNotifications = requirePermission('canSendNotifications');

// Check if user can create agents
export const canCreateAgents = requirePermission('canCreateAgents');

// Check if user can view analytics
export const canViewAnalytics = requirePermission('canViewAnalytics');

// Optional authentication (doesn't fail if no token)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.authToken || req.headers.authorization?.split(' ')[1];

    if (token) {
      const jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
      const decoded = jwt.verify(token, jwtSecret) as any;

      const collections = await getCollections();
      const { ObjectId } = require('mongodb');
      const user = await collections.users.findOne({
        _id: ObjectId.isValid(decoded.userId) ? new ObjectId(decoded.userId) : decoded.userId,
        isActive: true
      });

      if (user) {
        const { password, ...userWithoutPassword } = user;
        req.user = userWithoutPassword;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Rate limiting middleware
export const rateLimiter = (maxRequests: number, windowMs: number) => {
  const requests = new Map<string, { count: number; resetTime: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = req.ip || 'unknown';
    const now = Date.now();
    
    const clientData = requests.get(clientId);
    
    if (!clientData || now > clientData.resetTime) {
      requests.set(clientId, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }
    
    if (clientData.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.'
      });
    }
    
    clientData.count++;
    next();
  };
};

// Validate request body
export const validateBody = (requiredFields: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }
    
    next();
    return;
  };
};
