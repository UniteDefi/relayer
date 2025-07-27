import { ethers } from "ethers";
import { AuctionData, SwapRequest, ResolverCommitment, SettlementNotification } from "../types";
import { BlockchainService } from "./blockchain.service";
import { config } from "../config";

export class AuctionService {
  private auctions: Map<string, AuctionData> = new Map();
  private blockchainService: BlockchainService;
  private userSecrets: Map<string, string> = new Map();
  
  constructor(blockchainService: BlockchainService) {
    this.blockchainService = blockchainService;
    
    // Start background task to check expired auctions
    setInterval(() => this.checkExpiredAuctions(), 10000); // Every 10 seconds
  }
  
  async createAuction(swapRequest: SwapRequest, secret: string): Promise<AuctionData> {
    // Generate auction ID
    const auctionId = ethers.keccak256(
      ethers.toUtf8Bytes(`auction_${swapRequest.userAddress}_${Date.now()}`)
    );
    
    // Verify secret hash matches
    const computedHash = ethers.keccak256(secret);
    if (computedHash !== swapRequest.secretHash) {
      throw new Error("Secret hash mismatch");
    }
    
    // Store secret securely (in production, use secure storage)
    this.userSecrets.set(auctionId, secret);
    
    // Create auction data
    const auctionData: AuctionData = {
      auctionId,
      swapRequest,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + (swapRequest.auctionDuration * 1000)
    };
    
    // Post auction on source chain
    const txHash = await this.blockchainService.postAuctionOnChain(
      swapRequest.srcChainId,
      {
        auctionId,
        srcToken: swapRequest.srcToken,
        srcAmount: swapRequest.srcAmount,
        dstChainId: swapRequest.dstChainId,
        dstToken: swapRequest.dstToken,
        startPrice: swapRequest.startPrice,
        endPrice: swapRequest.endPrice,
        duration: swapRequest.auctionDuration,
        secretHash: swapRequest.secretHash
      }
    );
    
    console.log(`[Auction] Created auction ${auctionId} with tx ${txHash}`);
    
    // Store auction
    this.auctions.set(auctionId, auctionData);
    
    return auctionData;
  }
  
  async commitResolver(commitment: ResolverCommitment): Promise<void> {
    const auction = this.auctions.get(commitment.auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    
    if (auction.status !== "pending") {
      throw new Error("Auction already committed or completed");
    }
    
    // Verify escrows are deployed
    const srcEscrowExists = await this.blockchainService.checkEscrowDeployment(
      auction.swapRequest.srcChainId,
      commitment.srcEscrowAddress
    );
    
    const dstEscrowExists = await this.blockchainService.checkEscrowDeployment(
      auction.swapRequest.dstChainId,
      commitment.dstEscrowAddress
    );
    
    if (!srcEscrowExists || !dstEscrowExists) {
      throw new Error("Escrow contracts not deployed");
    }
    
    // Update auction with resolver commitment
    auction.status = "committed";
    auction.resolver = commitment.resolverAddress;
    auction.srcEscrowAddress = commitment.srcEscrowAddress;
    auction.dstEscrowAddress = commitment.dstEscrowAddress;
    
    console.log(`[Auction] Resolver ${commitment.resolverAddress} committed to auction ${commitment.auctionId}`);
  }
  
  async moveUserFunds(auctionId: string): Promise<string> {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    
    if (auction.status !== "committed") {
      throw new Error("Auction not in committed state");
    }
    
    if (!auction.srcEscrowAddress) {
      throw new Error("Source escrow not set");
    }
    
    // Move user's pre-approved funds to escrow
    const txHash = await this.blockchainService.moveUserFundsToEscrow(
      auction.swapRequest.srcChainId,
      auction.swapRequest.userAddress,
      auction.swapRequest.srcToken,
      auction.swapRequest.srcAmount,
      auction.srcEscrowAddress
    );
    
    auction.status = "settling";
    if (!auction.settlementTx) {
      auction.settlementTx = {};
    }
    auction.settlementTx.srcChainTxHash = txHash;
    
    console.log(`[Auction] Moved user funds to escrow for auction ${auctionId}`);
    
    return txHash;
  }
  
  async notifySettlement(notification: SettlementNotification): Promise<void> {
    const auction = this.auctions.get(notification.auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    
    if (auction.status !== "settling") {
      throw new Error("Auction not in settling state");
    }
    
    if (auction.resolver !== notification.resolverAddress) {
      throw new Error("Unauthorized resolver");
    }
    
    // Store destination transaction
    if (!auction.settlementTx) {
      auction.settlementTx = {};
    }
    auction.settlementTx.dstChainTxHash = notification.dstTxHash;
    
    console.log(`[Auction] Resolver notified settlement for auction ${notification.auctionId}`);
    
    // Start settlement finalization process
    this.finalizeSettlement(notification.auctionId);
  }
  
  private async finalizeSettlement(auctionId: string): Promise<void> {
    const auction = this.auctions.get(auctionId);
    if (!auction || !auction.settlementTx) {
      return;
    }
    
    try {
      // Wait for confirmations on both chains
      console.log(`[Auction] Waiting for confirmations for auction ${auctionId}`);
      
      const [srcReceipt, dstReceipt] = await Promise.all([
        this.blockchainService.waitForConfirmations(
          auction.swapRequest.srcChainId,
          auction.settlementTx.srcChainTxHash!
        ),
        this.blockchainService.waitForConfirmations(
          auction.swapRequest.dstChainId,
          auction.settlementTx.dstChainTxHash!
        )
      ]);
      
      if (!srcReceipt || !dstReceipt) {
        throw new Error("Failed to get transaction receipts");
      }
      
      // Wait additional delay before revealing secret
      console.log(`[Auction] Waiting ${config.auction.secretRevealDelay}s before revealing secret`);
      await new Promise(resolve => setTimeout(resolve, config.auction.secretRevealDelay * 1000));
      
      // Reveal secret on destination chain
      const secret = this.userSecrets.get(auctionId);
      if (!secret) {
        throw new Error("Secret not found");
      }
      
      const revealTxHash = await this.blockchainService.revealSecretOnChain(
        auction.swapRequest.dstChainId,
        auction.dstEscrowAddress!,
        secret,
        auctionId
      );
      
      console.log(`[Auction] Revealed secret on destination chain: ${revealTxHash}`);
      
      // Update auction status
      auction.status = "completed";
      auction.secretRevealedAt = Date.now();
      
      // Clean up secret from memory
      this.userSecrets.delete(auctionId);
      
      console.log(`[Auction] Completed auction ${auctionId}`);
      
    } catch (error) {
      console.error(`[Auction] Error finalizing settlement for ${auctionId}:`, error);
      auction.status = "failed";
    }
  }
  
  private checkExpiredAuctions(): void {
    const now = Date.now();
    
    for (const [auctionId, auction] of this.auctions) {
      if (auction.status === "pending" && auction.expiresAt < now) {
        console.log(`[Auction] Auction ${auctionId} expired`);
        auction.status = "failed";
      }
      
      // Check if resolver failed to complete in time
      if (auction.status === "committed" && 
          auction.createdAt + (config.auction.resolverTimeLimit * 1000) < now) {
        console.log(`[Auction] Resolver failed to complete auction ${auctionId} in time`);
        auction.status = "failed";
        // In production, this would trigger safety deposit slashing
      }
    }
  }
  
  getAuction(auctionId: string): AuctionData | undefined {
    return this.auctions.get(auctionId);
  }
  
  getAllAuctions(): AuctionData[] {
    return Array.from(this.auctions.values());
  }
}