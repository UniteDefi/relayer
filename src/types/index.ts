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

// New request type that includes the complete signed HTLCOrder
export interface CreateSwapRequest {
  htlcOrder: HTLCOrder;
  signature: string;
  secret: string;
}

export interface OrderData {
  orderId: string;
  swapRequest: SwapRequest;
  marketPrice: string;  // Current market price when order was created
  status: "active" | "committed" | "settling" | "completed" | "failed" | "rescue_available";
  resolver?: string;
  createdAt: number;
  expiresAt: number;
  
  // Dutch auction parameters
  auctionStartPrice: string;
  auctionEndPrice: string;
  auctionDuration: number;
  
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
  secretRevealTxHash?: string;
  
  // SDK order data (for 1inch cross-chain SDK orders)
  sdkOrder?: {
    orderData: any;
    extension: string;
    orderHash: string;
  };
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

// EIP-712 Types
export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface HTLCOrder {
  userAddress: string;
  srcChainId: number;
  srcToken: string;
  srcAmount: string;
  dstChainId: number;
  dstToken: string;
  secretHash: string;
  minAcceptablePrice: string;
  orderDuration: number;
  nonce: string;
  deadline: number;
}

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" }
];

export const HTLC_ORDER_TYPE = [
  { name: "userAddress", type: "address" },
  { name: "srcChainId", type: "uint256" },
  { name: "srcToken", type: "address" },
  { name: "srcAmount", type: "uint256" },
  { name: "dstChainId", type: "uint256" },
  { name: "dstToken", type: "address" },
  { name: "secretHash", type: "bytes32" },
  { name: "minAcceptablePrice", type: "uint256" },
  { name: "orderDuration", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" }
];

export const EIP712_TYPES = {
  EIP712Domain: EIP712_DOMAIN_TYPE,
  HTLCOrder: HTLC_ORDER_TYPE
};