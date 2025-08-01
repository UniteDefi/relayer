import { ethers } from "ethers";
import { OrderData, SwapRequest, ResolverCommitment, SettlementNotification, EscrowReadyNotification, HTLCOrder } from "../types";
import { BlockchainService } from "./blockchain.service";
import { SQSService, SQSSecretMessage } from "./sqs.service";
import { DatabaseService } from "./database.service";
import { DutchAuctionService, DutchAuctionParams } from "./dutch-auction.service";
import { EIP712Utils } from "../utils/eip712.utils";
import { config } from "../config";

export class AuctionService {
  private blockchainService: BlockchainService;
  private sqsService: SQSService;
  private databaseService: DatabaseService;
  private marketPrices: Map<string, string> = new Map(); // Mock price oracle
  
  constructor(blockchainService: BlockchainService, sqsService: SQSService, databaseService: DatabaseService) {
    this.blockchainService = blockchainService;
    this.sqsService = sqsService;
    this.databaseService = databaseService;
    
    // Initialize mock market prices
    // For token pairs, this represents how many dst tokens per src token (with 6 decimals)
    // E.g., "1000000" means 1:1 ratio (1 USDT = 1 DAI)
    this.marketPrices.set("USDT-DAI", "1000000"); // 1:1 for stablecoins
    this.marketPrices.set("DAI-USDT", "1000000");
    this.marketPrices.set("USDC-DAI", "1000000");
    this.marketPrices.set("DAI-USDC", "1000000");
    
    // For cross-chain pairs, add the token addresses as keys
    // These are mock token addresses from deployments
    this.marketPrices.set("0x8465d8d2c0a3228ddbfa8b0c495cd14d2dbee8ac-0xcc14100211626d4d6fc8751fb62c16a7d5be502f", "1000000"); // ETH USDT to Base USDT
    this.marketPrices.set("0xcc14100211626d4d6fc8751fb62c16a7d5be502f-0x8465d8d2c0a3228ddbfa8b0c495cd14d2dbee8ac", "1000000"); // Base USDT to ETH USDT
    
    // Start background task to check expired orders and rescue opportunities
    setInterval(() => this.checkExpiredOrders(), 10000); // Every 10 seconds
    
    // Start background task to clean up old orders (once per day)
    setInterval(() => this.cleanupOldOrders(), 24 * 60 * 60 * 1000); // Every 24 hours
  }
  
