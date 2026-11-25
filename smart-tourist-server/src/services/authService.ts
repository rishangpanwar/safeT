import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getCollections } from '../config/database';
import { User, UserSession } from '../models/User';

export class AuthService {
  private jwtSecret: string;
  private jwtExpiry: string;
  private refreshTokenExpiry: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    this.jwtExpiry = '24h';
    this.refreshTokenExpiry = '7d';
  }

  // Generate random agent ID
  private generateAgentId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'AGT-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Generate random password
  private generatePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Hash password
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
  }

  // Verify password
  private async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(password, hashedPassword);
  }

  // Generate JWT token
  private generateToken(userId: string, role: string): string {
    return jwt.sign(
      { userId, role },
      this.jwtSecret,
      { expiresIn: this.jwtExpiry } as jwt.SignOptions
    );
  }

  // Generate refresh token
  private generateRefreshToken(): string {
    return jwt.sign(
      { type: 'refresh', timestamp: Date.now() },
      this.jwtSecret,
      { expiresIn: this.refreshTokenExpiry } as jwt.SignOptions
    );
  }

  // Register government official
  public async registerGovernmentOfficial(userData: {
    username: string;
    email: string;
    password: string;
    governmentId: string;
    profile: User['profile'];
  }): Promise<{ success: boolean; user?: Partial<User>; message: string }> {
    try {
      const collections = await getCollections();

      // Check if user already exists
      const existingUser = await collections.users.findOne({
        $or: [
          { email: userData.email },
          { username: userData.username },
          { governmentId: userData.governmentId }
        ]
      });

      if (existingUser) {
        return { success: false, message: 'User already exists with this email, username, or government ID' };
      }

      // Hash password
      const hashedPassword = await this.hashPassword(userData.password);

      // Create user
      const newUser: User = {
        username: userData.username,
        email: userData.email,
        password: hashedPassword,
        role: 'government',
        governmentId: userData.governmentId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        profile: userData.profile,
        permissions: {
          canRegisterTourists: true,
          canViewAlerts: true,
          canManageAlerts: true,
          canManageGeoFences: true,
          canSendNotifications: true,
          canCreateAgents: true,
          canViewAnalytics: true,
        }
      };

      const result = await collections.users.insertOne(newUser);
      
      // Return user without password
      const { password, ...userWithoutPassword } = newUser;
      userWithoutPassword._id = result.insertedId.toString();

      return {
        success: true,
        user: userWithoutPassword,
        message: 'Government official registered successfully'
      };
    } catch (error) {
      console.error('Error registering government official:', error);
      return { success: false, message: 'Registration failed' };
    }
  }

  // Create agent (by government official)
  public async createAgent(
    createdBy: string,
    agentData: {
      profile: User['profile'];
    }
  ): Promise<{ success: boolean; agent?: any; credentials?: { agentId: string; password: string }; message: string }> {
    try {
      const collections = await getCollections();

      // Verify creator is government official
      const creator = await collections.users.findOne({ _id: createdBy, role: 'government' });
      if (!creator) {
        return { success: false, message: 'Only government officials can create agents' };
      }

      // Generate credentials
      const agentId = this.generateAgentId();
      const password = this.generatePassword();
      const hashedPassword = await this.hashPassword(password);

      // Create agent
      const newAgent: User = {
        username: agentId,
        email: `${agentId.toLowerCase()}@agent.system`,
        password: hashedPassword,
        role: 'agent',
        agentId: agentId,
        createdBy: createdBy,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        profile: agentData.profile,
        permissions: {
          canRegisterTourists: true,
          canViewAlerts: true,
          canManageAlerts: false,
          canManageGeoFences: false,
          canSendNotifications: false,
          canCreateAgents: false,
          canViewAnalytics: false,
        }
      };

      const result = await collections.users.insertOne(newAgent);
      
      // Return agent without password
      const { password: _, ...agentWithoutPassword } = newAgent;
      agentWithoutPassword._id = result.insertedId.toString();

      return {
        success: true,
        agent: agentWithoutPassword,
        credentials: { agentId, password },
        message: 'Agent created successfully'
      };
    } catch (error) {
      console.error('Error creating agent:', error);
      return { success: false, message: 'Agent creation failed' };
    }
  }

  // Login
  public async login(
    identifier: string, // username, email, or agentId
    password: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ success: boolean; user?: Partial<User>; token?: string; refreshToken?: string; message: string }> {
    try {
      const collections = await getCollections();

      // Find user by username, email, or agentId
      const user = await collections.users.findOne({
        $or: [
          { username: identifier },
          { email: identifier },
          { agentId: identifier }
        ],
        isActive: true
      });

      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Verify password
      const isPasswordValid = await this.verifyPassword(password, user.password);
      if (!isPasswordValid) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Generate tokens
      const token = this.generateToken(user._id!.toString(), user.role);
      const refreshToken = this.generateRefreshToken();

      // Create session
      const session: UserSession = {
        userId: user._id!.toString(),
        token,
        refreshToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        createdAt: new Date(),
        lastActivity: new Date(),
        ipAddress,
        userAgent,
        isActive: true
      };

      await collections.userSessions.insertOne(session);

      // Return user without password
      const { password: _, ...userWithoutPassword } = user;

      return {
        success: true,
        user: userWithoutPassword,
        token,
        refreshToken,
        message: 'Login successful'
      };
    } catch (error) {
      console.error('Error during login:', error);
      return { success: false, message: 'Login failed' };
    }
  }

  // Verify token
  public async verifyToken(token: string): Promise<{ valid: boolean; user?: Partial<User>; message: string }> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      const collections = await getCollections();

      // The token carries the id as a string; users are stored with ObjectId _ids.
      const user = await collections.users.findOne({
        _id: ObjectId.isValid(decoded.userId) ? new ObjectId(decoded.userId) : decoded.userId,
        isActive: true
      });

      if (!user) {
        return { valid: false, message: 'User not found' };
      }

      // Update session activity
      await collections.userSessions.updateOne(
        { token, isActive: true },
        { $set: { lastActivity: new Date() } }
      );

      const { password, ...userWithoutPassword } = user;
      return { valid: true, user: userWithoutPassword, message: 'Token valid' };
    } catch (error) {
      return { valid: false, message: 'Invalid token' };
    }
  }

  // Logout
  public async logout(token: string): Promise<{ success: boolean; message: string }> {
    try {
      const collections = await getCollections();
      
      await collections.userSessions.updateOne(
        { token },
        { $set: { isActive: false } }
      );

      return { success: true, message: 'Logout successful' };
    } catch (error) {
      return { success: false, message: 'Logout failed' };
    }
  }
}
