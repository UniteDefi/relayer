import { ethers } from "ethers";
import { config } from "../config";
import { ChainConfig } from "../types";

export class BlockchainService {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<number, ethers.Wallet> = new Map();
  
  constructor() {
    this.initializeProviders();
  }
  
  private initializeProviders() {
    Object.values(config.chains).forEach((chain: ChainConfig) => {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
      
      const wallet = new ethers.Wallet(config.relayerPrivateKey, provider);
      this.wallets.set(chain.chainId, wallet);
    });
  }
  
  getProvider(chainId: number): ethers.JsonRpcProvider {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ${chainId}`);
    }
    return provider;
  }
  
  getWallet(chainId: number): ethers.Wallet {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`No wallet configured for chain ${chainId}`);
    }
    return wallet;
  }
  
  async postAuctionOnChain(
    chainId: number,
    auctionData: any
  ): Promise<string> {
    // Get auction contract for the chain
    const wallet = this.getWallet(chainId);
    
    // TODO: Load actual auction contract ABI and address
    // For now, returning mock transaction hash
    console.log(`[Blockchain] Posting auction on chain ${chainId}:`, auctionData);
    
    // In production, this would call the auction contract
    return `0x${Buffer.from(`auction_${Date.now()}`).toString("hex")}`;
  }
  
  async moveUserFundsToEscrow(
    chainId: number,
    userAddress: string,
    tokenAddress: string,
    amount: string,
    escrowAddress: string
  ): Promise<string> {
    const wallet = this.getWallet(chainId);
    
    // Load token contract
    const tokenAbi = [
      "function transferFrom(address from, address to, uint256 amount) returns (bool)"
    ];
    const token = new ethers.Contract(tokenAddress, tokenAbi, wallet);
    
    // Transfer from user to escrow (user must have pre-approved)
    console.log(`[Blockchain] Moving ${amount} tokens from ${userAddress} to escrow ${escrowAddress}`);
    
    try {
      const tx = await token.transferFrom(userAddress, escrowAddress, amount);
      const receipt = await tx.wait();
      return receipt.hash;
    } catch (error) {
      console.error("[Blockchain] Error moving user funds:", error);
      throw error;
    }
  }
  
  async revealSecretOnChain(
    chainId: number,
    escrowAddress: string,
    secret: string,
    auctionId: string
  ): Promise<string> {
    const wallet = this.getWallet(chainId);
    
    // Load escrow contract ABI
    const escrowAbi = [
      "function withdraw(bytes32 secret, tuple(bytes32,uint256,address,address,address,bytes32,uint256,uint256) immutables)"
    ];
    
    console.log(`[Blockchain] Revealing secret on chain ${chainId} for escrow ${escrowAddress}`);
    
    // TODO: Implement actual secret reveal
    // For now, returning mock transaction hash
    return `0x${Buffer.from(`reveal_${Date.now()}`).toString("hex")}`;
  }
  
  async waitForConfirmations(
    chainId: number,
    txHash: string
  ): Promise<ethers.TransactionReceipt | null> {
    const provider = this.getProvider(chainId);
    const chainConfig = config.chains[chainId];
    
    console.log(`[Blockchain] Waiting for ${chainConfig.confirmations} confirmations on chain ${chainId}`);
    
    const receipt = await provider.waitForTransaction(
      txHash,
      chainConfig.confirmations
    );
    
    return receipt;
  }
  
  async checkEscrowDeployment(
    chainId: number,
    escrowAddress: string
  ): Promise<boolean> {
    const provider = this.getProvider(chainId);
    
    // Check if contract exists at address
    const code = await provider.getCode(escrowAddress);
    return code !== "0x";
  }
}