  async createOrder(swapRequest: SwapRequest, signature: string, secret: string): Promise<OrderData> {
    // Convert SwapRequest to HTLCOrder format for EIP-712
    const htlcOrder = EIP712Utils.createHTLCOrder(
      swapRequest.userAddress,
      swapRequest.srcChainId,
      swapRequest.srcToken,
      swapRequest.srcAmount,
      swapRequest.dstChainId,
      swapRequest.dstToken,
      swapRequest.secretHash,
      swapRequest.minAcceptablePrice,
      swapRequest.orderDuration
    );
    
    // Verify EIP-712 signature
    const verifyingContract = config.chains[swapRequest.srcChainId]?.escrowFactory || ethers.ZeroAddress;
    const isValidSignature = EIP712Utils.verifySignature(
      htlcOrder,
      signature,
      swapRequest.userAddress,
      swapRequest.srcChainId,
      verifyingContract
    );
    
    if (!isValidSignature) {
      throw new Error("Invalid EIP-712 signature");
    }
    
    // Generate order ID from EIP-712 hash
    const domain = EIP712Utils.getDomain(swapRequest.srcChainId, verifyingContract);
    const orderId = EIP712Utils.getOrderHash(htlcOrder, domain);
    
    console.log(`[Order] Verified EIP-712 signature for order ${orderId}`);
    
    // Verify secret hash matches
    const secretBytes32 = ethers.encodeBytes32String(secret);
    const computedHash = ethers.keccak256(secretBytes32);
    
    if (computedHash !== swapRequest.secretHash) {
      console.error(`[Order] Secret hash mismatch! Expected: ${swapRequest.secretHash}, Got: ${computedHash}`);
      throw new Error("Secret hash mismatch");
    }
    
    // Store secret securely in database
    await this.databaseService.saveSecret(orderId, swapRequest.secretHash, secret);
    
    // Step 1 Verification: Check user has approved UniteEscrowFactory
    const escrowFactory = config.chains[swapRequest.srcChainId]?.escrowFactory;
    if (!escrowFactory) {
      throw new Error(`No escrow factory configured for chain ${swapRequest.srcChainId}`);
    }
    
    const approvedAmount = await this.blockchainService.checkAllowance(
      swapRequest.srcChainId,
      swapRequest.srcToken,
      swapRequest.userAddress,
      escrowFactory
    );
    
    if (BigInt(approvedAmount) < BigInt(swapRequest.srcAmount)) {
      throw new Error("Insufficient allowance. User must approve UniteEscrowFactory first (Step 1).");
    }
    
    console.log(`[Order] User has approved ${approvedAmount} tokens to UniteEscrowFactory`);
    
    // Get current market price
    const pairKey = `${swapRequest.srcToken}-${swapRequest.dstToken}`;
    const marketPrice = this.marketPrices.get(pairKey) || swapRequest.minAcceptablePrice;
    
    // Calculate Dutch auction parameters using the pricing service
    // Use shorter auction duration (60s) for faster testing, while keeping order duration at 300s
    const auctionDurationSeconds = 60; // Fast auction for testing
    const auctionParams = DutchAuctionService.createAuctionParams(
      swapRequest.minAcceptablePrice,
      marketPrice,
      auctionDurationSeconds
    );
    
    // Extract values for backward compatibility
    const auctionStartPrice = auctionParams.startPrice;
    const auctionEndPrice = auctionParams.endPrice;
    const auctionDuration = auctionParams.duration;
    
    // Create order data
    const orderData: OrderData = {
      orderId,
      swapRequest,
      marketPrice,
      status: "active",
      createdAt: Date.now(),
      expiresAt: Date.now() + (swapRequest.orderDuration * 1000),
      auctionStartPrice,
      auctionEndPrice,
      auctionDuration
    };
    
    console.log(`[Order] Created order ${orderId}`);
    console.log(`[Order] Market price: ${marketPrice}`);
    console.log(`[Order] Signature: ${signature.substring(0, 10)}...`);
    
    // Store order in database
    await this.databaseService.saveOrder(orderData);
    
    // Step 3: Broadcast to resolvers with secret hash only (not the secret)
    await this.broadcastOrderToResolvers(orderData);
    
    return orderData;
  }

