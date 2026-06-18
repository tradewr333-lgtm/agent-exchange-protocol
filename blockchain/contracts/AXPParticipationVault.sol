// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AXPParticipationVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant OFFICIAL_BSC_WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;

    IERC20 public immutable axp;
    IERC20 public wbnb;
    address public proceedsWallet;
    bool public acceptsNativeBNB;
    uint256 public axpPerBNB;
    uint256 public minBNBDeposit;
    uint256 public maxBNBPerWallet;
    uint256 public totalSold;
    uint256 public saleOpensAt;
    uint256 public saleClosesAt;

    mapping(address => uint256) public contributedBNBEquivalent;

    event Purchase(address indexed buyer, address indexed paymentToken, uint256 paymentAmount, uint256 axpAmount);
    event SaleWindowUpdated(uint256 opensAt, uint256 closesAt);
    event TermsUpdated(
        address indexed wbnb,
        bool acceptsNativeBNB,
        uint256 axpPerBNB,
        uint256 minBNBDeposit,
        uint256 maxBNBPerWallet,
        address proceedsWallet
    );
    event RescueProceeds(address indexed token, address indexed to, uint256 amount);

    constructor(
        IERC20 axpToken,
        address initialOwner,
        address proceedsWallet_,
        IERC20 wbnb_,
        bool acceptsNativeBNB_,
        uint256 axpPerBNB_,
        uint256 minBNBDeposit_,
        uint256 maxBNBPerWallet_
    ) Ownable(initialOwner) Pausable() {
        require(address(axpToken) != address(0), "AXPVault: token required");
        axp = axpToken;
        _setTerms(wbnb_, acceptsNativeBNB_, axpPerBNB_, minBNBDeposit_, maxBNBPerWallet_, proceedsWallet_);
        _pause();
    }

    function buyWithBNB() external payable nonReentrant whenNotPaused {
        require(acceptsNativeBNB, "AXPVault: native BNB disabled");
        require(block.timestamp >= saleOpensAt, "AXPVault: sale not open");
        require(saleClosesAt == 0 || block.timestamp <= saleClosesAt, "AXPVault: sale closed");
        require(msg.value > 0, "AXPVault: BNB required");
        require(msg.value >= minBNBDeposit, "AXPVault: below minimum deposit");
        require(contributedBNBEquivalent[msg.sender] + msg.value <= maxBNBPerWallet, "AXPVault: wallet cap exceeded");

        uint256 axpAmount = (msg.value * axpPerBNB) / 1 ether;
        require(axp.balanceOf(address(this)) >= axpAmount, "AXPVault: insufficient AXP");

        contributedBNBEquivalent[msg.sender] += msg.value;
        totalSold += axpAmount;
        axp.safeTransfer(msg.sender, axpAmount);

        (bool ok,) = proceedsWallet.call{value: msg.value}("");
        require(ok, "AXPVault: BNB transfer failed");
        emit Purchase(msg.sender, address(0), msg.value, axpAmount);
    }

    function buyWithWBNB(uint256 wbnbAmount) external nonReentrant whenNotPaused {
        require(address(wbnb) != address(0), "AXPVault: WBNB disabled");
        require(block.timestamp >= saleOpensAt, "AXPVault: sale not open");
        require(saleClosesAt == 0 || block.timestamp <= saleClosesAt, "AXPVault: sale closed");
        require(wbnbAmount >= minBNBDeposit, "AXPVault: below minimum deposit");
        require(contributedBNBEquivalent[msg.sender] + wbnbAmount <= maxBNBPerWallet, "AXPVault: wallet cap exceeded");

        uint256 axpAmount = (wbnbAmount * axpPerBNB) / 1 ether;
        require(axp.balanceOf(address(this)) >= axpAmount, "AXPVault: insufficient AXP");

        contributedBNBEquivalent[msg.sender] += wbnbAmount;
        totalSold += axpAmount;
        wbnb.safeTransferFrom(msg.sender, proceedsWallet, wbnbAmount);
        axp.safeTransfer(msg.sender, axpAmount);
        emit Purchase(msg.sender, address(wbnb), wbnbAmount, axpAmount);
    }

    function setSaleWindow(uint256 opensAt, uint256 closesAt) external onlyOwner {
        require(closesAt == 0 || closesAt > opensAt, "AXPVault: invalid window");
        saleOpensAt = opensAt;
        saleClosesAt = closesAt;
        emit SaleWindowUpdated(opensAt, closesAt);
    }

    function setTerms(
        IERC20 wbnb_,
        bool acceptsNativeBNB_,
        uint256 axpPerBNB_,
        uint256 minBNBDeposit_,
        uint256 maxBNBPerWallet_,
        address proceedsWallet_
    ) external onlyOwner {
        _setTerms(wbnb_, acceptsNativeBNB_, axpPerBNB_, minBNBDeposit_, maxBNBPerWallet_, proceedsWallet_);
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

    function rescueWBNB(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "AXPVault: recipient required");
        require(address(wbnb) != address(0), "AXPVault: WBNB disabled");
        wbnb.safeTransfer(to, amount);
        emit RescueProceeds(address(wbnb), to, amount);
    }

    function recoverUnsoldAXP(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "AXPVault: recipient required");
        axp.safeTransfer(to, amount);
    }

    function _setTerms(
        IERC20 wbnb_,
        bool acceptsNativeBNB_,
        uint256 axpPerBNB_,
        uint256 minBNBDeposit_,
        uint256 maxBNBPerWallet_,
        address proceedsWallet_
    ) internal {
        require(acceptsNativeBNB_ || address(wbnb_) == OFFICIAL_BSC_WBNB, "AXPVault: BNB or official WBNB required");
        require(address(wbnb_) == address(0) || address(wbnb_) == OFFICIAL_BSC_WBNB, "AXPVault: unofficial WBNB");
        require(axpPerBNB_ > 0, "AXPVault: rate required");
        require(minBNBDeposit_ >= 0.01 ether, "AXPVault: minimum too low");
        require(maxBNBPerWallet_ >= minBNBDeposit_, "AXPVault: invalid wallet cap");
        require(proceedsWallet_ != address(0), "AXPVault: proceeds required");
        wbnb = wbnb_;
        acceptsNativeBNB = acceptsNativeBNB_;
        axpPerBNB = axpPerBNB_;
        minBNBDeposit = minBNBDeposit_;
        maxBNBPerWallet = maxBNBPerWallet_;
        proceedsWallet = proceedsWallet_;
        emit TermsUpdated(
            address(wbnb_),
            acceptsNativeBNB_,
            axpPerBNB_,
            minBNBDeposit_,
            maxBNBPerWallet_,
            proceedsWallet_
        );
    }
}
