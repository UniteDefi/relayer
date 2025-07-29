import { Router, Request, Response } from "express";
import { AuctionService } from "../services/auction.service";
import { SwapRequest, ResolverCommitment, SettlementNotification, EscrowReadyNotification, HTLCOrder } from "../types";
import { ethers } from "ethers";
import { EIP712Utils } from "../utils/eip712.utils";
import { config } from "../config";

export function createSwapRoutes(auctionService: AuctionService): Router {
  const router = Router();
  
  // Step 2: User submits EIP-712 signed order with secret to relayer service
  router.post("/create-swap", async (req: Request, res: Response) => {
    try {
      const { 
        swapRequest, 
        signature, 
        secret 
      }: { 
        swapRequest: SwapRequest; 
        signature: string;
        secret: string;
      } = req.body;
      
      // Validate all required fields
      if (!swapRequest || !signature || !secret) {
        return res.status(400).json({ 
          error: "Missing required fields: swapRequest, signature, or secret" 
        });
      }
      
      // Validate required SwapRequest fields
      if (!swapRequest.userAddress || !swapRequest.srcChainId || !swapRequest.srcToken ||
          !swapRequest.srcAmount || !swapRequest.dstChainId || !swapRequest.dstToken ||
          !swapRequest.secretHash || !swapRequest.minAcceptablePrice || !swapRequest.orderDuration) {
        return res.status(400).json({ 
          error: "Invalid swapRequest: missing required fields" 
        });
      }
      
      // Create order with EIP-712 signature verification
      const order = await auctionService.createOrder(swapRequest, signature, secret);
      
      res.json({
        success: true,
        orderId: order.orderId,
        marketPrice: order.marketPrice,
        expiresAt: order.expiresAt,
        message: "EIP-712 signed order created and broadcasted to resolvers"
      });
      
    } catch (error: any) {
      console.error("[API] Error creating swap:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver commits to fill an order
  router.post("/commit-resolver", async (req: Request, res: Response) => {
    try {
      const commitment: ResolverCommitment = req.body;
      
      // Validate commitment
      if (!commitment.orderId || !commitment.resolverAddress || 
          !commitment.acceptedPrice) {
        return res.status(400).json({ error: "Invalid commitment data" });
      }
      
      // Process commitment
      const result = await auctionService.commitResolver(commitment);
      
      res.json(result);
      
    } catch (error: any) {
      console.error("[API] Error committing resolver:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver notifies escrows are ready
  router.post("/escrows-ready", async (req: Request, res: Response) => {
    try {
      const notification: EscrowReadyNotification = req.body;
      
      // Validate notification
      if (!notification.orderId || !notification.resolverAddress || 
          !notification.srcEscrowAddress || !notification.dstEscrowAddress ||
          !notification.srcSafetyDepositTx || !notification.dstSafetyDepositTx) {
        return res.status(400).json({ error: "Invalid escrow notification data" });
      }
      
      // Process notification
      await auctionService.escrowsReady(notification);
      
      res.json({
        success: true,
        message: "Escrows ready, moving user funds"
      });
      
    } catch (error: any) {
      console.error("[API] Error processing escrow notification:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get order status
  router.get("/order-status/:orderId", async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      
      const status = await auctionService.getOrderStatus(orderId);
      if (!status) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      res.json(status);
      
    } catch (error: any) {
      console.error("[API] Error getting order status:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get current auction price for an order
  router.get("/auction-price/:orderId", async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      
      const priceInfo = await auctionService.getCurrentAuctionPrice(orderId);
      if (!priceInfo) {
        return res.status(404).json({ error: "Order not found or not active" });
      }
      
      res.json(priceInfo);
      
    } catch (error: any) {
      console.error("[API] Error getting auction price:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver notifies completion of trade
  router.post("/notify-completion", async (req: Request, res: Response) => {
    try {
      const notification: SettlementNotification = req.body;
      
      // Validate notification
      if (!notification.orderId || !notification.resolverAddress || 
          !notification.dstTxHash || !notification.dstTokenAmount) {
        return res.status(400).json({ error: "Invalid notification data" });
      }
      
      // Process notification
      await auctionService.notifySettlement(notification);
      
      res.json({
        success: true,
        message: "Settlement notification received"
      });
      
    } catch (error: any) {
      console.error("[API] Error processing settlement notification:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Legacy auction status endpoint (redirect to order status)
  router.get("/auction-status/:auctionId", (req: Request, res: Response) => {
    res.redirect(`/api/order-status/${req.params.auctionId}`);
  });
  
  // Get all active orders (for resolvers to monitor)
  router.get("/active-orders", async (req: Request, res: Response) => {
    try {
      const activeOrders = await auctionService.getAllActiveOrders();
      
      // Remove sensitive data and add current auction prices
      const safeOrders = await Promise.all(activeOrders.map(async order => {
        const baseOrder = {
          orderId: order.orderId,
          srcChainId: order.swapRequest.srcChainId,
          srcToken: order.swapRequest.srcToken,
          srcAmount: order.swapRequest.srcAmount,
          dstChainId: order.swapRequest.dstChainId,
          dstToken: order.swapRequest.dstToken,
          marketPrice: order.marketPrice,
          userAddress: order.swapRequest.userAddress,
          secretHash: order.swapRequest.secretHash,
          createdAt: order.createdAt,
          expiresAt: order.expiresAt,
          status: order.status,
          auctionStartPrice: order.auctionStartPrice,
          auctionEndPrice: order.auctionEndPrice,
          auctionDuration: order.auctionDuration
        };
        
        // Add current auction price for active orders
        if (order.status === "active") {
          const priceInfo = await auctionService.getCurrentAuctionPrice(order.orderId);
          if (priceInfo) {
            return {
              ...baseOrder,
              currentPrice: priceInfo.currentPrice,
              currentDstAmount: priceInfo.makerAmount,
              priceImprovement: priceInfo.priceImprovement,
              timeRemaining: priceInfo.timeRemaining
            };
          }
        }
        
        return baseOrder;
      }));
      
      res.json(safeOrders);
      
    } catch (error: any) {
      console.error("[API] Error getting active orders:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver commits to rescue a failed order
  router.post("/rescue-order", async (req: Request, res: Response) => {
    try {
      const { orderId, resolverAddress }: { orderId: string; resolverAddress: string } = req.body;
      
      if (!orderId || !resolverAddress) {
        return res.status(400).json({ error: "Missing orderId or resolverAddress" });
      }
      
      const order = await auctionService.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      if (order.status !== "rescue_available") {
        return res.status(400).json({ error: "Order is not available for rescue" });
      }
      
      // Allow rescue commitment - similar to normal commitment but with rescue rewards
      const rescueCommitment: ResolverCommitment = {
        orderId,
        resolverAddress,
        acceptedPrice: order.committedPrice || order.marketPrice,
        timestamp: Date.now()
      };
      
      const result = await auctionService.commitResolver(rescueCommitment);
      
      res.json({
        ...result,
        message: "Rescue commitment accepted. You can claim original resolver's safety deposits.",
        originalResolver: order.resolver,
        rewardInfo: "Complete the trade to claim safety deposits as penalty reward"
      });
      
    } catch (error: any) {
      console.error("[API] Error processing rescue commitment:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Legacy endpoint redirect
  router.get("/active-auctions", (req: Request, res: Response) => {
    res.redirect("/api/active-orders");
  });
  
  // Helper endpoint to get EIP-712 typed data for signing
  router.post("/get-typed-data", (req: Request, res: Response) => {
    try {
      const { swapRequest }: { swapRequest: SwapRequest } = req.body;
      
      if (!swapRequest) {
        return res.status(400).json({ error: "Missing swapRequest" });
      }
      
      // Create HTLCOrder from SwapRequest
      const htlcOrder = EIP712Utils.createHTLCOrder(
        swapRequest.userAddress,
        swapRequest.srcChainId,
        swapRequest.srcToken,
        swapRequest.srcAmount,
        swapRequest.dstChainId,
        swapRequest.dstToken,
        swapRequest.secretHash,
        swapRequest.minAcceptablePrice,
        swapRequest.orderDuration
      );
      
      // Get verifying contract for the source chain
      const verifyingContract = config.chains[swapRequest.srcChainId]?.escrowFactory || ethers.ZeroAddress;
      
      // Create EIP-712 domain
      const domain = EIP712Utils.getDomain(swapRequest.srcChainId, verifyingContract);
      
      // Create typed data structure
      const typedData = EIP712Utils.createTypedData(htlcOrder, domain);
      
      res.json({
        typedData,
        orderId: EIP712Utils.getOrderHash(htlcOrder, domain),
        message: "Use this typed data with ethers.signTypedData or wallet's signTypedData method"
      });
      
    } catch (error: any) {
      console.error("[API] Error creating typed data:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get revealed secret for completed orders (for resolvers to claim on source chain)
  router.get("/order-secret/:orderId", async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      const { resolverAddress } = req.query;
      
      if (!resolverAddress) {
        return res.status(400).json({ error: "Resolver address required" });
      }
      
      const order = await auctionService.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Only reveal secret to the committed resolver after relayer has revealed it
      if (order.resolver?.toLowerCase() !== (resolverAddress as string).toLowerCase()) {
        return res.status(403).json({ error: "Unauthorized - not the committed resolver" });
      }
      
      if (order.status !== "completed") {
        return res.status(400).json({ 
          error: "Secret not yet revealed", 
          status: order.status,
          hint: "Wait for relayer to reveal secret on destination chain" 
        });
      }
      
      // Get the revealed secret transaction details
      const secretInfo = await auctionService.getRevealedSecretInfo(orderId);
      if (!secretInfo) {
        return res.status(404).json({ error: "Secret reveal info not found" });
      }
      
      res.json({
        orderId,
        status: "revealed",
        dstChainId: order.swapRequest.dstChainId,
        dstEscrowAddress: order.dstEscrowAddress,
        revealTxHash: secretInfo.revealTxHash,
        revealedAt: order.secretRevealedAt,
        srcChainId: order.swapRequest.srcChainId,
        srcEscrowAddress: order.srcEscrowAddress,
        hint: "Use the revealTxHash to retrieve the secret from blockchain logs"
      });
      
    } catch (error: any) {
      console.error("[API] Error getting order secret:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Monitor order for secret reveal events
  router.get("/monitor-secret/:orderId", async (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      
      const order = await auctionService.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      res.json({
        orderId,
        status: order.status,
        secretRevealed: order.status === "completed",
        secretRevealedAt: order.secretRevealedAt,
        dstEscrowAddress: order.dstEscrowAddress,
        srcEscrowAddress: order.srcEscrowAddress,
        resolver: order.resolver,
        commitmentDeadline: order.commitmentDeadline,
        timeRemaining: order.commitmentDeadline ? order.commitmentDeadline - Date.now() : null
      });
      
    } catch (error: any) {
      console.error("[API] Error monitoring secret:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get database statistics
  router.get("/stats", async (req: Request, res: Response) => {
    try {
      const stats = await auctionService.getOrderStats();
      res.json(stats);
    } catch (error: any) {
      console.error("[API] Error getting stats:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get resolver statistics
  router.get("/resolver-stats/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const stats = await auctionService.getResolverStats(address);
      res.json(stats);
    } catch (error: any) {
      console.error("[API] Error getting resolver stats:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}