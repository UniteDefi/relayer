# Unite Relayer Service

A gasless cross-chain swap relayer service for the Unite DeFi protocol.

## Overview

The Unite Relayer enables gasless cross-chain swaps by:
- Managing Dutch auction-based price discovery
- Orchestrating HTLC-based atomic settlements
- Enabling users to swap with only one-time token approvals

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