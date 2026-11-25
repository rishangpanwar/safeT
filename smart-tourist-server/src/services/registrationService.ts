import { v4 as uuidv4 } from 'uuid';
const DatabaseModels = require('../models/index');
import { Tourist } from '../models/Tourist';

export class RegistrationService {
  private models: any;

  constructor(models: any) {
    this.models = models;
  }

  async registerTourist(registrationData: {
    kyc: {
      fullName: string;
      email: string;
      phone: string;
      dateOfBirth: string;
      nationality: string;
      passportNumber: string;
      address: {
        street: string;
        city: string;
        state: string;
        country: string;
        zipCode: string;
      };
    };
    itinerary: {
      destination: string;
      arrivalDate: string;
      departureDate: string;
      accommodation: string;
      localGuide?: string;
    };
    emergencyContacts: {
      name: string;
      relationship: string;
      phone: string;
      email: string;
    };
    tripDurationDays: number;
  }) {
    try {
      // Generate unique digital ID
      const digitalId = uuidv4();

      // Create tourist object
      const tourist: Tourist = {
        digitalId,
        personalInfo: {
          fullName: registrationData.kyc.fullName,
          email: registrationData.kyc.email,
          phone: registrationData.kyc.phone,
          dateOfBirth: registrationData.kyc.dateOfBirth,
          nationality: registrationData.kyc.nationality,
          passportNumber: registrationData.kyc.passportNumber,
          address: registrationData.kyc.address,
        },
        emergencyContact: registrationData.emergencyContacts,
        travelInfo: registrationData.itinerary,
        safetyStatus: 'Normal',
        isActive: true,
        registrationDate: new Date(),
      };

      // Validate tourist data
      const validationErrors = this.models.validateTourist(tourist);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Check if tourist already exists
      const existingTourist = await this.models.tourists.findOne({
        $or: [
          { digitalId: tourist.digitalId },
          { 'personalInfo.email': tourist.personalInfo.email },
          { 'personalInfo.passportNumber': tourist.personalInfo.passportNumber },
        ],
      });

      if (existingTourist) {
        throw new Error('Tourist already exists with this email or passport number');
      }

      // Save to database
      const result = await this.models.tourists.insertOne(tourist);

      console.log(`[Registration] Tourist registered with digitalId: ${digitalId}`);

      return {
        success: true,
        digitalId: tourist.digitalId,
        dbId: result.insertedId,
        message: 'Tourist registered successfully',
      };
    } catch (error) {
      console.error('[Registration] Failed to register tourist:', error);
      throw new Error(error instanceof Error ? error.message : 'Registration failed');
    }
  }

  async getTouristByDigitalId(digitalId: string): Promise<Tourist | null> {
    try {
      const tourist = await this.models.tourists.findOne({ digitalId });
      return tourist;
    } catch (error) {
      console.error('[Registration] Failed to get tourist:', error);
      throw new Error('Failed to retrieve tourist');
    }
  }

  async getAllTourists(options: {
    includeInactive?: boolean;
    limit?: number;
    skip?: number;
    includeSensitiveData?: boolean;
  } = {}) {
    try {
      const {
        includeInactive = false,
        limit = 1000,
        skip = 0,
        includeSensitiveData = false,
      } = options;

      const filter: any = {};
      if (!includeInactive) {
        filter.isActive = true;
      }

      let projection: any = {};
      if (!includeSensitiveData) {
        projection = {
          'personalInfo.passportNumber': 0,
          'personalInfo.address': 0,
          'emergencyContact': 0,
          'healthProfile.encryptedProfile': 0,
        };
      }

      const tourists = await this.models.tourists
        .find(filter)
        .project(projection)
        .limit(limit)
        .skip(skip)
        .sort({ registrationDate: -1 })
        .toArray();

      return tourists;
    } catch (error) {
      console.error('[Registration] Failed to get all tourists:', error);
      throw new Error('Failed to retrieve tourists');
    }
  }
}

module.exports = { RegistrationService };
