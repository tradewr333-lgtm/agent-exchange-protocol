// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AXPStaking is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    IERC20 public immutable axp;
    address public insurancePool;
    address public arbitrators;
    address public treasury;

    mapping(address => uint256) public staked;
    mapping(address => uint256) public locked;
    mapping(bytes32 => address) public obligationAgent;
    mapping(bytes32 => uint256) public obligationLocked;

    event Staked(address indexed agent, uint256 amount);
    event Unstaked(address indexed agent, uint256 amount);
    event ObligationLocked(bytes32 indexed obligationId, address indexed agent, uint256 amount);
    event ObligationReleased(bytes32 indexed obligationId, address indexed agent, uint256 amount);
    event ObligationSlashed(bytes32 indexed obligationId, address indexed agent, address indexed counterparty, uint256 amount);
    event ProtocolAccountsUpdated(address insurancePool, address arbitrators, address treasury);

    constructor(
        IERC20 axpToken,
        address initialOwner,
        address insurancePool_,
        address arbitrators_,
        address treasury_
    ) Ownable(initialOwner) {
        require(address(axpToken) != address(0), "AXPStaking: token required");
        axp = axpToken;
        _setProtocolAccounts(insurancePool_, arbitrators_, treasury_);
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "AXPStaking: amount required");
        staked[msg.sender] += amount;
        axp.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0, "AXPStaking: amount required");
        require(availableStake(msg.sender) >= amount, "AXPStaking: insufficient free stake");
        staked[msg.sender] -= amount;
        axp.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function lockObligation(bytes32 obligationId, address agent, uint256 amount) external onlyOwner whenNotPaused {
        require(obligationId != bytes32(0), "AXPStaking: obligation id required");
        require(agent != address(0), "AXPStaking: agent required");
        require(amount > 0, "AXPStaking: amount required");
        require(obligationLocked[obligationId] == 0, "AXPStaking: already locked");
        require(availableStake(agent) >= amount, "AXPStaking: insufficient free stake");

        obligationAgent[obligationId] = agent;
        obligationLocked[obligationId] = amount;
        locked[agent] += amount;
        emit ObligationLocked(obligationId, agent, amount);
    }

    function releaseObligation(bytes32 obligationId) external onlyOwner whenNotPaused {
        address agent = obligationAgent[obligationId];
        uint256 amount = obligationLocked[obligationId];
        require(agent != address(0), "AXPStaking: obligation not found");

        locked[agent] -= amount;
        delete obligationAgent[obligationId];
        delete obligationLocked[obligationId];
        emit ObligationReleased(obligationId, agent, amount);
    }

    function slashObligation(bytes32 obligationId, address counterparty, uint256 amount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        address agent = obligationAgent[obligationId];
        uint256 lockedAmount = obligationLocked[obligationId];
        require(agent != address(0), "AXPStaking: obligation not found");
        require(counterparty != address(0), "AXPStaking: counterparty required");
        require(amount > 0 && amount <= lockedAmount, "AXPStaking: invalid slash amount");

        locked[agent] -= lockedAmount;
        staked[agent] -= amount;
        delete obligationAgent[obligationId];
        delete obligationLocked[obligationId];

        axp.safeTransfer(counterparty, (amount * 6_000) / BPS);
        axp.safeTransfer(insurancePool, (amount * 2_000) / BPS);
        axp.safeTransfer(arbitrators, (amount * 1_000) / BPS);
        axp.safeTransfer(treasury, amount - ((amount * 9_000) / BPS));
        emit ObligationSlashed(obligationId, agent, counterparty, amount);
    }

    function availableStake(address agent) public view returns (uint256) {
        return staked[agent] - locked[agent];
    }

    function setProtocolAccounts(address insurancePool_, address arbitrators_, address treasury_) external onlyOwner {
        _setProtocolAccounts(insurancePool_, arbitrators_, treasury_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _setProtocolAccounts(address insurancePool_, address arbitrators_, address treasury_) internal {
        require(insurancePool_ != address(0), "AXPStaking: insurance required");
        require(arbitrators_ != address(0), "AXPStaking: arbitrators required");
        require(treasury_ != address(0), "AXPStaking: treasury required");
        insurancePool = insurancePool_;
        arbitrators = arbitrators_;
        treasury = treasury_;
        emit ProtocolAccountsUpdated(insurancePool_, arbitrators_, treasury_);
    }
}
