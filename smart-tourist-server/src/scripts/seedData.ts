import { getCollections } from '../config/database';
import { GeoFence } from '../models/LocationHistory';
import { seedHealthData } from './seedHealthData';

// Sample geo-fences for testing
const sampleGeoFences: Omit<GeoFence, '_id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: "Amer Fort Safe Zone",
    description: "Safe tourist area around Amer Fort",
    type: "safe_zone",
    geometry: {
      type: "Circle",
      coordinates: [75.8513, 26.9855], // [longitude, latitude] - single point for circle center
      radius: 500 // 500 meters
    },
    isActive: true,
    createdBy: "system",
    alertSettings: {
      onEntry: false,
      onExit: true,
      alertLevel: "info",
      notifyAuthorities: false,
      customMessage: "You are leaving the safe zone around Amer Fort"
    }
  },
  {
    name: "City Palace Restricted Area",
    description: "Restricted area within City Palace complex",
    type: "restricted_zone",
    geometry: {
      type: "Polygon",
      coordinates: [
        [75.8236, 26.9260], // [longitude, latitude]
        [75.8246, 26.9260],
        [75.8246, 26.9270],
        [75.8236, 26.9270],
        [75.8236, 26.9260] // Close the polygon
      ]
    },
    isActive: true,
    createdBy: "system",
    alertSettings: {
      onEntry: true,
      onExit: false,
      alertLevel: "warning",
      notifyAuthorities: true,
      customMessage: "You have entered a restricted area. Please exit immediately."
    }
  },
  {
    name: "Hawa Mahal Alert Zone",
    description: "High traffic alert zone around Hawa Mahal",
    type: "alert_zone",
    geometry: {
      type: "Circle",
      coordinates: [75.8267, 26.9239], // [longitude, latitude]
      radius: 300
    },
    isActive: true,
    createdBy: "system",
    alertSettings: {
      onEntry: true,
      onExit: false,
      alertLevel: "info",
      notifyAuthorities: false,
      customMessage: "You are entering a high-traffic area. Stay alert and follow safety guidelines."
    }
  },
  {
    name: "Nahargarh Fort Emergency Zone",
    description: "Emergency response zone for Nahargarh Fort area",
    type: "emergency_zone",
    geometry: {
      type: "Circle",
      coordinates: [75.8154, 26.9368], // [longitude, latitude]
      radius: 1000
    },
    isActive: true,
    createdBy: "system",
    alertSettings: {
      onEntry: true,
      onExit: true,
      alertLevel: "warning",
      notifyAuthorities: true,
      customMessage: "You are in an emergency response zone. Emergency services are readily available."
    }
  },
  {
    name: "Jal Mahal Restricted Water Area",
    description: "Water body restriction around Jal Mahal",
    type: "restricted_zone",
    geometry: {
      type: "Polygon",
      coordinates: [
        [75.8458, 26.9530],
        [75.8468, 26.9530],
        [75.8468, 26.9540],
        [75.8458, 26.9540],
        [75.8458, 26.9530]
      ]
    },
    isActive: true,
    createdBy: "system",
    alertSettings: {
      onEntry: true,
      onExit: false,
      alertLevel: "danger",
      notifyAuthorities: true,
      customMessage: "DANGER: You are approaching a restricted water area. Swimming is prohibited."
    }
  }
];

export async function seedGeoFences(): Promise<void> {
  try {
    const collections = await getCollections();
    
    // Check if geo-fences already exist
    const existingCount = await collections.geoFences.countDocuments();
    if (existingCount > 0) {
      console.log(`[Seed] ${existingCount} geo-fences already exist. Skipping seed.`);
      return;
    }

    // Add timestamps to geo-fences
    const geoFencesWithTimestamps = sampleGeoFences.map(geoFence => ({
      ...geoFence,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    // Insert geo-fences
    const result = await collections.geoFences.insertMany(geoFencesWithTimestamps);
    console.log(`[Seed] Successfully created ${result.insertedCount} geo-fences`);

    // Log the created geo-fences
    geoFencesWithTimestamps.forEach((geoFence, index) => {
      console.log(`  - ${geoFence.name} (${geoFence.type})`);
    });

  } catch (error) {
    console.error('[Seed] Failed to seed geo-fences:', error);
    throw error;
  }
}

// Sample tourist data for testing
export async function seedSampleTourist(): Promise<string> {
  try {
    const collections = await getCollections();
    
    const sampleTourist = {
      digitalId: "TID-sample123456",
      personalInfo: {
        fullName: "John Doe",
        email: "john.doe@example.com",
        phone: "+1234567890",
        dateOfBirth: "1990-01-01",
        nationality: "USA",
        passportNumber: "US123456789",
        address: {
          street: "123 Main St",
          city: "New York",
          state: "NY",
          country: "USA",
          zipCode: "10001"
        }
      },
      emergencyContact: {
        name: "Jane Doe",
        relationship: "Spouse",
        phone: "+1234567891",
        email: "jane.doe@example.com"
      },
      travelInfo: {
        destination: "Jaipur, Rajasthan",
        arrivalDate: "2024-01-01",
        departureDate: "2024-01-07",
        accommodation: "Hotel Raj Palace",
        localGuide: "Rajesh Kumar"
      },
      safetyStatus: "Normal" as const,
      isActive: true,
      registrationDate: new Date(),
      currentLocation: {
        latitude: 26.9124,
        longitude: 75.7873,
        timestamp: new Date(),
        address: "Jaipur, Rajasthan, India"
      }
    };

    // Check if sample tourist already exists
    const existing = await collections.tourists.findOne({ digitalId: sampleTourist.digitalId });
    if (existing) {
      console.log(`[Seed] Sample tourist already exists: ${sampleTourist.digitalId}`);
      return sampleTourist.digitalId;
    }

    await collections.tourists.insertOne(sampleTourist);
    console.log(`[Seed] Created sample tourist: ${sampleTourist.digitalId}`);
    
    return sampleTourist.digitalId;
  } catch (error) {
    console.error('[Seed] Failed to seed sample tourist:', error);
    throw error;
  }
}

// Main seed function
export async function seedDatabase(): Promise<void> {
  console.log('[Seed] Starting database seeding...');
  
  try {
    await seedGeoFences();
    await seedSampleTourist();
    await seedHealthData();
    console.log('[Seed] Database seeding completed successfully!');
  } catch (error) {
    console.error('[Seed] Database seeding failed:', error);
    throw error;
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seeding failed:', error);
      process.exit(1);
    });
}
