# Relayer Architecture

## Overview

The Unite Relayer enables gasless cross-chain swaps through a combination of:
- Dutch auction price discovery
- HTLC-based atomic settlement
- Pre-approved token transfers
- Resolver competition

## Components

### 1. Relayer Service

The core Express.js service that:
- Accepts gasless swap requests from users
- Posts auctions on-chain
- Manages resolver commitments
- Orchestrates settlement

### 2. Smart Contracts

#### GaslessAuction.sol
- Posts Dutch auctions on-chain without escrow creation
- Tracks resolver commitments
- Manages auction lifecycle

#### RelayerEscrowFactory.sol
- Extends base EscrowFactory
- Allows relayer to move pre-approved user funds
- Enables resolver escrow creation with safety deposits

### 3. Resolver Services

Independent services that:
- Monitor active auctions
- Calculate profitability
- Create dual escrows when profitable
- Complete trades

## Flow Diagram

```
User                    Relayer                 Blockchain              Resolver
 |                        |                          |                      |
 |--Pre-approve tokens--->|                          |                      |
 |                        |                          |                      |
 |--Sign swap request---->|                          |                      |
 |                        |--Post auction----------->|                      |
 |                        |                          |<--Monitor auctions---|
 |                        |                          |                      |
 |                        |<--Commit to fill---------|--Create escrows----->|
 |                        |                          |                      |
 |                        |--Move user funds-------->|                      |
 |                        |                          |<--Deposit tokens-----|
 |                        |                          |                      |
 |                        |--Reveal secret---------->|                      |
 |<--Receive tokens-------|                          |--Claim tokens------->|
```

## Key Features

### 1. Gasless Transactions
Users only need to:
- Pre-approve tokens once
- Sign swap requests off-chain

### 2. Dutch Auction Pricing
- Starts at higher price
- Declines linearly over time
- Ensures market-driven pricing

### 3. Atomic Settlement
- HTLC ensures atomicity
- No trust required between parties
- Time-based fallbacks

### 4. Safety Deposits
- Resolvers post deposits on both chains
- Prevents griefing attacks
- Returned after successful settlement

## Security Considerations

1. **Pre-approval Safety**
   - Users only approve escrow factory
   - Factory can only move funds to valid escrows
   - Escrows have strict withdrawal conditions

2. **HTLC Security**
   - Secret known only to relayer initially
   - Reveal enables atomic settlement
   - Timeouts protect against failures

3. **Resolver Incentives**
   - Safety deposits discourage bad behavior
   - Competition ensures fair pricing
   - Reputation system (future enhancement)