  async createOrderFromHTLC(htlcOrder: HTLCOrder, signature: string, secret: string): Promise<OrderData> {
    console.log(`[Order] Creating order from signed HTLCOrder`);
    console.log(`[Order] HTLCOrder nonce: ${htlcOrder.nonce}, deadline: ${htlcOrder.deadline}`);
    
    // Verify EIP-712 signature using the exact signed HTLCOrder
    const verifyingContract = config.chains[htlcOrder.srcChainId]?.escrowFactory || ethers.ZeroAddress;
    const isValidSignature = EIP712Utils.verifySignature(
      htlcOrder,
      signature,
      htlcOrder.userAddress,
      htlcOrder.srcChainId,
      verifyingContract
    );
    
    if (!isValidSignature) {
      throw new Error("Invalid EIP-712 signature");
    }
    
    // Generate order ID from EIP-712 hash using the exact signed order
    const domain = EIP712Utils.getDomain(htlcOrder.srcChainId, verifyingContract);
    const orderId = EIP712Utils.getOrderHash(htlcOrder, domain);
    
    console.log(`[Order] Verified EIP-712 signature for order ${orderId}`);
    
    // Verify secret hash matches
    const secretBytes32 = ethers.encodeBytes32String(secret);
    const computedHash = ethers.keccak256(secretBytes32);
    
    if (computedHash !== htlcOrder.secretHash) {
      console.error(`[Order] Secret hash mismatch! Expected: ${htlcOrder.secretHash}, Got: ${computedHash}`);
      throw new Error("Secret hash mismatch");
    }
    
    // Store secret securely in database
    await this.databaseService.saveSecret(orderId, htlcOrder.secretHash, secret);
    
    // Step 1 Verification: Check user has approved UniteEscrowFactory
    const escrowFactory = config.chains[htlcOrder.srcChainId]?.escrowFactory;
    if (!escrowFactory) {
      throw new Error(`No escrow factory configured for chain ${htlcOrder.srcChainId}`);
    }
    
    const approvedAmount = await this.blockchainService.checkAllowance(
      htlcOrder.srcChainId,
      htlcOrder.srcToken,
      htlcOrder.userAddress,
      escrowFactory
    );
    
    if (BigInt(approvedAmount) < BigInt(htlcOrder.srcAmount)) {
      throw new Error("Insufficient allowance. User must approve UniteEscrowFactory first (Step 1).");
    }
    
    console.log(`[Order] User has approved ${approvedAmount} tokens to UniteEscrowFactory`);
    
    // Get current market price
    const pairKey = `${htlcOrder.srcToken}-${htlcOrder.dstToken}`;
    const marketPrice = this.marketPrices.get(pairKey) || htlcOrder.minAcceptablePrice;
    
    // Calculate Dutch auction parameters using the pricing service
    // Use shorter auction duration (60s) for faster testing, while keeping order duration at 300s
    const auctionDurationSeconds = 60; // Fast auction for testing
    const auctionParams = DutchAuctionService.createAuctionParams(
      htlcOrder.minAcceptablePrice,
      marketPrice,
      auctionDurationSeconds
    );
    
    // Extract values for backward compatibility
    const auctionStartPrice = auctionParams.startPrice;
    const auctionEndPrice = auctionParams.endPrice;
    const auctionDuration = auctionParams.duration;
    
    // Convert HTLCOrder to SwapRequest for backward compatibility with existing code
    const swapRequest: SwapRequest = {
      userAddress: htlcOrder.userAddress,
      signature: signature,
      srcChainId: htlcOrder.srcChainId,
      srcToken: htlcOrder.srcToken,
      srcAmount: htlcOrder.srcAmount,
      dstChainId: htlcOrder.dstChainId,
      dstToken: htlcOrder.dstToken,
      secretHash: htlcOrder.secretHash,
      minAcceptablePrice: htlcOrder.minAcceptablePrice,
      orderDuration: htlcOrder.orderDuration
    };
    
    // Create order data
    const orderData: OrderData = {
      orderId,
      swapRequest,
      marketPrice,
      status: "active",
      createdAt: Date.now(),
      expiresAt: Date.now() + (htlcOrder.orderDuration * 1000),
      auctionStartPrice,
      auctionEndPrice,
      auctionDuration
    };
    
    console.log(`[Order] Created order ${orderId} from signed HTLC`);
    console.log(`[Order] Market price: ${marketPrice}`);
    console.log(`[Order] Signature: ${signature.substring(0, 10)}...`);
    
    // Store order in database
    await this.databaseService.saveOrder(orderData);
    
    // Step 3: Broadcast to resolvers with secret hash only (not the secret)
    await this.broadcastOrderToResolvers(orderData);
    
    return orderData;
  }
  
