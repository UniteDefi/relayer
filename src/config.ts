import dotenv from "dotenv";
import { ChainConfig } from "./types";

dotenv.config();

export const config = {
  port: process.env.RELAYER_PORT || 3000,
  
  // Private key for relayer operations
  relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY!,
  
  // Chain configurations
  chains: {
    84532: {
      chainId: 84532,
      name: "Base Sepolia",
      rpcUrl: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      escrowFactory: "0xd65eB2D57FfcC321eE5D5Ac7E97C7c162a6159de",
      confirmations: 2
    },
    421614: {
      chainId: 421614,
      name: "Arbitrum Sepolia",
      rpcUrl: `https://arb-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      escrowFactory: "0x6a4499e82EeD912e27524e9fCC3a04C6821b885e", // Will need to deploy
      confirmations: 2
    },
    11155111: {
      chainId: 11155111,
      name: "Ethereum Sepolia",
      rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      escrowFactory: "0xEAb844fcAdb910CBBC631DAdCcd99900242a6868",
      confirmations: 3
    }
  } as Record<number, ChainConfig>,
  
  // Auction parameters
  auction: {
    defaultDuration: 300, // 5 minutes
    resolverTimeLimit: 180, // 3 minutes to complete after commitment
    minSafetyDeposit: "0.001", // ETH
    secretRevealDelay: 10 // seconds to wait after confirmations
  },
  
  // API settings
  api: {
    maxRequestSize: "10mb",
    corsOrigins: ["http://localhost:3000", "http://localhost:3001"]
  }
};