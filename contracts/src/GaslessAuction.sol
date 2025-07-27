// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/**
 * @title Gasless Dutch Auction for Cross-Chain Swaps
 * @notice Posts auctions on-chain without creating escrows
 * @dev Resolvers monitor these auctions and create escrows when committing
 */
contract GaslessAuction {
    struct Auction {
        // User details
        address user;
        bytes32 secretHash;
        
        // Source token details
        address srcToken;
        uint256 srcAmount;
        
        // Destination details
        uint256 dstChainId;
        address dstToken;
        
        // Dutch auction parameters
        uint256 startPrice;    // Starting dst token amount
        uint256 endPrice;      // Ending dst token amount
        uint256 startTime;
        uint256 duration;
        
        // Status
        bool active;
        address committedResolver;
        uint256 commitTime;
    }
    
    mapping(bytes32 => Auction) public auctions;
    
    // Resolver commitment details
    mapping(bytes32 => address) public srcEscrows;
    mapping(bytes32 => address) public dstEscrows;
    
    event AuctionPosted(
        bytes32 indexed auctionId,
        address indexed user,
        address srcToken,
        uint256 srcAmount,
        uint256 dstChainId,
        address dstToken,
        uint256 startPrice,
        uint256 endPrice
    );
    
    event ResolverCommitted(
        bytes32 indexed auctionId,
        address indexed resolver,
        address srcEscrow,
        address dstEscrow,
        uint256 price
    );
    
    error AuctionExists();
    error AuctionNotActive();
    error AuctionExpired();
    error AlreadyCommitted();
    error InvalidDuration();
    error InvalidPriceRange();
    
    /**
     * @notice Post a new auction (called by relayer)
     * @dev No tokens are transferred at this stage
     */
    function postAuction(
        bytes32 auctionId,
        address user,
        bytes32 secretHash,
        address srcToken,
        uint256 srcAmount,
        uint256 dstChainId,
        address dstToken,
        uint256 startPrice,
        uint256 endPrice,
        uint256 duration
    ) external {
        if (auctions[auctionId].active) revert AuctionExists();
        if (duration == 0) revert InvalidDuration();
        if (startPrice <= endPrice) revert InvalidPriceRange();
        
        auctions[auctionId] = Auction({
            user: user,
            secretHash: secretHash,
            srcToken: srcToken,
            srcAmount: srcAmount,
            dstChainId: dstChainId,
            dstToken: dstToken,
            startPrice: startPrice,
            endPrice: endPrice,
            startTime: block.timestamp,
            duration: duration,
            active: true,
            committedResolver: address(0),
            commitTime: 0
        });
        
        emit AuctionPosted(
            auctionId,
            user,
            srcToken,
            srcAmount,
            dstChainId,
            dstToken,
            startPrice,
            endPrice
        );
    }
    
    /**
     * @notice Get current Dutch auction price
     */
    function getCurrentPrice(bytes32 auctionId) public view returns (uint256) {
        Auction memory auction = auctions[auctionId];
        if (!auction.active) revert AuctionNotActive();
        
        uint256 elapsed = block.timestamp - auction.startTime;
        if (elapsed >= auction.duration) {
            return auction.endPrice;
        }
        
        uint256 priceDrop = (auction.startPrice - auction.endPrice) * elapsed / auction.duration;
        return auction.startPrice - priceDrop;
    }
    
    /**
     * @notice Resolver commits to fill the auction
     * @dev Resolver must have already created escrows with safety deposits
     */
    function commitResolver(
        bytes32 auctionId,
        address srcEscrow,
        address dstEscrow
    ) external {
        Auction storage auction = auctions[auctionId];
        if (!auction.active) revert AuctionNotActive();
        if (auction.committedResolver != address(0)) revert AlreadyCommitted();
        if (block.timestamp > auction.startTime + auction.duration) revert AuctionExpired();
        
        auction.committedResolver = msg.sender;
        auction.commitTime = block.timestamp;
        
        srcEscrows[auctionId] = srcEscrow;
        dstEscrows[auctionId] = dstEscrow;
        
        emit ResolverCommitted(
            auctionId,
            msg.sender,
            srcEscrow,
            dstEscrow,
            getCurrentPrice(auctionId)
        );
    }
    
    /**
     * @notice Check if auction is still active
     */
    function isAuctionActive(bytes32 auctionId) external view returns (bool) {
        Auction memory auction = auctions[auctionId];
        return auction.active && 
               block.timestamp <= auction.startTime + auction.duration &&
               auction.committedResolver == address(0);
    }
    
    /**
     * @notice Get auction details
     */
    function getAuction(bytes32 auctionId) external view returns (
        address user,
        bytes32 secretHash,
        address srcToken,
        uint256 srcAmount,
        uint256 dstChainId,
        address dstToken,
        uint256 currentPrice,
        bool isActive,
        address resolver
    ) {
        Auction memory auction = auctions[auctionId];
        return (
            auction.user,
            auction.secretHash,
            auction.srcToken,
            auction.srcAmount,
            auction.dstChainId,
            auction.dstToken,
            auction.active ? getCurrentPrice(auctionId) : 0,
            auction.active && auction.committedResolver == address(0),
            auction.committedResolver
        );
    }
}