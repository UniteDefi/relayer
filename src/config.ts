import dotenv from "dotenv";
import { ChainConfig } from "./types";
import { loadDeployments } from "./utils/deployment-loader";

dotenv.config();

// Load deployment addresses
const deployments = loadDeployments();

export const config = {
  port: process.env.RELAYER_PORT || 3000,
  
  // Private key for relayer operations
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY!,
  
  // Chain configurations with deployed addresses
  chains: {
    84532: {
      chainId: 84532,
      name: "Base Sepolia",
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || deployments[84532]?.rpcUrl || "https://sepolia.base.org",
      escrowFactory: deployments[84532]?.contracts.uniteEscrowFactory.address || "0x4567890123456789012345678901234567890123",
      confirmations: 2
    },
    421614: {
      chainId: 421614,
      name: "Arbitrum Sepolia",
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || deployments[421614]?.rpcUrl || "https://sepolia-rollup.arbitrum.io/rpc",
      escrowFactory: deployments[421614]?.contracts.uniteEscrowFactory.address || "0x6a4499e82EeD912e27524e9fCC3a04C6821b885e",
      confirmations: 2
    },
    11155111: {
      chainId: 11155111,
      name: "Ethereum Sepolia",
      rpcUrl: process.env.SEPOLIA_RPC_URL || deployments[11155111]?.rpcUrl || "https://ethereum-sepolia.publicnode.com",
      escrowFactory: deployments[11155111]?.contracts.uniteEscrowFactory.address || "0x1234567890123456789012345678901234567890",
      confirmations: 3
    },
    // Etherlink testnet disabled due to insufficient funds
    // 128123: {
    //   chainId: 128123,
    //   name: "Etherlink Testnet",
    //   rpcUrl: process.env.ETHERLINK_RPC_URL || deployments[128123]?.rpcUrl || "https://rpc.ankr.com/etherlink_testnet",
    //   escrowFactory: deployments[128123]?.contracts.uniteEscrowFactory.address || "0x0000000000000000000000000000000000000000",
    //   confirmations: 2
    // },
    10143: {
      chainId: 10143,
      name: "Monad Testnet",
      rpcUrl: process.env.MONAD_RPC_URL || deployments[10143]?.rpcUrl || "https://testnet-rpc.monad.xyz",
      escrowFactory: deployments[10143]?.contracts.uniteEscrowFactory.address || "0x0000000000000000000000000000000000000000",
      confirmations: 2
    }
  } as Record<number, ChainConfig>,
  
  // Order parameters
  order: {
    defaultDuration: 300, // 5 minutes
    resolverTimeLimit: 300, // 5 minutes to complete after commitment
    minSafetyDeposit: "0.001", // ETH
    secretRevealDelay: 10 // seconds to wait after confirmations
  },
  
  // API settings
  api: {
    maxRequestSize: "10mb",
    corsOrigins: ["http://localhost:3000", "http://localhost:3001"]
  },
  
  // AWS configuration
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
  }
};