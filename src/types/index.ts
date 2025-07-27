export interface SwapRequest {
  // User details
  userAddress: string;
  signature: string;
  
  // Source chain details
  srcChainId: number;
  srcToken: string;
  srcAmount: string;
  
  // Destination chain details
  dstChainId: number;
  dstToken: string;
  
  // HTLC details
  secretHash: string;
  
  // Dutch auction parameters
  startPrice: string;  // Starting price in dst tokens
  endPrice: string;    // Ending price in dst tokens
  auctionDuration: number; // Duration in seconds
}

export interface AuctionData {
  auctionId: string;
  swapRequest: SwapRequest;
  status: "pending" | "committed" | "settling" | "completed" | "failed";
  resolver?: string;
  createdAt: number;
  expiresAt: number;
  
  // Escrow details (after resolver commits)
  srcEscrowAddress?: string;
  dstEscrowAddress?: string;
  
  // Settlement details
  settlementTx?: {
    srcChainTxHash?: string;
    dstChainTxHash?: string;
  };
  
  // Secret management
  secret?: string;
  secretRevealedAt?: number;
}

export interface ResolverCommitment {
  auctionId: string;
  resolverAddress: string;
  srcEscrowAddress: string;
  dstEscrowAddress: string;
  srcSafetyDepositTx: string;
  dstSafetyDepositTx: string;
  committedPrice: string;
  timestamp: number;
}

export interface SettlementNotification {
  auctionId: string;
  resolverAddress: string;
  dstTokenAmount: string;
  dstTxHash: string;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  escrowFactory: string;
  confirmations: number;
}