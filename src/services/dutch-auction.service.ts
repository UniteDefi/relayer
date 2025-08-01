import { ethers } from "ethers";

export interface DutchAuctionParams {
  startPrice: string;  // Worst price for user (minimum acceptable)
  endPrice: string;    // Best price for user (market price)
  startTime: number;   // Auction start timestamp
  duration: number;    // Auction duration in seconds
}

export interface PriceCalculation {
  currentPrice: string;          // Current price at this moment
  makerAmount: string;           // Amount user receives (dst tokens)
  takerAmount: string;           // Amount user pays (src tokens)
  priceImprovement: number;      // Percentage improvement from start price
  timeElapsed: number;           // Seconds since auction started
  isExpired: boolean;            // Whether auction has expired
}

export class DutchAuctionService {
  private static readonly PRICE_DECIMALS = 6; // Standard decimals for price representation
  
  /**
   * Creates Dutch auction parameters from order details
   * @param minAcceptablePrice Minimum price user will accept (worst price)
   * @param marketPrice Current market price (best price)
   * @param duration Auction duration in seconds
   */
  static createAuctionParams(
    minAcceptablePrice: string,
    marketPrice: string,
    duration: number
  ): DutchAuctionParams {
    // Validate inputs
    if (BigInt(minAcceptablePrice) <= 0) {
      throw new Error("Minimum acceptable price must be positive");
    }
    if (BigInt(marketPrice) <= 0) {
      throw new Error("Market price must be positive");
    }
    if (duration <= 0) {
      throw new Error("Auction duration must be positive");
    }
    
    // In a Dutch auction for cross-chain swaps:
    // - Start ABOVE market price (e.g., 102 DAI for 100 USDT) to incentivize resolvers
    // - End at minimum acceptable price (e.g., 95 DAI for 100 USDT)
    // This gives resolvers profit opportunity that decreases over time
    
    const marketPriceBig = BigInt(marketPrice);
    const minPriceBig = BigInt(minAcceptablePrice);
    
    // Start at 2% above market price or 107% of min price, whichever is higher
    const marketBasedStart = (marketPriceBig * BigInt(102)) / BigInt(100);
    const minBasedStart = (minPriceBig * BigInt(107)) / BigInt(100);
    const startPriceBig = marketBasedStart > minBasedStart ? marketBasedStart : minBasedStart;
    
    return {
      startPrice: startPriceBig.toString(),
      endPrice: minAcceptablePrice,
      startTime: Date.now(),
      duration: duration
    };
  }
  
  /**
   * Calculates the current price in a Dutch auction
   * Price linearly decreases from start (high) to end (min acceptable) over duration
   * @param params Dutch auction parameters
   * @param timestamp Current timestamp (defaults to now)
   */
  static calculateCurrentPrice(
    params: DutchAuctionParams,
    timestamp: number = Date.now()
  ): PriceCalculation {
    const timeElapsed = Math.floor((timestamp - params.startTime) / 1000); // in seconds
    const isExpired = timeElapsed >= params.duration;
    
    // If auction expired, use end price (best price for user)
    if (isExpired) {
      return {
        currentPrice: params.endPrice,
        makerAmount: "0", // Will be calculated based on specific order
        takerAmount: "0", // Will be calculated based on specific order
        priceImprovement: 100, // 100% improvement (at best price)
        timeElapsed: params.duration,
        isExpired: true
      };
    }
    
    // Calculate linear interpolation
    const startPriceBig = BigInt(params.startPrice);
    const endPriceBig = BigInt(params.endPrice);
    
    // Handle edge case where prices are equal
    if (startPriceBig === endPriceBig) {
      return {
        currentPrice: params.startPrice,
        makerAmount: "0",
        takerAmount: "0",
        priceImprovement: 0,
        timeElapsed,
        isExpired: false
      };
    }
    
    // Linear interpolation: price = start + (end - start) * (elapsed / duration)
    const priceDiff = endPriceBig - startPriceBig;
    // Use higher precision for progress calculation
    const progressNumerator = BigInt(timeElapsed) * BigInt(1000000); // Use 6 decimals for precision
    const progressDenominator = BigInt(params.duration);
    const priceChange = (priceDiff * progressNumerator) / (progressDenominator * BigInt(1000000));
    const currentPriceBig = startPriceBig + priceChange;
    
    // Calculate price improvement percentage
    let priceImprovement = 0;
    if (startPriceBig > endPriceBig) {
      // Price is decreasing (improving for buyer)
      priceImprovement = Number((startPriceBig - currentPriceBig) * BigInt(10000) / startPriceBig) / 100;
    } else {
      // Price is increasing (improving for seller)
      priceImprovement = Number((currentPriceBig - startPriceBig) * BigInt(10000) / startPriceBig) / 100;
    }
    
    return {
      currentPrice: currentPriceBig.toString(),
      makerAmount: "0",
      takerAmount: "0",
      priceImprovement,
      timeElapsed,
      isExpired: false
    };
  }
  
