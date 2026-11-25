import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import cookieParser from "cookie-parser";
import dashboardRoutes from "./routes/DashboardRoutes";
import authRoutes from "./routes/AuthRoutes";
import notificationRoutes from "./routes/NotificationRoutes";
import geoFenceRoutes from "./routes/GeoFenceRoutes";
import healthRoutes from "./routes/HealthRoutes";
import { createIndexes } from "./config/database";
import RealtimeLocationService from "./services/realtimeLocationService";
import blockchainService from "./services/blockchainService";
import { seedDatabase } from "./scripts/seedData";
import healthMonitoringService from "./services/healthMonitoringService";
import demoMode from "./demo/demoMode";

// Import CommonJS modules
const touristRoutes = require("./routes/TouristRoutes");
const { getDb } = require("./config/mongodb");

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

// Initialize real-time location service
let realtimeLocationService: RealtimeLocationService;

// Middleware
app.use(cors({
  origin: (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000').split(','), // Allow requests from frontend
  credentials: true // Allow cookies
}));
app.use(express.json({ limit: "2mb" })); // JSON bodies (telemetry burst-sync batches can be large)
app.use(cookieParser()); // Parse cookies

// Health check endpoint
interface HealthCheckResponse {
  status: string;
  message: string;
}


app.get("/health", (req: Request, res: Response) => {
  const response: HealthCheckResponse = { status: "OK", message: "Smart Tourist Server is running" };
  res.json(response);
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/tourists", touristRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/geofences", geoFenceRoutes);
app.use("/api/health", healthRoutes);

// Initialize database connection and start server
const startServer = async () => {
  try {
    // Test database connection
    const db = await getDb();
    console.log("✅ Connected to MongoDB successfully");

    // Create database indexes
    console.log("🔄 Creating database indexes...");
    await createIndexes();

    // Seed sample data
    console.log("🌱 Seeding sample data...");
    await seedDatabase();

    // Initialize real-time location service
    realtimeLocationService = new RealtimeLocationService(server);
    healthMonitoringService.attachRealtime(realtimeLocationService);
    app.locals.realtime = realtimeLocationService;

    // Check blockchain availability
    const isBlockchainAvailable = await blockchainService.isBlockchainAvailable();
    console.log(`🔗 Blockchain status: ${isBlockchainAvailable ? 'Connected' : 'Fallback mode'}`);

    if (process.env.DEMO_MODE === 'true') await demoMode.start(realtimeLocationService);

    server.listen(PORT, () => {
      console.log(`🚀 Smart Tourist Server is running on http://localhost:${PORT}`);
      console.log(`📋 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api/tourists`);
      console.log(`🌐 WebSocket server running on port ${PORT}`);
      console.log(`🩺 Health API: http://localhost:${PORT}/api/health`);
      if (demoMode.enabled) console.log(`🔑 Demo login: gov_admin / GovAdmin@123`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
