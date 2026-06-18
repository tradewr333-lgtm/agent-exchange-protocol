// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AXPParticipationVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable axp;
    address public proceedsWallet;
    uint256 public axpPerBNB;
    uint256 public maxBNBPerWallet;
    uint256 public totalSold;
    uint256 public saleOpensAt;
    uint256 public saleClosesAt;

    mapping(address => uint256) public contributedBNB;

    event Purchase(address indexed buyer, uint256 bnbAmount, uint256 axpAmount);
    event SaleWindowUpdated(uint256 opensAt, uint256 closesAt);
    event TermsUpdated(uint256 axpPerBNB, uint256 maxBNBPerWallet, address proceedsWallet);
    event ProceedsWithdrawn(address indexed to, uint256 amount);

    constructor(
        IERC20 axpToken,
        address initialOwner,
        address proceedsWallet_,
        uint256 axpPerBNB_,
        uint256 maxBNBPerWallet_
    ) Ownable(initialOwner) Pausable() {
        require(address(axpToken) != address(0), "AXPVault: token required");
        axp = axpToken;
        _setTerms(axpPerBNB_, maxBNBPerWallet_, proceedsWallet_);
        _pause();
    }

    function buy() external payable nonReentrant whenNotPaused {
        require(block.timestamp >= saleOpensAt, "AXPVault: sale not open");
        require(saleClosesAt == 0 || block.timestamp <= saleClosesAt, "AXPVault: sale closed");
        require(msg.value > 0, "AXPVault: BNB required");
        require(contributedBNB[msg.sender] + msg.value <= maxBNBPerWallet, "AXPVault: wallet cap exceeded");

        uint256 axpAmount = (msg.value * axpPerBNB) / 1 ether;
        require(axp.balanceOf(address(this)) >= axpAmount, "AXPVault: insufficient AXP");

        contributedBNB[msg.sender] += msg.value;
        totalSold += axpAmount;
        axp.safeTransfer(msg.sender, axpAmount);
        emit Purchase(msg.sender, msg.value, axpAmount);
    }

    function setSaleWindow(uint256 opensAt, uint256 closesAt) external onlyOwner {
        require(closesAt == 0 || closesAt > opensAt, "AXPVault: invalid window");
        saleOpensAt = opensAt;
        saleClosesAt = closesAt;
        emit SaleWindowUpdated(opensAt, closesAt);
    }

    function setTerms(uint256 axpPerBNB_, uint256 maxBNBPerWallet_, address proceedsWallet_) external onlyOwner {
        _setTerms(axpPerBNB_, maxBNBPerWallet_, proceedsWallet_);
    }

    function openSale() external onlyOwner {
        _unpause();
    }

    function pauseSale() external onlyOwner {
        _pause();
    }

    function withdrawProceeds() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        require(amount > 0, "AXPVault: no BNB");
        (bool ok,) = proceedsWallet.call{value: amount}("");
        require(ok, "AXPVault: withdraw failed");
        emit ProceedsWithdrawn(proceedsWallet, amount);
    }

    function recoverUnsoldAXP(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "AXPVault: recipient required");
        axp.safeTransfer(to, amount);
    }

    function _setTerms(uint256 axpPerBNB_, uint256 maxBNBPerWallet_, address proceedsWallet_) internal {
        require(axpPerBNB_ > 0, "AXPVault: rate required");
        require(maxBNBPerWallet_ > 0, "AXPVault: wallet cap required");
        require(proceedsWallet_ != address(0), "AXPVault: proceeds required");
        axpPerBNB = axpPerBNB_;
        maxBNBPerWallet = maxBNBPerWallet_;
        proceedsWallet = proceedsWallet_;
        emit TermsUpdated(axpPerBNB_, maxBNBPerWallet_, proceedsWallet_);
    }
}
