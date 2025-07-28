import { Router, Request, Response } from "express";
import { AuctionService } from "../services/auction.service";
import { SwapRequest, ResolverCommitment, SettlementNotification, EscrowReadyNotification } from "../types";
import { ethers } from "ethers";

export function createSwapRoutes(auctionService: AuctionService): Router {
  const router = Router();
  
  // Step 2: User submits swap order, signature, secret to relayer service
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
      
      // Verify signature matches the swap request
      // TODO: Implement proper signature verification
      
      // Create order with secret stored securely
      const order = await auctionService.createOrder(swapRequest, signature, secret);
      
      res.json({
        success: true,
        orderId: order.orderId,
        marketPrice: order.marketPrice,
        expiresAt: order.expiresAt,
        message: "Order created and broadcasted to resolvers with secret hash only"
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
  router.get("/order-status/:orderId", (req: Request, res: Response) => {
    try {
      const { orderId } = req.params;
      
      const status = auctionService.getOrderStatus(orderId);
      if (!status) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      res.json(status);
      
    } catch (error: any) {
      console.error("[API] Error getting order status:", error);
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
  router.get("/active-orders", (req: Request, res: Response) => {
    try {
      const activeOrders = auctionService.getAllActiveOrders();
      
      // Remove sensitive data
      const safeOrders = activeOrders.map(order => ({
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
        status: order.status
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
      
      const order = auctionService.getOrder(orderId);
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
  
  return router;
}