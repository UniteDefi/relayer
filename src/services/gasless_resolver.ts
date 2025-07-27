import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";
import { ChainConfig } from "../common/config";

dotenv.config();

interface ActiveAuction {
  auctionId: string;
  srcChainId: number;
  srcToken: string;
  srcAmount: string;
  dstChainId: number;
  dstToken: string;
  startPrice: string;
  endPrice: string;
  createdAt: number;
  expiresAt: number;
  currentPrice: string;
}

interface TokenPrice {
  symbol: string;
  priceUSD: number;
}

export class GaslessResolver {
  private name: string;
  private privateKey: string;
  private relayerUrl: string;
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<number, ethers.Wallet> = new Map();
  private minProfitUSD: number;
  private checkInterval: number;
  private isRunning: boolean = false;
  
  // Token prices (mock for demo, use real price feeds in production)
  private tokenPrices: Map<string, TokenPrice> = new Map([
    ["LINK", { symbol: "LINK", priceUSD: 15 }],
    ["USDT", { symbol: "USDT", priceUSD: 1 }],
    ["USDC", { symbol: "USDC", priceUSD: 1 }],
    ["DAI", { symbol: "DAI", priceUSD: 1 }]
  ]);
  
  constructor(
    name: string,
    privateKey: string,
    relayerUrl: string,
    chains: ChainConfig[],
    minProfitUSD: number = 1,
    checkInterval: number = 5000
  ) {
    this.name = name;
    this.privateKey = privateKey;
    this.relayerUrl = relayerUrl;
    this.minProfitUSD = minProfitUSD;
    this.checkInterval = checkInterval;
    
    // Initialize providers and wallets for each chain
    chains.forEach(chain => {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
      
      const wallet = new ethers.Wallet(privateKey, provider);
      this.wallets.set(chain.chainId, wallet);
    });
  }
  
  async start() {
    console.log(`[${this.name}] Starting gasless resolver service...`);
    console.log(`[${this.name}] Min profit: $${this.minProfitUSD}`);
    console.log(`[${this.name}] Check interval: ${this.checkInterval}ms`);
    console.log(`[${this.name}] Relayer URL: ${this.relayerUrl}`);
    
    this.isRunning = true;
    this.monitorAuctions();
  }
  
  stop() {
    console.log(`[${this.name}] Stopping resolver service...`);
    this.isRunning = false;
  }
  
  private async monitorAuctions() {
    while (this.isRunning) {
      try {
        await this.checkActiveAuctions();
      } catch (error) {
        console.error(`[${this.name}] Error monitoring auctions:`, error);
      }
      
      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }
  }
  
  private async checkActiveAuctions() {
    try {
      // Fetch active auctions from relayer
      const response = await axios.get(`${this.relayerUrl}/api/active-auctions`);
      const auctions: ActiveAuction[] = response.data;
      
      console.log(`[${this.name}] Found ${auctions.length} active auctions`);
      
      // Evaluate each auction
      for (const auction of auctions) {
        await this.evaluateAuction(auction);
      }
    } catch (error) {
      console.error(`[${this.name}] Error fetching auctions:`, error);
    }
  }
  
  private async evaluateAuction(auction: ActiveAuction) {
    // Calculate profitability
    const srcTokenPrice = this.getTokenPrice(auction.srcToken);
    const dstTokenPrice = this.getTokenPrice(auction.dstToken);
    
    if (!srcTokenPrice || !dstTokenPrice) {
      console.log(`[${this.name}] Unknown token prices for auction ${auction.auctionId}`);
      return;
    }
    
    // Calculate values in USD
    const srcAmountUSD = this.calculateUSDValue(auction.srcAmount, srcTokenPrice, auction.srcToken);
    const dstAmountUSD = this.calculateUSDValue(auction.currentPrice, dstTokenPrice, auction.dstToken);
    
    const profitUSD = srcAmountUSD - dstAmountUSD;
    
    console.log(`[${this.name}] Auction ${auction.auctionId.slice(0, 10)}...`);
    console.log(`  Selling: ${this.formatAmount(auction.srcAmount, auction.srcToken)} ($${srcAmountUSD.toFixed(2)})`);
    console.log(`  Buying: ${this.formatAmount(auction.currentPrice, auction.dstToken)} ($${dstAmountUSD.toFixed(2)})`);
    console.log(`  Profit: $${profitUSD.toFixed(2)}`);
    
    // Check if profitable
    if (profitUSD >= this.minProfitUSD) {
      console.log(`[${this.name}] ✅ Profitable! Attempting to fill...`);
      await this.fillAuction(auction, profitUSD);
    } else {
      console.log(`[${this.name}] ❌ Not profitable enough (min: $${this.minProfitUSD})`);
    }
  }
  
  private async fillAuction(auction: ActiveAuction, profitUSD: number) {
    try {
      // Step 1: Create escrows on both chains with safety deposits
      console.log(`[${this.name}] Creating dual escrows...`);
      
      const srcEscrowData = await this.createSourceEscrow(auction);
      const dstEscrowData = await this.createDestinationEscrow(auction);
      
      console.log(`[${this.name}] Source escrow: ${srcEscrowData.address}`);
      console.log(`[${this.name}] Destination escrow: ${dstEscrowData.address}`);
      
      // Step 2: Commit to the auction via relayer
      const commitment = {
        auctionId: auction.auctionId,
        resolverAddress: this.wallets.get(auction.srcChainId)!.address,
        srcEscrowAddress: srcEscrowData.address,
        dstEscrowAddress: dstEscrowData.address,
        srcSafetyDepositTx: srcEscrowData.txHash,
        dstSafetyDepositTx: dstEscrowData.txHash,
        committedPrice: auction.currentPrice,
        timestamp: Date.now()
      };
      
      const commitResponse = await axios.post(
        `${this.relayerUrl}/api/commit-resolver`,
        commitment
      );
      
      if (!commitResponse.data.success) {
        throw new Error("Failed to commit to auction");
      }
      
      console.log(`[${this.name}] ✅ Committed to auction!`);
      
      // Step 3: Initiate settlement
      await this.settleAuction(auction);
      
    } catch (error) {
      console.error(`[${this.name}] Error filling auction:`, error);
    }
  }
  
