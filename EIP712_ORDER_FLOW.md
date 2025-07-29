# EIP-712 Order Flow

## Overview

The HTLC cross-chain swap system now uses EIP-712 signatures for order creation, eliminating the need for on-chain transactions until the resolver commits to fill an order.

## Order Flow

### 1. User Creates Order (Off-chain)

The user signs an order using EIP-712 standard:

```typescript
// Order structure
interface HTLCOrder {
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
```

### 2. Submit to Relayer API

```typescript
POST /api/create-swap
{
  swapRequest: {
    userAddress: "0x...",
    srcChainId: 11155111,
    srcToken: "0x...",
    srcAmount: "1000000",
    dstChainId: 84532,
    dstToken: "0x...",
    secretHash: "0x...",
    minAcceptablePrice: "1000000",
    orderDuration: 3600
  },
  signature: "0x...", // EIP-712 signature
  secret: "0x..."     // Secret for HTLC (stored securely)
}
```

### 3. Relayer Verifies and Broadcasts

- Verifies EIP-712 signature
- Validates secret hash matches
- Checks user has approved tokens to UniteEscrowFactory
- Broadcasts order to resolvers via SQS

### 4. Resolver Commits

- Resolver sees order and commits to fill
- First on-chain transaction happens here (resolver deploys escrows)

## Frontend Integration

```typescript
import { signHTLCOrder } from "./lib/eip712";

// Sign order
const { signature, orderId } = await signHTLCOrder(
  signer,
  swapRequest,
  escrowFactoryAddress
);

// Submit to API
const response = await fetch("/api/create-swap", {
  method: "POST",
  body: JSON.stringify({
    ...orderData,
    signature,
    secret
  })
});
```

## Benefits

1. **No upfront gas costs** - Users don't pay gas to create orders
2. **Better UX** - Orders are instant, no waiting for confirmations
3. **Cancellable** - Orders can expire without on-chain cancellation
4. **Deterministic Order IDs** - Order ID is the EIP-712 hash

## Helper Endpoints

### Get Typed Data for Signing
```
POST /api/get-typed-data
```
Returns the properly formatted EIP-712 typed data for wallet signing.

## Security Notes

- Orders are bound to specific chain IDs and escrow factory addresses
- Signatures prevent tampering with order parameters
- Secrets are stored securely by the relayer, never exposed in broadcasts
- Order IDs are deterministic based on EIP-712 hash