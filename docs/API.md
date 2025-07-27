# Relayer API Documentation

## Overview

The Unite Relayer provides a REST API for managing gasless cross-chain swaps.

## Base URL

```
http://localhost:3001
```

## Endpoints

### Health Check

```
GET /health
```

Returns the health status of the relayer service.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-07-27T08:26:07.094Z",
  "chains": [
    {
      "chainId": "84532",
      "name": "Base Sepolia"
    },
    {
      "chainId": "421614", 
      "name": "Arbitrum Sepolia"
    }
  ]
}
```

### Create Swap

```
POST /api/create-swap
```

Creates a new gasless swap auction.

**Request Body:**
```json
{
  "swapRequest": {
    "userAddress": "0x...",
    "srcChainId": 84532,
    "srcToken": "0x...",
    "srcAmount": "50000000",
    "dstChainId": 421614,
    "dstToken": "0x...",
    "secretHash": "0x...",
    "startPrice": "52000000",
    "endPrice": "48000000",
    "auctionDuration": 300,
    "signature": "0x..."
  },
  "secret": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "auctionId": "0x...",
  "txHash": "0x..."
}
```

### Commit Resolver

```
POST /api/commit-resolver
```

Allows a resolver to commit to filling an auction.

**Request Body:**
```json
{
  "auctionId": "0x...",
  "resolverAddress": "0x...",
  "srcEscrowAddress": "0x...",
  "dstEscrowAddress": "0x...",
  "srcSafetyDepositTx": "0x...",
  "dstSafetyDepositTx": "0x...",
  "committedPrice": "51000000",
  "timestamp": 1234567890
}
```

### Move User Funds

```
POST /api/move-user-funds
```

Moves pre-approved user funds to escrow (only callable by committed resolver).

**Request Body:**
```json
{
  "auctionId": "0x...",
  "resolverAddress": "0x..."
}
```

### Notify Settlement

```
POST /api/notify-completion
```

Notifies the relayer that resolver has completed their side of the trade.

**Request Body:**
```json
{
  "auctionId": "0x...",
  "resolverAddress": "0x...",
  "dstTokenAmount": "51000000",
  "dstTxHash": "0x..."
}
```

### Get Auction Status

```
GET /api/auction-status/:id
```

Retrieves the current status of an auction.

### List Active Auctions

```
GET /api/active-auctions
```

Returns all active auctions that can be filled by resolvers.

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

Common HTTP status codes:
- 200: Success
- 400: Bad Request
- 404: Not Found
- 500: Internal Server Error