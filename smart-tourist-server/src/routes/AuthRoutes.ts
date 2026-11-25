import express from 'express';
import { AuthService } from '../services/authService';
import { authenticateToken, requireRole } from '../middleware/auth';

const router = express.Router();
const authService = new AuthService();

// Register government official
router.post('/register/government', async (req, res) => {
  try {
    const { username, email, password, governmentId, profile } = req.body;

    // Validate required fields
    if (!username || !email || !password || !governmentId || !profile) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate government ID format (you can customize this)
    if (!/^GOV-[A-Z0-9]{8}$/.test(governmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid government ID format. Expected format: GOV-XXXXXXXX'
      });
    }

    const result = await authService.registerGovernmentOfficial({
      username,
      email,
      password,
      governmentId,
      profile
    });

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username/email and password are required'
      });
    }

    const result = await authService.login(
      identifier,
      password,
      req.ip || 'unknown',
      req.get('User-Agent') || 'unknown'
    );

    if (result.success) {
      // Set HTTP-only cookie for token
      res.cookie('authToken', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      return res.json({
        success: true,
        user: result.user,
        message: result.message
      });
    } else {
      return res.status(401).json(result);
    }
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.cookies.authToken || req.headers.authorization?.split(' ')[1];
    
    if (token) {
      await authService.logout(token);
    }

    res.clearCookie('authToken');
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create agent (government officials only)
router.post('/create-agent', authenticateToken, requireRole('government'), async (req, res) => {
  try {
    const { profile } = req.body;

    if (!profile) {
      return res.status(400).json({
        success: false,
        message: 'Agent profile is required'
      });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: user information missing'
      });
    }

    const result = await authService.createAgent(req.user._id, { profile });

    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Create agent error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Verify token (for client-side validation)
router.get('/verify', async (req, res) => {
  try {
    const token = req.cookies.authToken || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        valid: false,
        message: 'No token provided'
      });
    }

    const result = await authService.verifyToken(token);
    
    if (result.valid) {
      return res.json(result);
    } else {
      return res.status(401).json(result);
    }
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({
      valid: false,
      message: 'Internal server error'
    });
  }
});

// Sample government official creation endpoint (for development)
router.post('/create-sample-gov', async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Not available in production'
      });
    }

    const sampleGovData = {
      username: 'gov_admin',
      email: 'admin@government.in',
      password: 'GovAdmin@123',
      governmentId: 'GOV-ADMIN001',
      profile: {
        fullName: 'Government Administrator',
        department: 'Tourism Safety Department',
        phone: '+91-9876543210',
        address: {
          street: '123 Government Complex',
          city: 'New Delhi',
          state: 'Delhi',
          country: 'India',
          zipCode: '110001'
        }
      }
    };

    const result = await authService.registerGovernmentOfficial(sampleGovData);
    
    if (result.success) {
      return res.status(201).json({
        ...result,
        credentials: {
          username: sampleGovData.username,
          password: sampleGovData.password,
          governmentId: sampleGovData.governmentId
        }
      });
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Sample gov creation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
