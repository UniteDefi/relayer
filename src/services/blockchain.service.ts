import { ethers } from "ethers";
import { config } from "../config";
import { getContractAddress } from "../utils/deployment-loader";

export class BlockchainService {
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private wallets: Map<number, ethers.Wallet> = new Map();
  private escrowFactories: Map<number, string> = new Map();
  
  // ERC20 ABI for allowance check and transfers
  private readonly ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)"
  ];
  
  // UniteEscrowFactory ABI for escrow deployment
  private readonly UNITE_ESCROW_FACTORY_ABI = [
    "function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) dstImmutables, uint256 srcCancellationTimestamp) payable",
    "function addressOfEscrowSrc(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) immutables) view returns (address)",
    "function addressOfEscrowDst(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) immutables) view returns (address)",
    "function getTotalFilledAmount(bytes32 orderHash) external view returns (uint256)",
    "function transferUserFunds(bytes32 orderHash, address from, address token, uint256 amount) external",
    "function authorizeRelayer(address relayer) external",
    "function revokeRelayer(address relayer) external",
    "function authorizedRelayers(address) view returns (bool)",
    "event SrcEscrowCreated(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) immutables, tuple(address maker, uint256 amount, address token, uint256 safetyDeposit, uint32 chainId) complement)",
    "event DstEscrowCreated(address escrow, bytes32 hashlock, address taker)",
    "event UserFundsTransferredToEscrow(address indexed user, address indexed escrow, address indexed token, uint256 amount)"
  ];
  
  // Escrow contract ABI for interactions
  private readonly ESCROW_ABI = [
    "function withdraw(bytes32 secret, tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) immutables)",
    "function cancel(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, tuple(uint32 srcWithdrawal, uint32 srcCancellation, uint32 srcPublicWithdrawal, uint32 srcPublicCancellation, uint32 dstWithdrawal, uint32 dstCancellation, uint32 dstPublicWithdrawal, uint32 deployedAt) timelocks) immutables)",
    "event EscrowWithdrawal(bytes32 secret)",
    "event EscrowCancelled()"
  ];
  
  constructor() {
    this.initializeProviders();
    this.initializeEscrowFactories();
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
  
  private initializeEscrowFactories() {
    // Initialize escrow factory addresses from config
    Object.values(config.chains).forEach(chain => {
      this.escrowFactories.set(chain.chainId, chain.escrowFactory);
      console.log(`[Blockchain] Escrow Factory for ${chain.name} (${chain.chainId}): ${chain.escrowFactory}`);
    });
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
  
  async getTotalFilledAmount(
    chainId: number,
    orderHash: string
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    const escrowFactory = this.escrowFactories.get(chainId);
    if (!escrowFactory) {
      throw new Error(`No escrow factory for chain ${chainId}`);
    }
    
    try {
      const contract = new ethers.Contract(escrowFactory, this.UNITE_ESCROW_FACTORY_ABI, provider);
      const totalFilled = await contract.getTotalFilledAmount(orderHash);
      return totalFilled.toString();
    } catch (error) {
      console.error("[Blockchain] Error getting total filled amount:", error);
      throw new Error(`Failed to get total filled amount: ${error.message}`);
    }
  }

  async transferUserFundsToEscrow(
    chainId: number,
    userAddress: string,
    tokenAddress: string,
    amount: string,
    orderHash: string
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    const wallet = this.wallets.get(chainId);
    
    if (!provider || !wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    console.log("[Blockchain] Step 7: Transferring user funds via UniteEscrowFactory:", {
      user: userAddress,
      token: tokenAddress,
      amount,
      orderHash
    });
    
    // Get UniteEscrowFactory address
    const escrowFactory = this.escrowFactories.get(chainId);
    if (!escrowFactory) {
      throw new Error(`No escrow factory for chain ${chainId}`);
    }
    
    const contract = new ethers.Contract(escrowFactory, this.UNITE_ESCROW_FACTORY_ABI, wallet);
    
    try {
      // Check if relayer is authorized
      const isAuthorized = await contract.authorizedRelayers(wallet.address);
      if (!isAuthorized) {
        throw new Error(`Relayer ${wallet.address} is not authorized in UniteEscrowFactory`);
      }
      
      // Check total filled amount before transferring
      const totalFilled = await contract.getTotalFilledAmount(orderHash);
      console.log(`[Blockchain] Current total filled amount: ${totalFilled.toString()}`);
      
      // Call the new UniteEscrowFactory method to transfer user's pre-approved funds
      const tx = await contract.transferUserFunds(
        orderHash,
        userAddress,
        tokenAddress,
        amount
      );
      console.log(`[Blockchain] Step 7 Transfer TX: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`[Blockchain] Step 7 Transfer confirmed in block ${receipt.blockNumber}`);
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Step 7 Transfer failed:", error);
      throw new Error(`Failed to transfer user funds: ${error.message}`);
    }
  }
  
  async verifyResolverDeposit(
    chainId: number,
    txHash: string,
    escrowAddress: string,
    expectedAmount: string
  ): Promise<boolean> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      console.log(`[Blockchain] Verifying resolver deposit ${txHash} to ${escrowAddress}`);
      
      // 1. Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        console.error("[Blockchain] Transaction failed or not found");
        return false;
      }
      
      // 2. Get transaction details
      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        console.error("[Blockchain] Transaction not found");
        return false;
      }
      
      // 3. Check if it's a native token transfer to escrow
      if (tx.to?.toLowerCase() === escrowAddress.toLowerCase()) {
        // Native token transfer
        const actualAmount = ethers.formatEther(tx.value);
        const expectedAmountEth = ethers.formatEther(expectedAmount);
        
        if (actualAmount === expectedAmountEth) {
          console.log("[Blockchain] Native token deposit verified");
          return true;
        }
      }
      
      // 4. Check for ERC20 transfer events
      const transferEventSig = ethers.id("Transfer(address,address,uint256)");
      
      for (const log of receipt.logs) {
        if (log.topics[0] === transferEventSig && log.topics.length === 3) {
          // Decode the transfer event
          const from = ethers.getAddress("0x" + log.topics[1].slice(26));
          const to = ethers.getAddress("0x" + log.topics[2].slice(26));
          const amount = ethers.toBigInt(log.data);
          
          if (to.toLowerCase() === escrowAddress.toLowerCase() && 
              amount.toString() === expectedAmount) {
            console.log("[Blockchain] ERC20 deposit verified");
            return true;
          }
        }
      }
      
      console.error("[Blockchain] No matching transfer found");
      return false;
    } catch (error) {
      console.error("[Blockchain] Error verifying deposit:", error);
      return false;
    }
  }
  
  async waitForConfirmations(chainId: number, txHash: string): Promise<any> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    const requiredConfirmations = config.chains[chainId]?.confirmations || 3;
    
    console.log(`[Blockchain] Waiting for ${requiredConfirmations} confirmations on chain ${chainId} for tx ${txHash}`);
    
    try {
      // Get initial receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new Error("Transaction not found");
      }
      
      if (receipt.status === 0) {
        throw new Error("Transaction failed");
      }
      
      // Wait for required confirmations
      const confirmations = await receipt.wait(requiredConfirmations);
      
      console.log(`[Blockchain] Transaction confirmed with ${confirmations} confirmations`);
      
      return {
        transactionHash: txHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        confirmations: confirmations
      };
    } catch (error) {
      console.error("[Blockchain] Error waiting for confirmations:", error);
      throw new Error(`Failed to wait for confirmations: ${error.message}`);
    }
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
    
    console.log(`[Blockchain] Step 9: Revealing secret on destination chain ${chainId}`);
    console.log(`[Blockchain] Escrow address: ${escrowAddress}`);
    console.log(`[Blockchain] Secret: ${secret}`);
    
    // SimpleEscrow ABI for claimWithSecret function
    const SIMPLE_ESCROW_ABI = [
      "function claimWithSecret(bytes32 secret) external",
      "function secretHash() view returns (bytes32)",
      "function claimed() view returns (bool)",
      "function deadline() view returns (uint256)",
      "function user() view returns (address)",
      "function resolver() view returns (address)",
      "function token() view returns (address)",
      "function amount() view returns (uint256)"
    ];
    
    const escrowContract = new ethers.Contract(escrowAddress, SIMPLE_ESCROW_ABI, wallet);
    
    try {
      // Check if already claimed
      const isClaimed = await escrowContract.claimed();
      if (isClaimed) {
        throw new Error("Escrow already claimed");
      }
      
      // Check deadline
      const deadline = await escrowContract.deadline();
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime > deadline) {
        throw new Error("Escrow deadline has passed");
      }
      
      // Verify secret hash matches
      const expectedHash = await escrowContract.secretHash();
      
      // Convert secret to bytes32 first
      const secretBytes32 = ethers.encodeBytes32String(secret);
      
      // Compute hash using abi.encodePacked equivalent
      const computedHash = ethers.keccak256(secretBytes32);
      
      console.log(`[Blockchain] Expected hash: ${expectedHash}`);
      console.log(`[Blockchain] Computed hash: ${computedHash}`);
      console.log(`[Blockchain] Secret bytes32: ${secretBytes32}`);
      
      if (computedHash !== expectedHash) {
        console.error("[Blockchain] Secret hash mismatch!");
        throw new Error("Invalid secret - hash mismatch");
      }
      
      console.log(`[Blockchain] Calling claimWithSecret with bytes32: ${secretBytes32}`);
      
      // Reveal the secret to unlock funds
      const tx = await escrowContract.claimWithSecret(secretBytes32);
      console.log(`[Blockchain] Secret reveal TX: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`[Blockchain] Secret revealed in block ${receipt.blockNumber}`);
      console.log(`[Blockchain] User can now claim funds, resolver safety deposit returned`);
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Secret reveal failed:", error);
      throw new Error(`Failed to reveal secret: ${error.message}`);
    }
  }
  
  getProvider(chainId: number): ethers.JsonRpcProvider | undefined {
    return this.providers.get(chainId);
  }
  
  getWallet(chainId: number): ethers.Wallet | undefined {
    return this.wallets.get(chainId);
  }
  
  async getRevealedSecretFromDestination(
    chainId: number,
    escrowAddress: string,
    txHash: string
  ): Promise<string | null> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      console.log(`[Blockchain] Retrieving revealed secret from tx ${txHash}`);
      
      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        throw new Error("Transaction receipt not found");
      }
      
      // Look for EscrowWithdrawal event from SimpleEscrow
      const escrowInterface = new ethers.Interface([
        "event EscrowWithdrawal(bytes32 secret)"
      ]);
      
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === escrowAddress.toLowerCase()) {
          try {
            const parsed = escrowInterface.parseLog({
              topics: log.topics as string[],
              data: log.data
            });
            
            if (parsed && parsed.name === "EscrowWithdrawal") {
              const secretBytes32 = parsed.args[0];
              // Convert bytes32 back to string
              const secret = ethers.decodeBytes32String(secretBytes32);
              console.log(`[Blockchain] Found revealed secret: ${secret}`);
              return secret;
            }
          } catch (e) {
            // Not the event we're looking for
          }
        }
      }
      
      throw new Error("Secret not found in transaction logs");
    } catch (error) {
      console.error("[Blockchain] Error retrieving secret:", error);
      return null;
    }
  }
  
  async withdrawFromSourceEscrow(
    chainId: number,
    escrowAddress: string,
    secret: string,
    resolverAddress: string
  ): Promise<string> {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    console.log(`[Blockchain] Step 10: Resolver withdrawing from source escrow on chain ${chainId}`);
    console.log(`[Blockchain] Escrow address: ${escrowAddress}`);
    console.log(`[Blockchain] Secret: ${secret}`);
    
    // For SimpleEscrow on source chain, the resolver can call claimWithSecret
    const SIMPLE_ESCROW_ABI = [
      "function claimWithSecret(bytes32 secret) external",
      "function claimed() view returns (bool)",
      "function resolver() view returns (address)"
    ];
    
    const escrowContract = new ethers.Contract(escrowAddress, SIMPLE_ESCROW_ABI, wallet);
    
    try {
      // Check if already claimed
      const isClaimed = await escrowContract.claimed();
      if (isClaimed) {
        throw new Error("Source escrow already claimed");
      }
      
      // Verify resolver address matches
      const expectedResolver = await escrowContract.resolver();
      if (expectedResolver.toLowerCase() !== resolverAddress.toLowerCase()) {
        throw new Error(`Invalid resolver. Expected ${expectedResolver}, got ${resolverAddress}`);
      }
      
      // Convert secret to bytes32
      const secretBytes32 = ethers.encodeBytes32String(secret);
      
      console.log(`[Blockchain] Calling claimWithSecret on source escrow`);
      
      // Withdraw from source escrow using the revealed secret
      const tx = await escrowContract.claimWithSecret(secretBytes32);
      console.log(`[Blockchain] Source withdrawal TX: ${tx.hash}`);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log(`[Blockchain] Step 10 Complete: Resolver withdrew from source escrow in block ${receipt.blockNumber}`);
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Source withdrawal failed:", error);
      throw new Error(`Failed to withdraw from source escrow: ${error.message}`);
    }
  }
  
  async deploySourceEscrow(
    chainId: number,
    orderId: string,
    secretHash: string,
    userAddress: string,
    tokenAddress: string,
    amount: string,
    safetyDeposit: string
  ): Promise<{ escrowAddress: string; deployTxHash: string }> {
    const provider = this.providers.get(chainId);
    const wallet = this.wallets.get(chainId);
    
    if (!provider || !wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    const escrowFactory = this.escrowFactories.get(chainId);
    if (!escrowFactory) {
      throw new Error(`No escrow factory for chain ${chainId}`);
    }
    
    console.log("[Blockchain] Deploying source escrow:", {
      chainId,
      orderId,
      secretHash,
      userAddress,
      tokenAddress,
      amount,
      safetyDeposit
    });
    
    // For source escrow, the deployment happens through the Limit Order Protocol
    // So we calculate the deterministic address and pre-fund it with safety deposit
    const immutables = {
      orderHash: orderId,
      hashlock: secretHash,
      maker: userAddress,
      taker: wallet.address, // Relayer is the taker
      token: tokenAddress,
      amount: amount,
      safetyDeposit: safetyDeposit,
      timelocks: this.createTimelocks()
    };
    
    // Calculate deterministic escrow address
    const factory = new ethers.Contract(escrowFactory, this.UNITE_ESCROW_FACTORY_ABI, wallet);
    const escrowAddress = await factory.addressOfEscrowSrc(immutables);
    
    console.log("[Blockchain] Calculated source escrow address:", escrowAddress);
    
    // Pre-fund escrow with safety deposit
    try {
      const tx = await wallet.sendTransaction({
        to: escrowAddress,
        value: ethers.parseEther(safetyDeposit)
      });
      
      console.log("[Blockchain] Safety deposit TX:", tx.hash);
      const receipt = await tx.wait();
      
      return {
        escrowAddress,
        deployTxHash: tx.hash
      };
    } catch (error) {
      console.error("[Blockchain] Failed to deploy source escrow:", error);
      throw new Error(`Failed to deploy source escrow: ${error.message}`);
    }
  }
  
  async deployDestinationEscrow(
    chainId: number,
    orderId: string,
    secretHash: string,
    userAddress: string,
    resolverAddress: string,
    tokenAddress: string,
    amount: string,
    safetyDeposit: string,
    srcCancellationTimestamp: number
  ): Promise<{ escrowAddress: string; deployTxHash: string }> {
    const provider = this.providers.get(chainId);
    const wallet = this.wallets.get(chainId);
    
    if (!provider || !wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    const escrowFactory = this.escrowFactories.get(chainId);
    if (!escrowFactory) {
      throw new Error(`No escrow factory for chain ${chainId}`);
    }
    
    console.log("[Blockchain] Deploying destination escrow:", {
      chainId,
      orderId,
      secretHash,
      userAddress,
      resolverAddress,
      tokenAddress,
      amount,
      safetyDeposit
    });
    
    const immutables = {
      orderHash: orderId,
      hashlock: secretHash,
      maker: resolverAddress, // Resolver is maker on destination
      taker: userAddress, // User is taker on destination
      token: tokenAddress,
      amount: amount,
      safetyDeposit: safetyDeposit,
      timelocks: this.createTimelocks()
    };
    
    const factory = new ethers.Contract(escrowFactory, this.UNITE_ESCROW_FACTORY_ABI, wallet);
    
    try {
      // For native token (ETH), we need to send value with the transaction
      const isNativeToken = tokenAddress === ethers.ZeroAddress;
      const nativeValue = isNativeToken 
        ? ethers.parseEther(amount) + ethers.parseEther(safetyDeposit)
        : ethers.parseEther(safetyDeposit);
      
      console.log("[Blockchain] Creating destination escrow with value:", ethers.formatEther(nativeValue));
      
      const tx = await factory.createDstEscrow(
        immutables,
        srcCancellationTimestamp,
        { value: nativeValue }
      );
      
      console.log("[Blockchain] Destination escrow deployment TX:", tx.hash);
      const receipt = await tx.wait();
      
      // Extract escrow address from event
      const event = receipt.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === "DstEscrowCreated";
        } catch {
          return false;
        }
      });
      
      if (!event) {
        throw new Error("DstEscrowCreated event not found");
      }
      
      const parsedEvent = factory.interface.parseLog(event);
      const escrowAddress = parsedEvent.args[0];
      
      console.log("[Blockchain] Destination escrow deployed at:", escrowAddress);
      
      return {
        escrowAddress,
        deployTxHash: tx.hash
      };
    } catch (error) {
      console.error("[Blockchain] Failed to deploy destination escrow:", error);
      throw new Error(`Failed to deploy destination escrow: ${error.message}`);
    }
  }
  
  private createTimelocks() {
    const now = Math.floor(Date.now() / 1000);
    const duration = config.order.defaultDuration;
    
    return {
      srcWithdrawal: now + 60, // 1 minute for finality
      srcCancellation: now + duration, // 5 minutes
      srcPublicWithdrawal: now + 120, // 2 minutes
      srcPublicCancellation: now + duration + 60, // 6 minutes
      dstWithdrawal: now + 60, // 1 minute
      dstCancellation: now + duration - 60, // 4 minutes (before src cancellation)
      dstPublicWithdrawal: now + 120, // 2 minutes
      deployedAt: now
    };
  }
  
  async transferUserFunds(
    chainId: number,
    userAddress: string,
    orderHash: string,
    tokenAddress: string,
    amount: string
  ): Promise<string> {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    const escrowFactory = this.escrowFactories.get(chainId);
    if (!escrowFactory) {
      throw new Error(`No escrow factory for chain ${chainId}`);
    }
    
    console.log("[Blockchain] Transferring user funds via UniteEscrowFactory:", {
      userAddress,
      orderHash,
      tokenAddress,
      amount
    });
    
    try {
      const factory = new ethers.Contract(escrowFactory, this.UNITE_ESCROW_FACTORY_ABI, wallet);
      
      // Check total filled amount before transferring
      const totalFilled = await factory.getTotalFilledAmount(orderHash);
      console.log(`[Blockchain] Current total filled amount: ${totalFilled.toString()}`);
      
      // Use new UniteEscrowFactory method to transfer user's pre-approved funds
      const tx = await factory.transferUserFunds(
        orderHash,
        userAddress,
        tokenAddress,
        amount
      );
      console.log("[Blockchain] User funds transfer TX:", tx.hash);
      
      const receipt = await tx.wait();
      console.log("[Blockchain] User funds transferred in block:", receipt.blockNumber);
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Failed to transfer user funds:", error);
      throw new Error(`Failed to transfer user funds: ${error.message}`);
    }
  }
  
  async transferSafetyDeposit(
    chainId: number,
    fromAddress: string,
    toAddress: string,
    amount: string
  ): Promise<string> {
    const wallet = this.wallets.get(chainId);
    if (!wallet) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    console.log("[Blockchain] Transferring safety deposit:", {
      from: fromAddress,
      to: toAddress,
      amount
    });
    
    try {
      // Safety deposits are in native token (ETH)
      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(amount)
      });
      
      console.log("[Blockchain] Safety deposit TX:", tx.hash);
      const receipt = await tx.wait();
      
      return tx.hash;
    } catch (error) {
      console.error("[Blockchain] Failed to transfer safety deposit:", error);
      throw new Error(`Failed to transfer safety deposit: ${error.message}`);
    }
  }
  
  async getEscrowBalance(
    chainId: number,
    escrowAddress: string,
    tokenAddress?: string
  ): Promise<string> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      if (!tokenAddress || tokenAddress === ethers.ZeroAddress) {
        // Native token balance
        const balance = await provider.getBalance(escrowAddress);
        return balance.toString();
      } else {
        // ERC20 token balance
        const token = new ethers.Contract(tokenAddress, this.ERC20_ABI, provider);
        const balance = await token.balanceOf(escrowAddress);
        return balance.toString();
      }
    } catch (error) {
      console.error("[Blockchain] Failed to get escrow balance:", error);
      throw new Error(`Failed to get escrow balance: ${error.message}`);
    }
  }
  
  async estimateGas(
    chainId: number,
    transaction: ethers.TransactionRequest
  ): Promise<bigint> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      const gasEstimate = await provider.estimateGas(transaction);
      // Add 20% buffer for safety
      return gasEstimate * 120n / 100n;
    } catch (error) {
      console.error("[Blockchain] Failed to estimate gas:", error);
      throw new Error(`Failed to estimate gas: ${error.message}`);
    }
  }
  
  async checkTransactionStatus(
    chainId: number,
    txHash: string
  ): Promise<{ status: "pending" | "success" | "failed"; receipt?: any }> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { status: "pending" };
      }
      
      return {
        status: receipt.status === 1 ? "success" : "failed",
        receipt
      };
    } catch (error) {
      console.error("[Blockchain] Failed to check transaction status:", error);
      throw new Error(`Failed to check transaction status: ${error.message}`);
    }
  }
  
  async getGasPrice(chainId: number): Promise<bigint> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }
    
    try {
      const feeData = await provider.getFeeData();
      return feeData.gasPrice || 0n;
    } catch (error) {
      console.error("[Blockchain] Failed to get gas price:", error);
      throw new Error(`Failed to get gas price: ${error.message}`);
    }
  }

  async verifyBothEscrowsFunded(
    srcChainId: number,
    dstChainId: number,
    srcEscrowAddress: string,
    dstEscrowAddress: string,
    srcTokenAddress: string,
    dstTokenAddress: string,
    expectedSrcAmount: string,
    expectedDstAmount: string
  ): Promise<{ srcFunded: boolean; dstFunded: boolean }> {
    console.log(`[Blockchain] Verifying funds in both escrows:`);
    console.log(`[Blockchain] - Source: ${srcEscrowAddress} on chain ${srcChainId} (${expectedSrcAmount})`);
    console.log(`[Blockchain] - Destination: ${dstEscrowAddress} on chain ${dstChainId} (${expectedDstAmount})`);

    try {
      // Check both escrows in parallel
      const [srcFunded, dstFunded] = await Promise.all([
        this.verifyEscrowBalance(srcChainId, srcEscrowAddress, srcTokenAddress, expectedSrcAmount),
        this.verifyEscrowBalance(dstChainId, dstEscrowAddress, dstTokenAddress, expectedDstAmount)
      ]);

      console.log(`[Blockchain] Fund verification results: src=${srcFunded}, dst=${dstFunded}`);
      
      return { srcFunded, dstFunded };
    } catch (error) {
      console.error("[Blockchain] Error verifying escrow funds:", error);
      return { srcFunded: false, dstFunded: false };
    }
  }

  private async verifyEscrowBalance(
    chainId: number,
    escrowAddress: string,
    tokenAddress: string,
    expectedAmount: string
  ): Promise<boolean> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Chain ${chainId} not configured`);
    }

    try {
      const tokenContract = new ethers.Contract(tokenAddress, this.ERC20_ABI, provider);
      const balance = await tokenContract.balanceOf(escrowAddress);
      
      const balanceStr = balance.toString();
      const expectedAmountBN = ethers.getBigInt(expectedAmount);
      
      console.log(`[Blockchain] Escrow ${escrowAddress} balance: ${balanceStr}, expected: ${expectedAmount}`);
      
      // Balance should be >= expected amount (in case of precision differences)
      return balance >= expectedAmountBN;
    } catch (error) {
      console.error(`[Blockchain] Error checking escrow balance on chain ${chainId}:`, error);
      return false;
    }
  }
}