  /**
   * Calculates exact token amounts based on current auction price
   * @param srcAmount Amount of source tokens
   * @param srcDecimals Decimals of source token
   * @param dstDecimals Decimals of destination token
   * @param currentPrice Current price (dst tokens per src token with PRICE_DECIMALS decimals)
   */
  static calculateTokenAmounts(
    srcAmount: string,
    srcDecimals: number,
    dstDecimals: number,
    currentPrice: string
  ): { makerAmount: string; takerAmount: string } {
    // Price is expressed as: dstAmount = srcAmount * price / 10^PRICE_DECIMALS
    const srcAmountBig = BigInt(srcAmount);
    const priceBig = BigInt(currentPrice);
    
    // Adjust for decimals difference
    const decimalAdjustment = dstDecimals - srcDecimals;
    let dstAmountBig: bigint;
    
    if (decimalAdjustment >= 0) {
      // Destination has more or equal decimals
      dstAmountBig = (srcAmountBig * priceBig * BigInt(10 ** decimalAdjustment)) / BigInt(10 ** this.PRICE_DECIMALS);
    } else {
      // Source has more decimals
      dstAmountBig = (srcAmountBig * priceBig) / (BigInt(10 ** Math.abs(decimalAdjustment)) * BigInt(10 ** this.PRICE_DECIMALS));
    }
    
    return {
      makerAmount: dstAmountBig.toString(), // User receives (dst tokens)
      takerAmount: srcAmount                 // User pays (src tokens)
    };
  }
  
  /**
   * Gets the full price calculation including token amounts
   * @param params Dutch auction parameters
   * @param srcAmount Source token amount
   * @param srcDecimals Source token decimals
   * @param dstDecimals Destination token decimals
   * @param timestamp Current timestamp (defaults to now)
   */
  static getFullPriceCalculation(
    params: DutchAuctionParams,
    srcAmount: string,
    srcDecimals: number,
    dstDecimals: number,
    timestamp: number = Date.now()
  ): PriceCalculation {
    const priceCalc = this.calculateCurrentPrice(params, timestamp);
    const amounts = this.calculateTokenAmounts(
      srcAmount,
      srcDecimals,
      dstDecimals,
      priceCalc.currentPrice
    );
    
    return {
      ...priceCalc,
      makerAmount: amounts.makerAmount,
      takerAmount: amounts.takerAmount
    };
  }
  
  /**
   * Validates that a resolver's accepted price is valid for the current auction state
   * @param params Dutch auction parameters
   * @param acceptedPrice Price the resolver is accepting
   * @param timestamp Current timestamp
   */
  static validateResolverPrice(
    params: DutchAuctionParams,
    acceptedPrice: string,
    timestamp: number = Date.now()
  ): { valid: boolean; reason?: string } {
    const currentCalc = this.calculateCurrentPrice(params, timestamp);
    
    if (currentCalc.isExpired) {
      return { valid: false, reason: "Auction has expired" };
    }
    
    const acceptedBig = BigInt(acceptedPrice);
    const currentBig = BigInt(currentCalc.currentPrice);
    const startBig = BigInt(params.startPrice);
    const endBig = BigInt(params.endPrice);
    
    // Accepted price should be at or better than current auction price
    if (startBig > endBig) {
      // Price is decreasing (buyer's auction)
      if (acceptedBig > currentBig) {
        return { valid: false, reason: "Accepted price is worse than current auction price" };
      }
    } else {
      // Price is increasing (seller's auction)
      if (acceptedBig < currentBig) {
        return { valid: false, reason: "Accepted price is worse than current auction price" };
      }
    }
    
    // Validate price is within auction bounds
    const minPrice = startBig < endBig ? startBig : endBig;
    const maxPrice = startBig > endBig ? startBig : endBig;
    
    if (acceptedBig < minPrice || acceptedBig > maxPrice) {
      return { valid: false, reason: "Accepted price is outside auction bounds" };
    }
    
    return { valid: true };
  }
  
  /**
   * Calculates the time remaining in the auction
   * @param params Dutch auction parameters
   * @param timestamp Current timestamp
   */
  static getTimeRemaining(
    params: DutchAuctionParams,
    timestamp: number = Date.now()
  ): number {
    const elapsed = Math.floor((timestamp - params.startTime) / 1000);
    const remaining = Math.max(0, params.duration - elapsed);
    return remaining;
  }
  
  /**
   * Formats price for display (converts from internal representation)
   * @param price Price with PRICE_DECIMALS decimals
   * @param displayDecimals Number of decimals to show
   */
  static formatPrice(price: string, displayDecimals: number = 2): string {
    const priceBig = BigInt(price);
    const divisor = BigInt(10 ** (this.PRICE_DECIMALS - displayDecimals));
    const formatted = priceBig / divisor;
    
    const integerPart = formatted / BigInt(10 ** displayDecimals);
    const decimalPart = formatted % BigInt(10 ** displayDecimals);
    
    return `${integerPart}.${decimalPart.toString().padStart(displayDecimals, "0")}`;
  }
}