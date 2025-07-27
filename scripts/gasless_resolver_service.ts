import { GaslessResolver } from "./resolvers/gasless_resolver";
import { getChainConfigs } from "./common/config.js";
import dotenv from "dotenv";

dotenv.config();

const RELAYER_URL = process.env.RELAYER_URL || "http://localhost:3001";

async function startResolverServices() {
  console.log("🚀 Starting Gasless Resolver Services");
  console.log(`📡 Relayer URL: ${RELAYER_URL}`);
  console.log("=".repeat(50));
  
  const chains = getChainConfigs();
  
  // Create resolvers with different strategies
  const resolvers = [
    new GaslessResolver(
      "Fast Resolver",
      process.env.RESOLVER1_WALLET_PRIVATE_KEY!,
      RELAYER_URL,
      chains,
      0.5,  // Min profit $0.50
      3000  // Check every 3 seconds
    ),
    new GaslessResolver(
      "Balanced Resolver",
      process.env.RESOLVER2_WALLET_PRIVATE_KEY!,
      RELAYER_URL,
      chains,
      1.0,  // Min profit $1.00
      5000  // Check every 5 seconds
    ),
    new GaslessResolver(
      "Patient Resolver",
      process.env.RESOLVER3_WALLET_PRIVATE_KEY!,
      RELAYER_URL,
      chains,
      2.0,  // Min profit $2.00
      8000  // Check every 8 seconds
    )
  ];
  
  // Start all resolvers
  console.log("\n🤖 Starting resolver services:");
  for (const resolver of resolvers) {
    await resolver.start();
  }
  
  console.log("\n✅ All resolver services started!");
  console.log("📊 Monitoring for profitable cross-chain swaps...\n");
  
  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\n🛑 Shutting down resolver services...");
    for (const resolver of resolvers) {
      resolver.stop();
    }
    process.exit(0);
  });
}

// Start the services
startResolverServices().catch(error => {
  console.error("Failed to start resolver services:", error);
  process.exit(1);
});