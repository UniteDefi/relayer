import { Router, Request, Response } from "express";
import { AuctionService } from "../services/auction.service";
import { SwapRequest, ResolverCommitment, SettlementNotification } from "../types";
import { ethers } from "ethers";

export function createSwapRoutes(auctionService: AuctionService): Router {
  const router = Router();
  
  // Create a new swap auction
  router.post("/create-swap", async (req: Request, res: Response) => {
    try {
      const { swapRequest, secret }: { swapRequest: SwapRequest; secret: string } = req.body;
      
      // Validate swap request
      if (!swapRequest || !secret) {
        return res.status(400).json({ error: "Missing swap request or secret" });
      }
      
      // Verify signature (simplified for demo)
      // In production, verify the signature matches the swap request
      
      // Create auction
      const auction = await auctionService.createAuction(swapRequest, secret);
      
      res.json({
        success: true,
        auctionId: auction.auctionId,
        expiresAt: auction.expiresAt
      });
      
    } catch (error: any) {
      console.error("[API] Error creating swap:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver commits to fill an auction
  router.post("/commit-resolver", async (req: Request, res: Response) => {
    try {
      const commitment: ResolverCommitment = req.body;
      
      // Validate commitment
      if (!commitment.auctionId || !commitment.resolverAddress || 
          !commitment.srcEscrowAddress || !commitment.dstEscrowAddress) {
        return res.status(400).json({ error: "Invalid commitment data" });
      }
      
      // Process commitment
      await auctionService.commitResolver(commitment);
      
      res.json({
        success: true,
        message: "Resolver commitment accepted"
      });
      
    } catch (error: any) {
      console.error("[API] Error committing resolver:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Move user's pre-approved funds to escrow
  router.post("/move-user-funds", async (req: Request, res: Response) => {
    try {
      const { auctionId, resolverAddress } = req.body;
      
      if (!auctionId || !resolverAddress) {
        return res.status(400).json({ error: "Missing auction ID or resolver address" });
      }
      
      // Get auction and verify resolver
      const auction = auctionService.getAuction(auctionId);
      if (!auction) {
        return res.status(404).json({ error: "Auction not found" });
      }
      
      if (auction.resolver !== resolverAddress) {
        return res.status(403).json({ error: "Unauthorized resolver" });
      }
      
      // Move funds
      const txHash = await auctionService.moveUserFunds(auctionId);
      
      res.json({
        success: true,
        txHash
      });
      
    } catch (error: any) {
      console.error("[API] Error moving user funds:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Resolver notifies completion of trade
  router.post("/notify-completion", async (req: Request, res: Response) => {
    try {
      const notification: SettlementNotification = req.body;
      
      // Validate notification
      if (!notification.auctionId || !notification.resolverAddress || 
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
  
  // Get auction status
  router.get("/auction-status/:auctionId", (req: Request, res: Response) => {
    try {
      const { auctionId } = req.params;
      
      const auction = auctionService.getAuction(auctionId);
      if (!auction) {
        return res.status(404).json({ error: "Auction not found" });
      }
      
      // Don't expose the secret
      const { swapRequest, ...safeAuctionData } = auction;
      
      res.json({
        ...safeAuctionData,
        swapRequest: {
          ...swapRequest,
          signature: undefined // Remove signature from response
        }
      });
      
    } catch (error: any) {
      console.error("[API] Error getting auction status:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get all active auctions (for resolvers to monitor)
  router.get("/active-auctions", (req: Request, res: Response) => {
    try {
      const allAuctions = auctionService.getAllAuctions();
      const activeAuctions = allAuctions.filter(a => 
        a.status === "pending" && a.expiresAt > Date.now()
      );
      
      // Remove sensitive data
      const safeAuctions = activeAuctions.map(auction => ({
        auctionId: auction.auctionId,
        srcChainId: auction.swapRequest.srcChainId,
        srcToken: auction.swapRequest.srcToken,
        srcAmount: auction.swapRequest.srcAmount,
        dstChainId: auction.swapRequest.dstChainId,
        dstToken: auction.swapRequest.dstToken,
        startPrice: auction.swapRequest.startPrice,
        endPrice: auction.swapRequest.endPrice,
        createdAt: auction.createdAt,
        expiresAt: auction.expiresAt,
        currentPrice: calculateCurrentPrice(auction)
      }));
      
      res.json(safeAuctions);
      
    } catch (error: any) {
      console.error("[API] Error getting active auctions:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}

function calculateCurrentPrice(auction: any): string {
  const now = Date.now();
  const elapsed = now - auction.createdAt;
  const duration = auction.expiresAt - auction.createdAt;
  
  if (elapsed >= duration) {
    return auction.swapRequest.endPrice;
  }
  
  const startPrice = BigInt(auction.swapRequest.startPrice);
  const endPrice = BigInt(auction.swapRequest.endPrice);
  const priceDiff = startPrice - endPrice;
  
  const currentPrice = startPrice - (priceDiff * BigInt(elapsed) / BigInt(duration));
  
  return currentPrice.toString();
}