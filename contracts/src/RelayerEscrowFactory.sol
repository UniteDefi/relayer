// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EscrowFactory } from "cross-chain-swap/EscrowFactory.sol";
import { IBaseEscrow } from "cross-chain-swap/interfaces/IBaseEscrow.sol";
import { EscrowSrc } from "cross-chain-swap/EscrowSrc.sol";
import { EscrowDst } from "cross-chain-swap/EscrowDst.sol";
import { Address } from "solidity-utils/contracts/libraries/AddressLib.sol";

/**
 * @title Relayer-Enabled Escrow Factory
 * @notice Extends EscrowFactory to support relayer operations
 * @dev Allows authorized relayer to move pre-approved user funds
 */
contract RelayerEscrowFactory is EscrowFactory {
    using SafeERC20 for IERC20;
    
    address public relayer;
    
    // Mapping to track user pre-approvals
    mapping(address => mapping(address => bool)) public userTokenApprovals;
    
    event RelayerSet(address indexed newRelayer);
    event UserFundsMoved(address indexed user, address indexed token, uint256 amount, address escrow);
    
    error UnauthorizedRelayer();
    error InsufficientAllowance();
    
    modifier onlyRelayer() {
        if (msg.sender != relayer) revert UnauthorizedRelayer();
        _;
    }
    
    constructor(
        address _limitOrderProtocol,
        IERC20 _feeToken,
        IERC20 _accessToken,
        address _owner,
        address _relayer,
        uint32 _rescueDelaySrc,
        uint32 _rescueDelayDst
    ) EscrowFactory(_limitOrderProtocol, _feeToken, _accessToken, _owner, _rescueDelaySrc, _rescueDelayDst) {
        relayer = _relayer;
    }
    
    /**
     * @notice Set new relayer address
     * @dev In production, this should have proper access control
     */
    function setRelayer(address newRelayer) external {
        // TODO: Add proper access control
        relayer = newRelayer;
        emit RelayerSet(newRelayer);
    }
    
    /**
     * @notice Move user's pre-approved funds to escrow (only relayer)
     * @param user User who pre-approved tokens
     * @param token Token to transfer
     * @param amount Amount to transfer
     * @param escrow Destination escrow address
     */
    function moveUserFundsToEscrow(
        address user,
        address token,
        uint256 amount,
        address escrow
    ) external onlyRelayer {
        // Check user has sufficient allowance
        uint256 allowance = IERC20(token).allowance(user, address(this));
        if (allowance < amount) revert InsufficientAllowance();
        
        // Transfer from user to escrow
        IERC20(token).safeTransferFrom(user, escrow, amount);
        
        emit UserFundsMoved(user, token, amount, escrow);
    }
    
    /**
     * @notice Create source escrow with safety deposit
     * @dev Resolver creates escrow and deposits safety deposit
     */
    function createSrcEscrowWithDeposit(
        IBaseEscrow.Immutables calldata immutables
    ) external payable {
        // Verify safety deposit is included
        require(msg.value >= immutables.safetyDeposit, "Insufficient safety deposit");
        
        // Deploy escrow using the factory's implementation
        bytes32 salt = keccak256(abi.encode(immutables));
        address escrow = _deployEscrow(salt, msg.value, ESCROW_SRC_IMPLEMENTATION);
        
        // Escrow is deployed as a clone and doesn't need initialization
        // The immutables are used to compute the deterministic address
    }
    
    /**
     * @notice Create destination escrow with resolver's tokens and safety deposit
     * @dev Resolver provides both tokens and safety deposit
     */
    function createDstEscrowWithTokens(
        IBaseEscrow.Immutables calldata immutables,
        uint256 srcCancellationTimestamp
    ) external payable {
        // Verify safety deposit is included
        require(msg.value >= immutables.safetyDeposit, "Insufficient safety deposit");
        
        // Transfer tokens from resolver to this contract first
        IERC20(immutables.token.get()).safeTransferFrom(
            msg.sender,
            address(this),
            immutables.amount
        );
        
        // Deploy escrow using the factory's implementation
        bytes32 salt = keccak256(abi.encode(immutables));
        address escrow = _deployEscrow(salt, msg.value, ESCROW_DST_IMPLEMENTATION);
        
        // Transfer tokens to escrow
        IERC20(immutables.token.get()).safeTransfer(escrow, immutables.amount);
        
        // Escrow is deployed as a clone and doesn't need initialization
        // The immutables are used to compute the deterministic address
    }
}