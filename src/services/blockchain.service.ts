import { ethers } from "ethers";
import { config } from "../config";

export class BlockchainService {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<number, ethers.Wallet> = new Map();
  private relayerContracts: Map<number, string> = new Map();
  
  // ERC20 ABI for allowance check
  private readonly ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)"
  ];
  
  constructor() {
    this.initializeProviders();
    this.initializeRelayerContracts();
  }
  
  private initializeProviders() {
    const privateKey = process.env.PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("No private key found in environment");
    }
    
    Object.values(config.chains).forEach(chain => {
      const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
      this.providers.set(chain.chainId, provider);
      
      const wallet = new ethers.Wallet(privateKey, provider);
      this.wallets.set(chain.chainId, wallet);
    });
  }
  
  private initializeRelayerContracts() {
    // Load deployed relayer contracts
    try {
      const deployments = require("../../../mock_relayer_deployments.json");
      if (deployments.baseSepolia) {
        this.relayerContracts.set(84532, deployments.baseSepolia.relayerContract);
      }
      if (deployments.arbitrumSepolia) {
        this.relayerContracts.set(421614, deployments.arbitrumSepolia.relayerContract);
      }
    } catch (error) {
      console.warn("[Blockchain] Mock relayer deployments not found, using placeholder addresses");
      this.relayerContracts.set(84532, "0x" + "1".repeat(40)); // Base Sepolia
      this.relayerContracts.set(421614, "0x" + "2".repeat(40)); // Arbitrum Sepolia
    }
  }
  
  getRelayerContract(chainId: number): string {
    const contract = this.relayerContracts.get(chainId);
    if (!contract) {
      throw new Error(`No relayer contract for chain ${chainId}`);
    }
    return contract;
  }
  
  async checkAllowance(
    chainId: number,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      const token = new ethers.Contract(tokenAddress, this.ERC20_ABI, provider);
      const allowance = await token.allowance(ownerAddress, spenderAddress);
      return allowance.toString();
    } catch (error) {
      console.error("[Blockchain] Error checking allowance:", error);
      // Return max allowance for testing
      return ethers.MaxUint256.toString();
    }
  }
  
  async verifyEscrowWithDeposit(
    chainId: number,
    escrowAddress: string,
    depositTxHash: string
  ): Promise<boolean> {
    // In production, would:
    // 1. Check contract exists at escrowAddress
    // 2. Verify depositTxHash shows transfer to escrow
    // 3. Verify deposit amount meets safety deposit requirement
    console.log(`[Blockchain] Verifying escrow ${escrowAddress} with deposit ${depositTxHash}`);
    return true;
  }
  
  async transferUserFundsViaRelayer(
    chainId: number,
    userAddress: string,
    tokenAddress: string,
    amount: string,
    escrowAddress: string
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    const wallet = this.wallets.get(chainId);
    
    if (!provider || !wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    console.log("[Blockchain] Transferring user funds via relayer:", {
      user: userAddress,
      token: tokenAddress,
      amount: amount,
      escrow: escrowAddress
    });
    
    // Get relayer contract address
    const relayerContract = this.getRelayerContract(chainId);
    
    // ABI for the actual RelayerContract
    const RELAYER_ABI = [
      "function transferUserFundsToEscrow(bytes32 orderId, address escrowAddress) external",
      "function registerOrder(bytes32 orderId, address user, address token, uint256 amount, bytes32 secretHash) external"
    ];
    
    const contract = new ethers.Contract(relayerContract, RELAYER_ABI, wallet);
    
    // Generate orderId from user and timestamp
    const orderId = ethers.keccak256(
      ethers.toUtf8Bytes(`order_${userAddress}_${Date.now()}`)
    );
    
    try {
      // Call the actual contract function
      const tx = await contract.transferUserFundsToEscrow(orderId, escrowAddress);
      console.log(`[Blockchain] Transfer TX: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`[Blockchain] Transfer confirmed in block ${receipt.blockNumber}`);
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Transfer failed:", error);
      throw new Error(`Failed to transfer user funds: ${error.message}`);
    }
  }
  
  async verifyResolverDeposit(
    chainId: number,
    txHash: string,
    escrowAddress: string,
    expectedAmount: string
  ): Promise<boolean> {
    // In production, would:
    // 1. Get transaction receipt
    // 2. Verify transfer event to escrow address
    // 3. Verify amount matches expected
    console.log(`[Blockchain] Verifying resolver deposit ${txHash} to ${escrowAddress}`);
    return true;
  }
  
  async waitForConfirmations(chainId: number, txHash: string): Promise<any> {
    console.log(`[Blockchain] Waiting for confirmations on chain ${chainId} for tx ${txHash}`);
    
    // Mock implementation - simulate transaction receipt
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      transactionHash: txHash,
      blockNumber: Math.floor(Math.random() * 1000000),
      status: 1
    };
  }
  
  async revealSecretOnDestination(
    chainId: number,
    escrowAddress: string,
    secret: string
  ): Promise<string> {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    console.log(`[Blockchain] Revealing secret on destination chain ${chainId}`);
    
    // Mock implementation
    const mockTxHash = "0x" + Buffer.from(`reveal_dest_${Date.now()}`).toString("hex").padEnd(64, "0");
    
    // In production, this would:
    // 1. Call escrow.revealSecret(secret)
    // 2. This unlocks funds for user and returns safety deposit to resolver
    // 3. Wait for confirmation
    
    return mockTxHash;
  }
  
  getProvider(chainId: number): ethers.JsonRpcProvider | undefined {
    return this.providers.get(chainId);
  }
  
  getWallet(chainId: number): ethers.Wallet | undefined {
    return this.wallets.get(chainId);
  }
}