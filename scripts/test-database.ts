import { DatabaseService } from "../src/services/database.service";
import { OrderData, SwapRequest } from "../src/types";

async function testDatabase() {
  console.log(">ê Testing Database Service...\n");
  
  const db = new DatabaseService("./test-relayer.db");
  
  try {
    // Initialize database
    await db.initialize();
    console.log(" Database initialized successfully");
    
    // Create test order
    const testSwapRequest: SwapRequest = {
      userAddress: "0x1234567890123456789012345678901234567890",
      signature: "0xtest",
      srcChainId: 1,
      srcToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      srcAmount: "1000000000", // 1000 USDC
      dstChainId: 137,
      dstToken: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT on Polygon
      secretHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
      minAcceptablePrice: "950000",
      orderDuration: 300
    };
    
    const testOrder: OrderData = {
      orderId: "0xtest-order-id-123",
      swapRequest: testSwapRequest,
      marketPrice: "1000000",
      status: "active",
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      auctionStartPrice: "1050000",
      auctionEndPrice: "950000",
      auctionDuration: 300
    };
    
    // Save order
    await db.saveOrder(testOrder);
    console.log(" Order saved successfully");
    
    // Save secret
    await db.saveSecret(testOrder.orderId, testSwapRequest.secretHash, "my-secret-123");
    console.log(" Secret saved successfully");
    
    // Retrieve order
    const retrievedOrder = await db.getOrder(testOrder.orderId);
    console.log(" Order retrieved:", retrievedOrder?.orderId);
    
    // Get secret
    const secret = await db.getSecret(testOrder.orderId);
    console.log(" Secret retrieved:", secret);
    
    // Update order status
    testOrder.status = "committed";
    testOrder.resolver = "0x9999888877776666555544443333222211110000";
    testOrder.committedPrice = "980000";
    await db.saveOrder(testOrder);
    console.log(" Order updated successfully");
    
    // Get all active orders
    const activeOrders = await db.getAllActiveOrders();
    console.log(` Active orders count: ${activeOrders.length}`);
    
    // Get order history
    const history = await db.getOrderHistory(testOrder.orderId);
    console.log(` Order history entries: ${history.length}`);
    
    // Get statistics
    const stats = await db.getOrderStats();
    console.log(" Database statistics:", stats);
    
    // Clean up
    await db.close();
    console.log("\n All tests passed!");
    
  } catch (error) {
    console.error("L Test failed:", error);
    await db.close();
    process.exit(1);
  }
}

// Run the test
testDatabase().catch(console.error);