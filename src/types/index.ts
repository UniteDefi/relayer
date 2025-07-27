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
  
  // Order parameters
  minAcceptablePrice: string;  // Minimum acceptable price in dst tokens
  orderDuration: number; // Order duration in seconds
}

export interface OrderData {
  orderId: string;
  swapRequest: SwapRequest;
  marketPrice: string;  // Current market price when order was created
  status: "active" | "committed" | "settling" | "completed" | "failed" | "rescue_available";
  resolver?: string;
  createdAt: number;
  expiresAt: number;
  
  // Commitment details
  committedPrice?: string;
  commitmentTime?: number;
  commitmentDeadline?: number; // 5 minutes after commitment
  
  // Escrow details (after resolver deploys)
  srcEscrowAddress?: string;
  dstEscrowAddress?: string;
  
  // Settlement tracking
  userFundsMoved?: boolean;
  userFundsMovedAt?: number;
  settlementTx?: {
    srcChainTxHash?: string;
    dstChainTxHash?: string;
  };
  
  // Secret management
  secretRevealedAt?: number;
}

export interface ResolverCommitment {
  orderId: string;
  resolverAddress: string;
  acceptedPrice: string;
  timestamp: number;
}

export interface EscrowReadyNotification {
  orderId: string;
  resolverAddress: string;
  srcEscrowAddress: string;
  dstEscrowAddress: string;
  srcSafetyDepositTx: string;
  dstSafetyDepositTx: string;
}

export interface SettlementNotification {
  orderId: string;
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