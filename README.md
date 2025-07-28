# Cross-Chain Swap Relayer Service

A centralized relayer service that orchestrates gasless cross-chain token swaps between users and resolvers.

## Overview

The Relayer Service coordinates cross-chain swaps by:
- Broadcasting user swap orders to registered resolvers
- Managing resolver commitments and 5-minute execution timers
- Orchestrating escrow deployments and fund transfers
- Revealing secrets to complete atomic swaps
- Handling rescue mechanisms for failed orders

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Deploy contracts:
```bash
npm run deploy:contracts
```

4. Start the relayer service:
```bash
npm run dev
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## API Documentation

See [docs/API.md](docs/API.md) for API endpoint documentation.