  async createOrderFromSDK(
    orderData: any,
    orderHash: string,
    extension: string,
    signature: string,
    secret: string,
    htlcOrder: HTLCOrder
  ): Promise<OrderData> {
    console.log(`[Order] Creating order from SDK format`);
    console.log(`[Order] Order hash: ${orderHash}`);
    console.log(`[Order] Extension length: ${extension.length}`);
    
    // Verify the signature against the SDK order
    const recoveredAddress = ethers.recoverAddress(orderHash, signature);
    
    if (recoveredAddress.toLowerCase() !== htlcOrder.userAddress.toLowerCase()) {
      console.error(`[Order] Signature verification failed. Expected: ${htlcOrder.userAddress}, Got: ${recoveredAddress}`);
      throw new Error("Invalid SDK order signature");
    }
    
    console.log(`[Order] Verified SDK order signature from ${recoveredAddress}`);
    
    // Use the provided order hash as the order ID
    const orderId = orderHash;
    
    // Verify secret hash matches
    const secretBytes32 = ethers.encodeBytes32String(secret);
    const computedHash = ethers.keccak256(secretBytes32);
    
    if (computedHash !== htlcOrder.secretHash) {
      console.error(`[Order] Secret hash mismatch! Expected: ${htlcOrder.secretHash}, Got: ${computedHash}`);
      throw new Error("Secret hash mismatch");
    }
    
    // Store secret securely in database
    await this.databaseService.saveSecret(orderId, htlcOrder.secretHash, secret);
    
    // Step 1 Verification: Check user has approved UniteEscrowFactory
    const escrowFactory = config.chains[htlcOrder.srcChainId]?.escrowFactory;
    if (!escrowFactory) {
      throw new Error(`No escrow factory configured for chain ${htlcOrder.srcChainId}`);
    }
    
    const approvedAmount = await this.blockchainService.checkAllowance(
      htlcOrder.srcChainId,
      htlcOrder.srcToken,
      htlcOrder.userAddress,
      escrowFactory
    );
    
    if (BigInt(approvedAmount) < BigInt(htlcOrder.srcAmount)) {
      throw new Error("Insufficient allowance. User must approve UniteEscrowFactory first (Step 1).");
    }
    
    console.log(`[Order] User has approved ${approvedAmount} tokens to UniteEscrowFactory`);
    
    // Get current market price
    const pairKey = `${htlcOrder.srcToken}-${htlcOrder.dstToken}`;
    const marketPrice = this.marketPrices.get(pairKey) || htlcOrder.minAcceptablePrice;
    
    // Calculate Dutch auction parameters
    const auctionDurationSeconds = 60; // Fast auction for testing
    const auctionParams = DutchAuctionService.createAuctionParams(
      htlcOrder.minAcceptablePrice,
      marketPrice,
      auctionDurationSeconds
    );
    
    // Convert HTLCOrder to SwapRequest for backward compatibility
    const swapRequest: SwapRequest = {
      userAddress: htlcOrder.userAddress,
      signature: signature,
      srcChainId: htlcOrder.srcChainId,
      srcToken: htlcOrder.srcToken,
      srcAmount: htlcOrder.srcAmount,
      dstChainId: htlcOrder.dstChainId,
      dstToken: htlcOrder.dstToken,
      secretHash: htlcOrder.secretHash,
      minAcceptablePrice: htlcOrder.minAcceptablePrice,
      orderDuration: htlcOrder.orderDuration
    };
    
    // Create order data with SDK-specific fields
    const orderDataObject: OrderData = {
      orderId,
      swapRequest,
      marketPrice,
      status: "active",
      createdAt: Date.now(),
      expiresAt: Date.now() + (htlcOrder.orderDuration * 1000),
      auctionStartPrice: auctionParams.startPrice,
      auctionEndPrice: auctionParams.endPrice,
      auctionDuration: auctionParams.duration,
      // Store SDK-specific data
      sdkOrder: {
        orderData,
        extension,
        orderHash
      }
    };
    
    console.log(`[Order] Created SDK order ${orderId}`);
    console.log(`[Order] Market price: ${marketPrice}`);
    
    // Store order in database
    await this.databaseService.saveOrder(orderDataObject);
    
    // Store SDK order data for resolvers
    await this.databaseService.saveSDKOrderData(orderId, orderData, extension);
    
    // Broadcast to resolvers
    await this.broadcastOrderToResolvers(orderDataObject);
    
    return orderDataObject;
  }
  
  private async broadcastOrderToResolvers(order: OrderData) {
    console.log(`[Order] Broadcasting order ${order.orderId} to resolvers`);
    console.log(`[Order] Broadcast details:`, {
      orderId: order.orderId,
      srcChain: order.swapRequest.srcChainId,
      dstChain: order.swapRequest.dstChainId,
      srcToken: order.swapRequest.srcToken,
      dstToken: order.swapRequest.dstToken,
      srcAmount: order.swapRequest.srcAmount,
      marketPrice: order.marketPrice,
      secretHash: order.swapRequest.secretHash,
      userAddress: order.swapRequest.userAddress,
      expiresAt: order.expiresAt
    });
    
    // Convert prices from internal format (with 6 decimals) to human-readable format
    // E.g., "1016500" -> "1.0165" (using ethers formatUnits)
    const startPriceFormatted = ethers.formatUnits(order.auctionStartPrice, 6);
    const endPriceFormatted = ethers.formatUnits(order.auctionEndPrice, 6);
    
    console.log(`[Order] Auction prices - Start: ${startPriceFormatted}, End: ${endPriceFormatted}`);
    
    // For now, hardcode common token decimals
    // TODO: Fetch these dynamically from blockchain
    const getTokenDecimals = (address: string, chainId: number): number => {
      // MockERC20 (USDT) has 6 decimals
      const usdtAddresses = [
        '0x8465d8d2c0a3228ddbfa8b0c495cd14d2dbee8ac', // ETH Sepolia
        '0xcc14100211626d4d6fc8751fb62c16a7d5be502f', // Base Sepolia
        '0x15203c110ea8f48ac4216af44c6690a378993540', // Arbitrum Sepolia
        '0x1efa70cebaee4a28e3338ed7d316a28ce6e1d4f9', // Monad Testnet
      ];
      
      // MockERC20_2 (DAI) has 18 decimals
      const daiAddresses = [
        '0x0da822fd04de975b2918ed62b11e9b85460b92ca', // ETH Sepolia
        '0x4888dc936f9b9e398fd3b63ab2a6906f5caec795', // Base Sepolia
        '0xa0db2578292a24714c8c905556ebbebb962152c5', // Arbitrum Sepolia
        '0x9fdb806b9a7fa4bf00483af2898ae16ef01f5960', // Monad Testnet
      ];
      
      if (usdtAddresses.includes(address.toLowerCase())) {
        return 6;
      }
      if (daiAddresses.includes(address.toLowerCase())) {
        return 18;
      }
      
      // Default to 18 for unknown tokens
      return 18;
    };
    
    const srcDecimals = getTokenDecimals(order.swapRequest.srcToken, order.swapRequest.srcChainId);
    const dstDecimals = getTokenDecimals(order.swapRequest.dstToken, order.swapRequest.dstChainId);
    
    // Broadcast order to SQS for resolvers to consume
    try {
      await this.sqsService.broadcastOrder(
        order.orderId,
        order,
        startPriceFormatted,
        endPriceFormatted,
        order.auctionDuration,
        srcDecimals,
        dstDecimals
      );
      console.log(`[Order] Successfully broadcasted order ${order.orderId} to SQS`);
    } catch (error) {
      console.error(`[Order] Failed to broadcast order ${order.orderId} to SQS:`, error);
      throw error;
    }
  }
  