  private async createSourceEscrow(auction: ActiveAuction): Promise<{ address: string; txHash: string }> {
    const wallet = this.wallets.get(auction.srcChainId)!;
    
    // Load escrow factory ABI (simplified)
    const factoryAbi = [
      "function createSrcEscrowWithDeposit(tuple(bytes32,uint256,address,address,address,bytes32,uint256,uint256) immutables) payable"
    ];
    
    // Get factory address (mock for demo)
    const factoryAddress = "0x1234567890123456789012345678901234567890";
    const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
    
    // Create immutables struct
    const immutables = {
      orderHash: auction.auctionId,
      amount: auction.srcAmount,
      maker: auction.srcToken, // Simplified, should be user address
      taker: wallet.address,
      token: auction.srcToken,
      hashlock: ethers.keccak256(ethers.toUtf8Bytes(auction.auctionId)), // Mock hashlock
      safetyDeposit: ethers.parseEther("0.001"),
      timelocks: 0 // Simplified
    };
    
    // Mock transaction for demo
    const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes(`src_escrow_${Date.now()}`));
    const mockAddress = ethers.computeAddress(wallet.privateKey).slice(0, 20) + "abcdef123456";
    
    console.log(`[${this.name}] Created source escrow (mock)`);
    
    return {
      address: mockAddress,
      txHash: mockTxHash
    };
  }
  
  private async createDestinationEscrow(auction: ActiveAuction): Promise<{ address: string; txHash: string }> {
    const wallet = this.wallets.get(auction.dstChainId)!;
    
    // Similar to source escrow but on destination chain
    const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes(`dst_escrow_${Date.now()}`));
    const mockAddress = ethers.computeAddress(wallet.privateKey).slice(0, 20) + "fedcba654321";
    
    console.log(`[${this.name}] Created destination escrow (mock)`);
    
    return {
      address: mockAddress,
      txHash: mockTxHash
    };
  }
  
  private async settleAuction(auction: ActiveAuction) {
    console.log(`[${this.name}] Starting settlement process...`);
    
    try {
      // Step 1: Request relayer to move user funds
      console.log(`[${this.name}] Requesting user funds transfer...`);
      const moveResponse = await axios.post(
        `${this.relayerUrl}/api/move-user-funds`,
        {
          auctionId: auction.auctionId,
          resolverAddress: this.wallets.get(auction.srcChainId)!.address
        }
      );
      
      if (!moveResponse.data.success) {
        throw new Error("Failed to move user funds");
      }
      
      console.log(`[${this.name}] User funds moved to escrow`);
      
      // Step 2: Deposit destination tokens
      console.log(`[${this.name}] Depositing ${this.formatAmount(auction.currentPrice, auction.dstToken)} to destination escrow...`);
      
      // Mock transaction for demo
      const dstTxHash = ethers.keccak256(ethers.toUtf8Bytes(`dst_deposit_${Date.now()}`));
      
      // Step 3: Notify completion
      const notification = {
        auctionId: auction.auctionId,
        resolverAddress: this.wallets.get(auction.srcChainId)!.address,
        dstTokenAmount: auction.currentPrice,
        dstTxHash: dstTxHash
      };
      
      const notifyResponse = await axios.post(
        `${this.relayerUrl}/api/notify-completion`,
        notification
      );
      
      if (!notifyResponse.data.success) {
        throw new Error("Failed to notify completion");
      }
      
      console.log(`[${this.name}] ✅ Settlement completed!`);
      console.log(`[${this.name}] Waiting for relayer to reveal secret...`);
      
    } catch (error) {
      console.error(`[${this.name}] Error during settlement:`, error);
    }
  }
  
  private getTokenPrice(tokenAddress: string): TokenPrice | undefined {
    // In production, map addresses to symbols and fetch real prices
    // For demo, using mock prices
    if (tokenAddress.toLowerCase().includes("link")) return this.tokenPrices.get("LINK");
    if (tokenAddress.toLowerCase().includes("usdt")) return this.tokenPrices.get("USDT");
    if (tokenAddress.toLowerCase().includes("usdc")) return this.tokenPrices.get("USDC");
    if (tokenAddress.toLowerCase().includes("dai")) return this.tokenPrices.get("DAI");
    return undefined;
  }
  
  private calculateUSDValue(amount: string, price: TokenPrice, token: string): number {
    // Determine decimals (simplified)
    const decimals = token.includes("LINK") ? 18 : 6;
    const value = Number(ethers.formatUnits(amount, decimals));
    return value * price.priceUSD;
  }
  
  private formatAmount(amount: string, token: string): string {
    const decimals = token.includes("LINK") ? 18 : 6;
    const formatted = ethers.formatUnits(amount, decimals);
    const symbol = this.getTokenSymbol(token);
    return `${formatted} ${symbol}`;
  }
  
  private getTokenSymbol(tokenAddress: string): string {
    if (tokenAddress.toLowerCase().includes("link")) return "LINK";
    if (tokenAddress.toLowerCase().includes("usdt")) return "USDT";
    if (tokenAddress.toLowerCase().includes("usdc")) return "USDC";
    if (tokenAddress.toLowerCase().includes("dai")) return "DAI";
    return "TOKEN";
  }
}