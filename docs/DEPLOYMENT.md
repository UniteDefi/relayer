# Deployment Guide

## Prerequisites

- Node.js >= 18
- npm or yarn
- Access to RPC endpoints (Alchemy, Infura, etc.)
- Private key with sufficient funds for deployment

## Environment Setup

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Configure the following variables:
```
# Private Keys
PRIVATE_KEY=your_deployer_private_key
RELAYER_PRIVATE_KEY=your_relayer_service_private_key

# RPC Endpoints
ALCHEMY_API_KEY=your_alchemy_api_key

# Service Configuration
PORT=3001
RELAYER_FEE_BPS=50  # 0.5% fee
```

## Contract Deployment

1. Compile contracts (if using Hardhat):
```bash
npx hardhat compile
```

2. Deploy contracts to all supported chains:
```bash
npm run deploy:contracts
```

This will deploy:
- GaslessAuction contract
- RelayerEscrowFactory contract

Deployments will be saved to `deployments.json`.

## Service Deployment

### Local Development

```bash
npm run dev
```

### Production with PM2

1. Install PM2:
```bash
npm install -g pm2
```

2. Build the service:
```bash
npm run build
```

3. Start with PM2:
```bash
pm2 start dist/index.js --name unite-relayer
```

4. Save PM2 configuration:
```bash
pm2 save
pm2 startup
```

### Docker Deployment

1. Build Docker image:
```bash
docker build -t unite-relayer .
```

2. Run container:
```bash
docker run -d \
  --name unite-relayer \
  -p 3001:3001 \
  --env-file .env \
  unite-relayer
```

### Cloud Deployment

#### AWS EC2

1. Launch EC2 instance (t3.small or larger)
2. Install Node.js and npm
3. Clone repository and install dependencies
4. Configure environment variables
5. Set up nginx reverse proxy
6. Use PM2 for process management

#### Heroku

1. Create Heroku app:
```bash
heroku create unite-relayer
```

2. Set environment variables:
```bash
heroku config:set ALCHEMY_API_KEY=your_key
heroku config:set PRIVATE_KEY=your_key
```

3. Deploy:
```bash
git push heroku main
```

## Monitoring

### Health Check

The service exposes a health endpoint:
```
GET https://your-domain.com/health
```

### Logs

With PM2:
```bash
pm2 logs unite-relayer
```

With Docker:
```bash
docker logs unite-relayer
```

### Metrics

Consider integrating:
- Prometheus for metrics collection
- Grafana for visualization
- Sentry for error tracking

## Security Considerations

1. **Private Key Management**
   - Use hardware wallets or KMS for production
   - Never commit private keys to version control
   - Rotate keys regularly

2. **API Security**
   - Implement rate limiting
   - Add API key authentication for write endpoints
   - Use HTTPS in production

3. **Smart Contract Security**
   - Audit contracts before mainnet deployment
   - Use multi-sig for contract ownership
   - Implement emergency pause functionality

## Maintenance

### Updating Contracts

1. Deploy new contract versions
2. Update `deployments.json`
3. Restart relayer service

### Database Backups

If using persistent storage:
```bash
# Backup auction data
npm run backup:auctions

# Restore from backup
npm run restore:auctions
```

### Scaling

For high load:
1. Deploy multiple relayer instances
2. Use load balancer
3. Implement Redis for shared state
4. Consider database for auction storage