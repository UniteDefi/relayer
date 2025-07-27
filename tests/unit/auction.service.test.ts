import { AuctionService } from '../../src/services/auction.service';
import { SwapRequest } from '../../src/types';

describe('AuctionService', () => {
  let auctionService: AuctionService;

  beforeEach(() => {
    auctionService = new AuctionService();
  });

  describe('createAuction', () => {
    it('should create an auction with valid swap request', async () => {
      const swapRequest: SwapRequest = {
        userAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f7B83e',
        srcChainId: 84532,
        srcToken: '0x0000000000000000000000000000000000000001',
        srcAmount: '1000000',
        dstChainId: 421614,
        dstToken: '0x0000000000000000000000000000000000000002',
        secretHash: '0x' + '0'.repeat(64),
        startPrice: '1100000',
        endPrice: '900000',
        auctionDuration: 300,
        signature: '0x' + '0'.repeat(130)
      };

      const secret = '0x' + '1'.repeat(64);
      
      const result = await auctionService.createAuction(swapRequest, secret);
      
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.status).toBe('active');
      expect(result.swapRequest).toEqual(swapRequest);
    });

    it('should validate swap request parameters', async () => {
      const invalidRequest = {} as SwapRequest;
      const secret = '0x' + '1'.repeat(64);
      
      await expect(
        auctionService.createAuction(invalidRequest, secret)
      ).rejects.toThrow();
    });
  });

  describe('getActiveAuctions', () => {
    it('should return only active auctions', () => {
      const activeAuctions = auctionService.getActiveAuctions();
      
      expect(Array.isArray(activeAuctions)).toBe(true);
      activeAuctions.forEach(auction => {
        expect(auction.status).toBe('active');
      });
    });
  });
});