  async commitResolver(commitment: ResolverCommitment): Promise<{ success: boolean; currentPrice?: string; expectedDstAmount?: string }> {
    const order = await this.databaseService.getOrder(commitment.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "active") {
      throw new Error("Order already committed or completed");
    }
    
    // Validate resolver's accepted price against current auction price
    const auctionParams: DutchAuctionParams = {
      startPrice: order.auctionStartPrice,
      endPrice: order.auctionEndPrice,
      startTime: order.createdAt,
      duration: order.auctionDuration
    };
    
    const validation = DutchAuctionService.validateResolverPrice(
      auctionParams,
      commitment.acceptedPrice,
      Date.now()
    );
    
    if (!validation.valid) {
      throw new Error(`Invalid price: ${validation.reason}`);
    }
    
    // Calculate the exact amounts based on accepted price
    // For stablecoins, assume 6 decimals (USDT, USDC, DAI)
    const tokenAmounts = DutchAuctionService.calculateTokenAmounts(
      order.swapRequest.srcAmount,
      6, // src token decimals
      6, // dst token decimals
      commitment.acceptedPrice
    );
    
    // Update order with resolver commitment
    order.status = "committed";
    order.resolver = commitment.resolverAddress;
    order.committedPrice = commitment.acceptedPrice;
    order.commitmentTime = Date.now();
    order.commitmentDeadline = Date.now() + 5 * 60 * 1000; // 5 minutes
    
    // Save to database
    await this.databaseService.saveOrder(order);
    
    // Save resolver commitment for audit trail
    await this.databaseService.saveResolverCommitment(commitment);
    
    console.log(`[Order] Resolver ${commitment.resolverAddress} committed to order ${commitment.orderId}`);
    console.log(`[Order] Accepted price: ${DutchAuctionService.formatPrice(commitment.acceptedPrice)}`);
    console.log(`[Order] User will receive: ${tokenAmounts.makerAmount} dst tokens`);
    console.log(`[Order] 5-minute timer started. Deadline: ${new Date(order.commitmentDeadline).toISOString()}`);
    
    return { 
      success: true,
      currentPrice: commitment.acceptedPrice,
      expectedDstAmount: tokenAmounts.makerAmount
    };
  }
  
  async escrowsReady(notification: EscrowReadyNotification): Promise<void> {
    const order = await this.databaseService.getOrder(notification.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "committed") {
      throw new Error("Order not in committed state");
    }
    
    if (order.resolver !== notification.resolverAddress) {
      throw new Error("Unauthorized resolver");
    }
    
    // Verify escrows are deployed with safety deposits
    const srcEscrowValid = await this.blockchainService.verifyEscrowWithDeposit(
      order.swapRequest.srcChainId,
      notification.srcEscrowAddress,
      notification.srcSafetyDepositTx
    );
    
    const dstEscrowValid = await this.blockchainService.verifyEscrowWithDeposit(
      order.swapRequest.dstChainId,
      notification.dstEscrowAddress,
      notification.dstSafetyDepositTx
    );
    
    if (!srcEscrowValid || !dstEscrowValid) {
      throw new Error("Invalid escrow deployment or safety deposits");
    }
    
    // Update order with escrow addresses
    order.srcEscrowAddress = notification.srcEscrowAddress;
    order.dstEscrowAddress = notification.dstEscrowAddress;
    
    // Save to database
    await this.databaseService.saveOrder(order);
    
    console.log(`[Order] Escrows ready for order ${notification.orderId}`);
    
    // Start user funds transfer
    await this.moveUserFunds(notification.orderId);
  }
  
