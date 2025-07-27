import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

// Transaction log
const txLog: any[] = [];

async function main() {
  console.log("\n🌐 === Cross-Chain Token Swap Demo (Simplified) ===");
  console.log("Swapping 5 LINK (Ethereum) for USDT (Base)\n");

  // Load deployments
  const deployments = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "crosschain_deployments.json"), "utf8")
  );

  // Setup providers
  const ethProvider = new ethers.JsonRpcProvider(
    `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const baseProvider = new ethers.JsonRpcProvider(
    `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );

  // Setup wallets
  const seller = new ethers.Wallet(process.env.SELLER_WALLET_PRIVATE_KEY!, ethProvider);
  const resolver = new ethers.Wallet(process.env.RESOLVER1_WALLET_PRIVATE_KEY!, baseProvider);

  console.log("👥 Participants:");
  console.log(`  Seller: ${seller.address}`);
  console.log(`  Resolver: ${resolver.address}\n`);

  // Load ABIs
  const auctionAbi = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "dist/contracts/CrossChainTokenAuction.sol/CrossChainTokenAuction.json"),
      "utf8"
    )
  ).abi;

  const tokenAbi = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "dist/contracts/MockToken.sol/MockToken.json"),
      "utf8"
    )
  ).abi;

  // Contract instances
  const ethAuction = new ethers.Contract(
    deployments.ethereum_sepolia.auctionContract,
    auctionAbi,
    seller
  );
  const baseAuction = new ethers.Contract(
    deployments.base_sepolia.auctionContract,
    auctionAbi,
    resolver
  );
  const ethLink = new ethers.Contract(
    deployments.ethereum_sepolia.mockLINK,
    tokenAbi,
    seller
  );
  const baseUsdt = new ethers.Contract(
    deployments.base_sepolia.mockUSDT,
    tokenAbi,
    resolver
  );

  // Check initial balances
  console.log("💰 Initial Balances:");
  const sellerLinkStart = await ethLink.balanceOf(seller.address);
  const sellerUsdtStart = await baseUsdt.connect(baseProvider).balanceOf(seller.address);
  const resolverLinkStart = await ethLink.connect(ethProvider).balanceOf(resolver.address);
  const resolverUsdtStart = await baseUsdt.balanceOf(resolver.address);
  
  console.log(`  Seller: ${ethers.formatEther(sellerLinkStart)} LINK, ${ethers.formatUnits(sellerUsdtStart, 6)} USDT`);
  console.log(`  Resolver: ${ethers.formatEther(resolverLinkStart)} LINK, ${ethers.formatUnits(resolverUsdtStart, 6)} USDT\n`);

  // Step 1: Create auction on Ethereum
  console.log("📝 Step 1: Creating cross-chain auction on Ethereum");
  
  // Generate HTLC
  const secret = ethers.randomBytes(32);
  const hashlock = ethers.keccak256(secret);
  const auctionId = ethers.randomBytes(32);
  
  console.log(`  Secret: ${ethers.hexlify(secret).slice(0, 20)}...`);
  console.log(`  Hashlock: ${hashlock.slice(0, 20)}...`);
  console.log(`  Auction ID: ${ethers.hexlify(auctionId).slice(0, 20)}...\n`);

  // Approve LINK
  const approveTx = await ethLink.approve(ethAuction.target, ethers.parseEther("5"));
  await approveTx.wait();
  txLog.push({ chain: "Ethereum", type: "Approve", hash: approveTx.hash });

  // Create auction
  const createTx = await ethAuction.createCrossChainAuction(
    auctionId,
    ethLink.target,
    ethers.parseEther("5"), // 5 LINK
    84532, // Base chain ID
    deployments.base_sepolia.mockUSDT,
    ethers.parseUnits("54", 6), // Start: 54 USDT
    ethers.parseUnits("50", 6), // End: 50 USDT  
    60, // 60 seconds
    hashlock
  );
  await createTx.wait();
  txLog.push({ chain: "Ethereum", type: "CreateAuction", hash: createTx.hash });
  
  console.log(`✅ Auction created on Ethereum: ${createTx.hash}`);
  console.log("  - Selling: 5 LINK");
  console.log("  - For: 50-54 USDT on Base");
  console.log("  - Duration: 60 seconds\n");

  // Step 2: Check auction details
  console.log("🔍 Step 2: Checking auction on both chains");
  
  const ethAuctionDetails = await ethAuction.getAuction(auctionId);
  console.log(`  Ethereum - Active: ${ethAuctionDetails[7]}`);
  console.log(`  Current price: ${ethers.formatUnits(ethAuctionDetails[6], 6)} USDT\n`);

  // Step 3: Create matching auction on Base for filling
  console.log("🔄 Step 3: Creating matching auction on Base for cross-chain settlement");
  
  // First, the resolver needs to create the same auction on Base
  // In a real system, this would be done by a relayer or oracle
  const createBaseTx = await baseAuction.createCrossChainAuction(
    auctionId,
    deployments.ethereum_sepolia.mockLINK, // Source token on Ethereum
    ethers.parseEther("5"), // 5 LINK
    11155111, // Ethereum chain ID
    baseUsdt.target, // Dest token on Base
    ethers.parseUnits("54", 6), // Same start price
    ethers.parseUnits("50", 6), // Same end price
    60, // Same duration
    hashlock // Same hashlock
  );
  await createBaseTx.wait();
  txLog.push({ chain: "Base", type: "CreateMatchingAuction", hash: createBaseTx.hash });
  
  console.log("  ✅ Matching auction created on Base\n");
  
  // Step 4: Resolver fills on Base
  console.log("💰 Step 4: Resolver filling auction on Base");
  
  // Wait 10 seconds for price to drop
  console.log("  Waiting 10 seconds for better price...");
  await new Promise(r => setTimeout(r, 10000));
  
  const currentPrice = await baseAuction.getCurrentPrice(auctionId);
  console.log(`  Current price: ${ethers.formatUnits(currentPrice, 6)} USDT`);
  
  // Approve USDT on Base
  const approveUsdtTx = await baseUsdt.approve(baseAuction.target, currentPrice);
  await approveUsdtTx.wait();
  txLog.push({ chain: "Base", type: "Approve USDT", hash: approveUsdtTx.hash });
  
  // Fill auction on Base
  const fillTx = await baseAuction.fillAuction(auctionId);
  await fillTx.wait();
  txLog.push({ chain: "Base", type: "FillAuction", hash: fillTx.hash });
  
  console.log(`✅ Auction filled on Base: ${fillTx.hash}\n`);

  // Step 5: Seller reveals secret on Base
  console.log("🔓 Step 5: Seller revealing secret on Base");
  
  const sellerBase = seller.connect(baseProvider);
  const baseAuctionSeller = baseAuction.connect(sellerBase);
  
  const revealTx = await baseAuctionSeller.revealSecret(auctionId, secret);
  await revealTx.wait();
  txLog.push({ chain: "Base", type: "RevealSecret", hash: revealTx.hash });
  
  console.log(`✅ Secret revealed! Seller received USDT\n`);

  // Step 6: Resolver claims on Ethereum
  console.log("📦 Step 6: Resolver claiming LINK on Ethereum");
  
  const resolverEth = resolver.connect(ethProvider);
  const ethAuctionResolver = ethAuction.connect(resolverEth);
  
  const claimTx = await ethAuctionResolver.claimWithSecret(auctionId, secret);
  await claimTx.wait();
  txLog.push({ chain: "Ethereum", type: "ClaimTokens", hash: claimTx.hash });
  
  console.log(`✅ Tokens claimed on Ethereum!\n`);

  // Final balances
  console.log("💰 Final Balances:");
  const sellerLinkEnd = await ethLink.balanceOf(seller.address);
  const sellerUsdtEnd = await baseUsdt.connect(baseProvider).balanceOf(seller.address);
  const resolverLinkEnd = await ethLink.connect(ethProvider).balanceOf(resolver.address);
  const resolverUsdtEnd = await baseUsdt.balanceOf(resolver.address);
  
  console.log(`  Seller: ${ethers.formatEther(sellerLinkEnd)} LINK (-${ethers.formatEther(sellerLinkStart - sellerLinkEnd)}), ${ethers.formatUnits(sellerUsdtEnd, 6)} USDT (+${ethers.formatUnits(sellerUsdtEnd - sellerUsdtStart, 6)})`);
  console.log(`  Resolver: ${ethers.formatEther(resolverLinkEnd)} LINK (+${ethers.formatEther(resolverLinkEnd - resolverLinkStart)}), ${ethers.formatUnits(resolverUsdtEnd, 6)} USDT (-${ethers.formatUnits(resolverUsdtStart - resolverUsdtEnd, 6)})\n`);

  // Transaction report
  console.log("========== CROSS-CHAIN TRANSACTION REPORT ==========\n");
  console.log("📋 Transaction Log:");
  txLog.forEach((tx, i) => {
    console.log(`${i + 1}. [${tx.chain}] ${tx.type}: ${tx.hash}`);
  });

  console.log("\n✅ Cross-Chain Swap Complete!");
  console.log("\n📝 Summary:");
  console.log(`  - Seller swapped 5 LINK on Ethereum for ${ethers.formatUnits(currentPrice, 6)} USDT on Base`);
  console.log("  - Dutch auction provided price discovery");
  console.log("  - HTLC ensured atomic settlement across chains");
  console.log("  - No ETH required for the swap!");
}

main().catch(console.error);