import { ethers } from "ethers";
import { OrderData, SwapRequest, ResolverCommitment, SettlementNotification, EscrowReadyNotification } from "../types";
import { BlockchainService } from "./blockchain.service";
import { config } from "../config";

export class AuctionService {
  private orders: Map<string, OrderData> = new Map();
  private blockchainService: BlockchainService;
  private userSecrets: Map<string, string> = new Map();
  private marketPrices: Map<string, string> = new Map(); // Mock price oracle
  
  constructor(blockchainService: BlockchainService) {
    this.blockchainService = blockchainService;
    
    // Initialize mock market prices
    this.marketPrices.set("USDT-DAI", "1000000"); // 1:1 for stablecoins
    this.marketPrices.set("DAI-USDT", "1000000");
    this.marketPrices.set("USDC-DAI", "1000000");
    this.marketPrices.set("DAI-USDC", "1000000");
    
    // Start background task to check expired orders and rescue opportunities
    setInterval(() => this.checkExpiredOrders(), 10000); // Every 10 seconds
  }
  
  async createOrder(swapRequest: SwapRequest, secret: string): Promise<OrderData> {
    // Generate order ID
    const orderId = ethers.keccak256(
      ethers.toUtf8Bytes(`order_${swapRequest.userAddress}_${Date.now()}`)
    );
    
    // Verify secret hash matches
    const computedHash = ethers.keccak256(secret);
    if (computedHash !== swapRequest.secretHash) {
      throw new Error("Secret hash mismatch");
    }
    
    // Store secret securely (in production, use secure storage)
    this.userSecrets.set(orderId, secret);
    
    // Check user has approved relayer contract
    const approvedAmount = await this.blockchainService.checkAllowance(
      swapRequest.srcChainId,
      swapRequest.srcToken,
      swapRequest.userAddress,
      this.blockchainService.getRelayerContract(swapRequest.srcChainId)
    );
    
    if (BigInt(approvedAmount) < BigInt(swapRequest.srcAmount)) {
      throw new Error("Insufficient allowance. User must approve relayer contract.");
    }
    
    // Get current market price
    const pairKey = `${swapRequest.srcToken}-${swapRequest.dstToken}`;
    const marketPrice = this.marketPrices.get(pairKey) || swapRequest.minAcceptablePrice;
    
    // Create order data
    const orderData: OrderData = {
      orderId,
      swapRequest,
      marketPrice,
      status: "active",
      createdAt: Date.now(),
      expiresAt: Date.now() + (swapRequest.orderDuration * 1000)
    };
    
    console.log(`[Order] Created order ${orderId}`);
    console.log(`[Order] Market price: ${marketPrice}`);
    
    // Store order
    this.orders.set(orderId, orderData);
    
    // Broadcast to resolvers (in production, use WebSocket or pub/sub)
    this.broadcastOrderToResolvers(orderData);
    
    return orderData;
  }
  
  private broadcastOrderToResolvers(order: OrderData) {
    console.log(`[Order] Broadcasting order ${order.orderId} to resolvers`);
    // In production, this would send to all connected resolvers via WebSocket
  }
  
  async commitResolver(commitment: ResolverCommitment): Promise<{ success: boolean }> {
    const order = this.orders.get(commitment.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "active") {
      throw new Error("Order already committed or completed");
    }
    
    // Update order with resolver commitment
    order.status = "committed";
    order.resolver = commitment.resolverAddress;
    order.committedPrice = commitment.acceptedPrice;
    order.commitmentTime = Date.now();
    order.commitmentDeadline = Date.now() + 5 * 60 * 1000; // 5 minutes
    
    console.log(`[Order] Resolver ${commitment.resolverAddress} committed to order ${commitment.orderId}`);
    console.log(`[Order] 5-minute timer started. Deadline: ${new Date(order.commitmentDeadline).toISOString()}`);
    
    return { success: true };
  }
  
  async escrowsReady(notification: EscrowReadyNotification): Promise<void> {
    const order = this.orders.get(notification.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "committed") {
      throw new Error("Order not in committed state");
    }
    
    if (order.resolver !== notification.resolverAddress) {
      throw new Error("Unauthorized resolver");
    }
    
    // Verify escrows are deployed with safety deposits
    const srcEscrowValid = await this.blockchainService.verifyEscrowWithDeposit(
      order.swapRequest.srcChainId,
      notification.srcEscrowAddress,
      notification.srcSafetyDepositTx
    );
    
    const dstEscrowValid = await this.blockchainService.verifyEscrowWithDeposit(
      order.swapRequest.dstChainId,
      notification.dstEscrowAddress,
      notification.dstSafetyDepositTx
    );
    
    if (!srcEscrowValid || !dstEscrowValid) {
      throw new Error("Invalid escrow deployment or safety deposits");
    }
    
    // Update order with escrow addresses
    order.srcEscrowAddress = notification.srcEscrowAddress;
    order.dstEscrowAddress = notification.dstEscrowAddress;
    
    console.log(`[Order] Escrows ready for order ${notification.orderId}`);
    
    // Start user funds transfer
    await this.moveUserFunds(notification.orderId);
  }
  
  async moveUserFunds(orderId: string): Promise<string> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (!order.srcEscrowAddress) {
      throw new Error("Source escrow not set");
    }
    
