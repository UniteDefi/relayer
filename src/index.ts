import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { config } from "./config";
import { BlockchainService } from "./services/blockchain.service";
import { AuctionService } from "./services/auction.service";
import { SQSService } from "./services/sqs.service";
import { DatabaseService } from "./services/database.service";
import { createSwapRoutes } from "./routes/swap.routes";

dotenv.config();

// Global reference for shutdown
let globalDatabaseService: DatabaseService | null = null;

// Start the server
async function main() {
  try {
    const app = express();
    
    // Middleware
    app.use(cors({
      origin: config.api.corsOrigins
    }));
    app.use(bodyParser.json({ limit: config.api.maxRequestSize }));
    app.use(bodyParser.urlencoded({ extended: true, limit: config.api.maxRequestSize }));
    
    // Initialize services
    const blockchainService = new BlockchainService();
    const sqsService = new SQSService();
    const databaseService = new DatabaseService();
    
    // Store global reference for shutdown
    globalDatabaseService = databaseService;
    
    // Initialize database
    await databaseService.initialize();
    
    // Initialize SQS queue
    await sqsService.initialize();
    
    const auctionService = new AuctionService(blockchainService, sqsService, databaseService);
    
    // Routes
    app.use("/api", createSwapRoutes(auctionService));
    
    // Health check
    app.get("/health", (req, res) => {
      res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        chains: Object.keys(config.chains).map(id => ({
          chainId: id,
          name: config.chains[Number(id)].name
        }))
      });
    });
    
    // Start server
    const port = config.port;
    app.listen(port, () => {
      console.log(`🚀 Relayer Service started on port ${port}`);
      console.log(`📡 API endpoints:`);
      console.log(`   POST /api/create-swap - Create new swap order`);
      console.log(`   POST /api/commit-resolver - Resolver commits to fill`);
      console.log(`   POST /api/escrows-ready - Notify escrows are deployed`);
      console.log(`   POST /api/notify-completion - Notify trade completion`);
      console.log(`   GET  /api/order-status/:id - Get order status`);
      console.log(`   GET  /api/active-orders - List active orders`);
      console.log(`   GET  /health - Health check`);
      console.log(`\n🔗 Connected chains:`);
      Object.values(config.chains).forEach(chain => {
        console.log(`   - ${chain.name} (${chain.chainId})`);
      });
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the application
main();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  if (globalDatabaseService) {
    await globalDatabaseService.close();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  if (globalDatabaseService) {
    await globalDatabaseService.close();
  }
  process.exit(0);
});