// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

contract AXPFounderVesting is VestingWallet {
    uint64 public constant CLIFF_SECONDS = 365 days;
    uint64 public constant VESTING_SECONDS = 4 * 365 days;

    constructor(address founder, uint64 startTimestamp)
        VestingWallet(founder, startTimestamp + CLIFF_SECONDS, VESTING_SECONDS - CLIFF_SECONDS)
    {}
}