    // Move user's pre-approved funds to escrow using relayer contract
    const txHash = await this.blockchainService.transferUserFundsViaRelayer(
      order.swapRequest.srcChainId,
      order.swapRequest.userAddress,
      order.swapRequest.srcToken,
      order.swapRequest.srcAmount,
      order.srcEscrowAddress
    );
    
    order.status = "settling";
    order.userFundsMoved = true;
    order.userFundsMovedAt = Date.now();
    if (!order.settlementTx) {
      order.settlementTx = {};
    }
    order.settlementTx.srcChainTxHash = txHash;
    
    console.log(`[Order] Moved user funds to escrow for order ${orderId}`);
    
    return txHash;
  }
  
  async notifySettlement(notification: SettlementNotification): Promise<void> {
    const order = this.orders.get(notification.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "settling") {
      throw new Error("Order not in settling state");
    }
    
    if (order.resolver !== notification.resolverAddress) {
      throw new Error("Unauthorized resolver");
    }
    
    // Verify resolver deposited correct amount
    const verified = await this.blockchainService.verifyResolverDeposit(
      order.swapRequest.dstChainId,
      notification.dstTxHash,
      order.dstEscrowAddress!,
      notification.dstTokenAmount
    );
    
    if (!verified) {
      throw new Error("Invalid resolver deposit");
    }
    
    // Store destination transaction
    if (!order.settlementTx) {
      order.settlementTx = {};
    }
    order.settlementTx.dstChainTxHash = notification.dstTxHash;
    
    console.log(`[Order] Resolver notified settlement for order ${notification.orderId}`);
    
    // Start settlement finalization process
    this.finalizeSettlement(notification.orderId);
  }
  
  private async finalizeSettlement(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || !order.settlementTx) {
      return;
    }
    
    try {
      // Wait for confirmations on both chains
      console.log(`[Order] Waiting for confirmations for order ${orderId}`);
      
      const [srcReceipt, dstReceipt] = await Promise.all([
        this.blockchainService.waitForConfirmations(
          order.swapRequest.srcChainId,
          order.settlementTx.srcChainTxHash!
        ),
        this.blockchainService.waitForConfirmations(
          order.swapRequest.dstChainId,
          order.settlementTx.dstChainTxHash!
        )
      ]);
      
      if (!srcReceipt || !dstReceipt) {
        throw new Error("Failed to get transaction receipts");
      }
      
      // Wait additional delay before revealing secret
      console.log(`[Order] Waiting ${config.order.secretRevealDelay}s before revealing secret`);
      await new Promise(resolve => setTimeout(resolve, config.order.secretRevealDelay * 1000));
      
      // Reveal secret on destination chain
      const secret = this.userSecrets.get(orderId);
      if (!secret) {
        throw new Error("Secret not found");
      }
      
      const revealTxHash = await this.blockchainService.revealSecretOnDestination(
        order.swapRequest.dstChainId,
        order.dstEscrowAddress!,
        secret
      );
      
      console.log(`[Order] Revealed secret on destination chain: ${revealTxHash}`);
      
      // Update order status
      order.status = "completed";
      order.secretRevealedAt = Date.now();
      
      // Clean up secret from memory
      this.userSecrets.delete(orderId);
      
      console.log(`[Order] Completed order ${orderId}`);
      
    } catch (error) {
      console.error(`[Order] Error finalizing settlement for ${orderId}:`, error);
      order.status = "failed";
    }
  }
  
  private checkExpiredOrders(): void {
    const now = Date.now();
    
    for (const [orderId, order] of this.orders) {
      // Check if order expired without commitment
      if (order.status === "active" && order.expiresAt < now) {
        console.log(`[Order] Order ${orderId} expired`);
        order.status = "failed";
      }
      
      // Check if resolver failed to complete in 5-minute window
      if (order.status === "committed" && 
          order.commitmentDeadline && 
          order.commitmentDeadline < now) {
        console.log(`[Order] Resolver failed to complete order ${orderId} in 5-minute window`);
        order.status = "rescue_available";
        // Order is now available for any resolver to rescue
        this.broadcastRescueOpportunity(order);
      }
    }
  }
  
  private broadcastRescueOpportunity(order: OrderData) {
    console.log(`[Order] Broadcasting rescue opportunity for order ${order.orderId}`);
    console.log(`[Order] Original resolver ${order.resolver} forfeits safety deposits`);
    // In production, broadcast to all resolvers that they can claim safety deposits
  }
  
  getOrder(orderId: string): OrderData | undefined {
    return this.orders.get(orderId);
  }
  
  getOrderStatus(orderId: string): any {
    const order = this.orders.get(orderId);
    if (!order) return null;
    
    return {
      orderId: order.orderId,
      status: order.status,
      userFundsMoved: order.userFundsMoved || false,
      resolver: order.resolver,
      srcEscrowAddress: order.srcEscrowAddress,
      dstEscrowAddress: order.dstEscrowAddress,
      committedPrice: order.committedPrice,
      commitmentDeadline: order.commitmentDeadline
    };
  }
  
  getAllActiveOrders(): OrderData[] {
    return Array.from(this.orders.values())
      .filter(order => order.status === "active" || order.status === "rescue_available");
  }
}