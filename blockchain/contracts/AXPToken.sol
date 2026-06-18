// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AXPToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor(address initialOwner) ERC20("Agent Exchange Protocol", "AXP") Ownable(initialOwner) {
        require(initialOwner != address(0), "AXP: owner required");
        _mint(initialOwner, TOTAL_SUPPLY);
    }
}
