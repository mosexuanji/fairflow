// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {IssuanceMath} from "../IssuanceMath.sol";

/// @dev Local differential-test entry point; it holds no state or issuance authority.
contract MathHarness {
    function cumulative(uint256 credits, uint256 band, uint256 qFirst) external pure returns (uint256) {
        return IssuanceMath.cumulative(credits, band, qFirst);
    }
}
