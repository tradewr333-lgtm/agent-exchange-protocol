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
    IERC20 public paymentToken;
    address public proceedsWallet;
    bool public acceptsNativeBNB;
    uint256 public axpPerPaymentToken;
    uint256 public maxPaymentPerWallet;
    uint256 public totalSold;
    uint256 public saleOpensAt;
    uint256 public saleClosesAt;

    mapping(address => uint256) public contributedPayment;

    event Purchase(address indexed buyer, address indexed paymentToken, uint256 paymentAmount, uint256 axpAmount);
    event SaleWindowUpdated(uint256 opensAt, uint256 closesAt);
    event TermsUpdated(
        address indexed paymentToken,
        bool acceptsNativeBNB,
        uint256 axpPerPaymentToken,
        uint256 maxPaymentPerWallet,
        address proceedsWallet
    );
    event RescueProceeds(address indexed token, address indexed to, uint256 amount);

    constructor(
        IERC20 axpToken,
        address initialOwner,
        address proceedsWallet_,
        IERC20 paymentToken_,
        bool acceptsNativeBNB_,
        uint256 axpPerPaymentToken_,
        uint256 maxPaymentPerWallet_
    ) Ownable(initialOwner) Pausable() {
        require(address(axpToken) != address(0), "AXPVault: token required");
        axp = axpToken;
        _setTerms(paymentToken_, acceptsNativeBNB_, axpPerPaymentToken_, maxPaymentPerWallet_, proceedsWallet_);
        _pause();
    }

    function buyWithBNB() external payable nonReentrant whenNotPaused {
        require(acceptsNativeBNB, "AXPVault: native BNB disabled");
        require(block.timestamp >= saleOpensAt, "AXPVault: sale not open");
        require(saleClosesAt == 0 || block.timestamp <= saleClosesAt, "AXPVault: sale closed");
        require(msg.value > 0, "AXPVault: BNB required");
        require(contributedPayment[msg.sender] + msg.value <= maxPaymentPerWallet, "AXPVault: wallet cap exceeded");

        uint256 axpAmount = (msg.value * axpPerPaymentToken) / 1 ether;
        require(axp.balanceOf(address(this)) >= axpAmount, "AXPVault: insufficient AXP");

        contributedPayment[msg.sender] += msg.value;
        totalSold += axpAmount;
        axp.safeTransfer(msg.sender, axpAmount);

        (bool ok,) = proceedsWallet.call{value: msg.value}("");
        require(ok, "AXPVault: BNB transfer failed");
        emit Purchase(msg.sender, address(0), msg.value, axpAmount);
    }

    function buyWithPaymentToken(uint256 paymentAmount) external nonReentrant whenNotPaused {
        require(address(paymentToken) != address(0), "AXPVault: payment token disabled");
        require(block.timestamp >= saleOpensAt, "AXPVault: sale not open");
        require(saleClosesAt == 0 || block.timestamp <= saleClosesAt, "AXPVault: sale closed");
        require(paymentAmount > 0, "AXPVault: payment required");
        require(contributedPayment[msg.sender] + paymentAmount <= maxPaymentPerWallet, "AXPVault: wallet cap exceeded");

        uint256 axpAmount = (paymentAmount * axpPerPaymentToken) / 1 ether;
        require(axp.balanceOf(address(this)) >= axpAmount, "AXPVault: insufficient AXP");

        contributedPayment[msg.sender] += paymentAmount;
        totalSold += axpAmount;
        paymentToken.safeTransferFrom(msg.sender, proceedsWallet, paymentAmount);
        axp.safeTransfer(msg.sender, axpAmount);
        emit Purchase(msg.sender, address(paymentToken), paymentAmount, axpAmount);
    }

    function setSaleWindow(uint256 opensAt, uint256 closesAt) external onlyOwner {
        require(closesAt == 0 || closesAt > opensAt, "AXPVault: invalid window");
        saleOpensAt = opensAt;
        saleClosesAt = closesAt;
        emit SaleWindowUpdated(opensAt, closesAt);
    }

    function setTerms(
        IERC20 paymentToken_,
        bool acceptsNativeBNB_,
        uint256 axpPerPaymentToken_,
        uint256 maxPaymentPerWallet_,
        address proceedsWallet_
    ) external onlyOwner {
        _setTerms(paymentToken_, acceptsNativeBNB_, axpPerPaymentToken_, maxPaymentPerWallet_, proceedsWallet_);
    }

    function openSale() external onlyOwner {
        _unpause();
    }

    function pauseSale() external onlyOwner {
        _pause();
    }

    function rescueBNB(address to) external onlyOwner nonReentrant {
        require(to != address(0), "AXPVault: recipient required");
        uint256 amount = address(this).balance;
        require(amount > 0, "AXPVault: no BNB");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "AXPVault: withdraw failed");
        emit RescueProceeds(address(0), to, amount);
    }

    function rescuePaymentToken(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "AXPVault: recipient required");
        require(address(paymentToken) != address(0), "AXPVault: payment token disabled");
        paymentToken.safeTransfer(to, amount);
        emit RescueProceeds(address(paymentToken), to, amount);
    }

    function recoverUnsoldAXP(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "AXPVault: recipient required");
        axp.safeTransfer(to, amount);
    }

    function _setTerms(
        IERC20 paymentToken_,
        bool acceptsNativeBNB_,
        uint256 axpPerPaymentToken_,
        uint256 maxPaymentPerWallet_,
        address proceedsWallet_
    ) internal {
        require(acceptsNativeBNB_ || address(paymentToken_) != address(0), "AXPVault: payment method required");
        require(axpPerPaymentToken_ > 0, "AXPVault: rate required");
        require(maxPaymentPerWallet_ > 0, "AXPVault: wallet cap required");
        require(proceedsWallet_ != address(0), "AXPVault: proceeds required");
        paymentToken = paymentToken_;
        acceptsNativeBNB = acceptsNativeBNB_;
        axpPerPaymentToken = axpPerPaymentToken_;
        maxPaymentPerWallet = maxPaymentPerWallet_;
        proceedsWallet = proceedsWallet_;
        emit TermsUpdated(
            address(paymentToken_),
            acceptsNativeBNB_,
            axpPerPaymentToken_,
            maxPaymentPerWallet_,
            proceedsWallet_
        );
    }
}
