import { ethers } from "ethers";
import { HTLCOrder, EIP712Domain, EIP712_TYPES } from "../types";

export class EIP712Utils {
  private static readonly DOMAIN_NAME = "HTLC Cross-Chain Swap";
  private static readonly DOMAIN_VERSION = "1";
  
  /**
   * Get the EIP-712 domain for a specific chain
   */
  static getDomain(chainId: number, verifyingContract: string): EIP712Domain {
    return {
      name: this.DOMAIN_NAME,
      version: this.DOMAIN_VERSION,
      chainId,
      verifyingContract
    };
  }
  
  /**
   * Create the EIP-712 typed data structure
   */
  static createTypedData(order: HTLCOrder, domain: EIP712Domain) {
    return {
      types: EIP712_TYPES,
      primaryType: "HTLCOrder",
      domain,
      message: order
    };
  }
  
  /**
   * Verify an EIP-712 signature
   */
  static verifySignature(
    order: HTLCOrder,
    signature: string,
    expectedSigner: string,
    chainId: number,
    verifyingContract: string
  ): boolean {
    try {
      const domain = this.getDomain(chainId, verifyingContract);
      const typedData = this.createTypedData(order, domain);
      
      // Recover the signer
      const recoveredAddress = ethers.verifyTypedData(
        typedData.domain,
        { HTLCOrder: EIP712_TYPES.HTLCOrder },
        order,
        signature
      );
      
      return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
    } catch (error) {
      console.error("[EIP712] Signature verification failed:", error);
      return false;
    }
  }
  
  /**
   * Generate order hash for tracking
   */
  static getOrderHash(order: HTLCOrder, domain: EIP712Domain): string {
    const typedData = this.createTypedData(order, domain);
    
    return ethers.TypedDataEncoder.hash(
      typedData.domain,
      { HTLCOrder: EIP712_TYPES.HTLCOrder },
      order
    );
  }
  
  /**
   * Convert SwapRequest to HTLCOrder format
   */
  static createHTLCOrder(
    userAddress: string,
    srcChainId: number,
    srcToken: string,
    srcAmount: string,
    dstChainId: number,
    dstToken: string,
    secretHash: string,
    minAcceptablePrice: string,
    orderDuration: number,
    nonce?: string,
    deadline?: number
  ): HTLCOrder {
    return {
      userAddress,
      srcChainId,
      srcToken,
      srcAmount,
      dstChainId,
      dstToken,
      secretHash,
      minAcceptablePrice,
      orderDuration,
      nonce: nonce || Date.now().toString(),
      deadline: deadline || Math.floor(Date.now() / 1000) + orderDuration
    };
  }
}