  async moveUserFunds(orderId: string): Promise<string> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (!order.srcEscrowAddress) {
      throw new Error("Source escrow not set");
    }
    
    // Step 7: Relayer transfers user's pre-approved funds to source escrow via UniteEscrowFactory
    console.log(`[Order] Step 7: Moving user funds to source escrow for order ${orderId}`);
    
    const txHash = await this.blockchainService.transferUserFundsToEscrow(
      order.swapRequest.srcChainId,
      order.swapRequest.userAddress,
      order.swapRequest.srcToken,
      order.swapRequest.srcAmount,
      orderId
    );
    
    order.status = "settling";
    order.userFundsMoved = true;
    order.userFundsMovedAt = Date.now();
    if (!order.settlementTx) {
      order.settlementTx = {};
    }
    order.settlementTx.srcChainTxHash = txHash;
    
    // Save to database
    await this.databaseService.saveOrder(order);
    
    console.log(`[Order] Step 7 Complete: User funds moved to escrow for order ${orderId}`);
    
    return txHash;
  }
  
  async notifySettlement(notification: SettlementNotification): Promise<void> {
    const order = await this.databaseService.getOrder(notification.orderId);
    if (!order) {
      throw new Error("Order not found");
    }
    
    if (order.status !== "settling") {
      throw new Error("Order not in settling state");
    }
    
    if (order.resolver !== notification.resolverAddress) {
      throw new Error("Unauthorized resolver");
    }
    
    console.log(`[Order] Step 8: Verifying both escrows are funded for order ${notification.orderId}`);
    
    // NEW: Verify both source and destination escrows have the correct funds
    const fundVerification = await this.blockchainService.verifyBothEscrowsFunded(
      order.swapRequest.srcChainId,
      order.swapRequest.dstChainId,
      order.srcEscrowAddress!,
      order.dstEscrowAddress!,
      order.swapRequest.srcToken,
      order.swapRequest.dstToken,
      order.swapRequest.srcAmount,
      notification.dstTokenAmount
    );
    
    if (!fundVerification.srcFunded || !fundVerification.dstFunded) {
      throw new Error(`Fund verification failed - src: ${fundVerification.srcFunded}, dst: ${fundVerification.dstFunded}`);
    }
    
    console.log(`[Order] ✅ Both escrows verified with correct funds`);
    
    // Store destination transaction
    if (!order.settlementTx) {
      order.settlementTx = {};
    }
    order.settlementTx.dstChainTxHash = notification.dstTxHash;
    
    // Save to database
    await this.databaseService.saveOrder(order);
    
    console.log(`[Order] Resolver notified settlement for order ${notification.orderId}`);
    
    // NEW: Instead of immediate finalization, publish to competitive SecretsQueue
    await this.publishSecretForCompetition(notification.orderId);
  }

  private async publishSecretForCompetition(orderId: string): Promise<void> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order) {
      throw new Error("Order not found");
    }

    // Get the secret from database
    const secret = await this.databaseService.getSecret(orderId);
    if (!secret) {
      throw new Error("Secret not found");
    }

    // Wait additional delay for safety (like before)
    console.log(`[Order] Waiting ${config.order.secretRevealDelay}s before starting competition`);
    await new Promise(resolve => setTimeout(resolve, config.order.secretRevealDelay * 1000));

    // Set competition deadline (5 minutes from now)
    const competitionDeadline = Date.now() + (5 * 60 * 1000); // 5 minutes

    // Create secret message for competitive resolution
    const secretMessage = {
      orderId: order.orderId,
      secret: secret,
      resolverAddress: order.resolver!,
      srcEscrowAddress: order.srcEscrowAddress!,
      dstEscrowAddress: order.dstEscrowAddress!,
      srcChainId: order.swapRequest.srcChainId,
      dstChainId: order.swapRequest.dstChainId,
      srcAmount: order.swapRequest.srcAmount,
      dstAmount: order.settlementTx?.dstTokenAmount || order.swapRequest.srcAmount, // fallback to srcAmount
      timestamp: Date.now(),
      competitionDeadline: competitionDeadline
    };

    // Update order status to indicate competition has started
    order.status = "competing";
    order.competitionStarted = Date.now();
    order.competitionDeadline = competitionDeadline;
    
    // Save to database
    await this.databaseService.saveOrder(order);

    // Publish to SecretsQueue for all resolvers to compete
    await this.sqsService.broadcastSecret(secretMessage);

    console.log(`[Order] 🏁 Competition started for order ${orderId}`);
    console.log(`[Order] Competition deadline: ${new Date(competitionDeadline).toISOString()}`);
    console.log(`[Order] Original resolver ${order.resolver} has 5 minutes to complete`);
    console.log(`[Order] Other resolvers can rescue after deadline for safety deposit rewards`);
  }
  
  private async finalizeSettlement(orderId: string): Promise<void> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order || !order.settlementTx) {
      return;
    }
    
    try {
      console.log(`[Order] Step 9: Finalizing settlement for order ${orderId}`);
      
      // Wait for confirmations on both chains
      console.log(`[Order] Waiting for confirmations on both chains`);
      
      const [srcReceipt, dstReceipt] = await Promise.all([
        this.blockchainService.waitForConfirmations(
          order.swapRequest.srcChainId,
          order.settlementTx.srcChainTxHash!
        ),
        this.blockchainService.waitForConfirmations(
          order.swapRequest.dstChainId,
          order.settlementTx.dstChainTxHash!
        )
      ]);
      
      if (!srcReceipt || !dstReceipt) {
        throw new Error("Failed to get transaction receipts");
      }
      
      console.log(`[Order] Both transactions confirmed`);
      
      // Wait additional delay for safety
      console.log(`[Order] Waiting ${config.order.secretRevealDelay}s before revealing secret`);
      await new Promise(resolve => setTimeout(resolve, config.order.secretRevealDelay * 1000));
      
      // Step 9: Relayer reveals secret on destination chain
      // This unlocks funds for user and returns safety deposit to resolver
      const secret = await this.databaseService.getSecret(orderId);
      if (!secret) {
        throw new Error("Secret not found");
      }
      
      console.log(`[Order] Step 9a: Revealing secret on destination chain to unlock user funds`);
      const revealTxHash = await this.blockchainService.revealSecretOnDestination(
        order.swapRequest.dstChainId,
        order.dstEscrowAddress!,
        secret
      );
      
      console.log(`[Order] Step 9b: Secret revealed on destination chain: ${revealTxHash}`);
      console.log(`[Order] Step 9c: User can now withdraw funds on destination chain`);
      console.log(`[Order] Step 9d: Resolver safety deposit returned on destination chain`);
      
      // Update order status
      order.status = "completed";
      order.secretRevealedAt = Date.now();
      order.secretRevealTxHash = revealTxHash;
      
      // Save to database
      await this.databaseService.saveOrder(order);
      
      // Mark secret as revealed
      await this.databaseService.markSecretRevealed(orderId);
      
      // Update resolver commitment status
      if (order.resolver) {
        await this.databaseService.updateCommitmentStatus(orderId, order.resolver, "completed");
      }
      
      console.log(`[Order] Step 9 Complete: Secret revealed, user and resolver can now claim funds`);
      console.log(`[Order] Step 10: Resolver can now use the same secret to withdraw from source chain`);
      
      console.log(`[Order] Order ${orderId} completed successfully!`);
      
    } catch (error) {
      console.error(`[Order] Error in Step 9 (finalizing settlement) for ${orderId}:`, error);
      order.status = "failed";
      await this.databaseService.saveOrder(order);
      
      // Update resolver commitment status if applicable
      if (order.resolver) {
        await this.databaseService.updateCommitmentStatus(orderId, order.resolver, "failed");
      }
    }
  }
  
  private async checkExpiredOrders(): Promise<void> {
    const now = Date.now();
    
    // Check expired active orders
    const expiredOrders = await this.databaseService.getExpiredOrders(now);
    for (const order of expiredOrders) {
      console.log(`[Order] Order ${order.orderId} expired`);
      order.status = "failed";
      await this.databaseService.saveOrder(order);
    }
    
    // Check orders with expired commitments
    const expiredCommitments = await this.databaseService.getOrdersWithExpiredCommitments(now);
    for (const order of expiredCommitments) {
      console.log(`[Order] Resolver failed to complete order ${order.orderId} in 5-minute window`);
      order.status = "rescue_available";
      await this.databaseService.saveOrder(order);
      
      // Order is now available for any resolver to rescue
      await this.broadcastRescueOpportunity(order);
    }
    
    // Check orders pending secret reveal
    const pendingReveal = await this.databaseService.getOrdersPendingSecretReveal(now);
    for (const order of pendingReveal) {
      console.log(`[Order] Auto-revealing secret for order ${order.orderId} due to timeout`);
      await this.finalizeSettlement(order.orderId);
    }
  }
  
  private async broadcastRescueOpportunity(order: OrderData): Promise<void> {
    console.log(`[Order] Broadcasting rescue opportunity for order ${order.orderId}`);
    console.log(`[Order] Original resolver ${order.resolver} forfeits safety deposits`);
    console.log(`[Order] Rescue details:`, {
      orderId: order.orderId,
      originalResolver: order.resolver,
      srcEscrowAddress: order.srcEscrowAddress,
      dstEscrowAddress: order.dstEscrowAddress,
      userFundsMoved: order.userFundsMoved,
      rescueReward: "Original resolver's safety deposits",
      timeRemaining: order.expiresAt - Date.now()
    });
    
    // Any resolver can now complete this order and claim the original resolver's safety deposits
    // The rescue resolver will:
    // 1. Deploy their own escrows with safety deposits
    // 2. Complete the trade normally
    // 3. Claim the failed resolver's safety deposits as reward
    // 4. The relayer will reveal the secret to unlock user funds
  }
  
  async getOrder(orderId: string): Promise<OrderData | null> {
    return await this.databaseService.getOrder(orderId);
  }
  
  async getOrderStatus(orderId: string): Promise<any> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order) return null;
    
    return {
      orderId: order.orderId,
      status: order.status,
      userFundsMoved: order.userFundsMoved || false,
      resolver: order.resolver,
      srcEscrowAddress: order.srcEscrowAddress,
      dstEscrowAddress: order.dstEscrowAddress,
      committedPrice: order.committedPrice,
      commitmentDeadline: order.commitmentDeadline
    };
  }
  
  async getAllActiveOrders(): Promise<OrderData[]> {
    return await this.databaseService.getAllActiveOrders();
  }
  
  async getRevealedSecretInfo(orderId: string): Promise<{ revealTxHash: string; revealedAt: number } | null> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order || order.status !== "completed" || !order.secretRevealTxHash) {
      return null;
    }
    
    return {
      revealTxHash: order.secretRevealTxHash,
      revealedAt: order.secretRevealedAt || 0
    };
  }
  
  /**
   * Get current price and details for an active order's Dutch auction
   */
  async getCurrentAuctionPrice(orderId: string): Promise<any> {
    const order = await this.databaseService.getOrder(orderId);
    if (!order || order.status !== "active") {
      return null;
    }
    
    const auctionParams: DutchAuctionParams = {
      startPrice: order.auctionStartPrice,
      endPrice: order.auctionEndPrice,
      startTime: order.createdAt,
      duration: order.auctionDuration
    };
    
    const priceCalc = DutchAuctionService.getFullPriceCalculation(
      auctionParams,
      order.swapRequest.srcAmount,
      6, // src token decimals
      6, // dst token decimals
      Date.now()
    );
    
    const timeRemaining = DutchAuctionService.getTimeRemaining(auctionParams);
    
    return {
      orderId: order.orderId,
      currentPrice: priceCalc.currentPrice,
      formattedPrice: DutchAuctionService.formatPrice(priceCalc.currentPrice),
      makerAmount: priceCalc.makerAmount,
      takerAmount: priceCalc.takerAmount,
      priceImprovement: priceCalc.priceImprovement,
      timeElapsed: priceCalc.timeElapsed,
      timeRemaining,
      isExpired: priceCalc.isExpired,
      auctionParams: {
        startPrice: order.auctionStartPrice,
        endPrice: order.auctionEndPrice,
        duration: order.auctionDuration
      }
    };
  }
  
  // Database statistics
  async getOrderStats(): Promise<any> {
    return await this.databaseService.getOrderStats();
  }
  
  async getResolverStats(resolverAddress: string): Promise<any> {
    return await this.databaseService.getResolverStats(resolverAddress);
  }
  
  // Cleanup old orders
  private async cleanupOldOrders(): Promise<void> {
    try {
      const deletedCount = await this.databaseService.cleanupOldOrders(30); // Keep 30 days
      console.log(`[Order] Cleanup completed: ${deletedCount} old orders removed`);
    } catch (error) {
      console.error("[Order] Error during cleanup:", error);
    }
  }
}