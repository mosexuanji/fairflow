// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Integer cumulative issuance for the candidate marginally decreasing schedule.
/// @dev Credits and qFirst use the same fixed credit unit; band uses token atoms.
/// These representation bounds are arithmetic guards, not an economic supply cap.
library IssuanceMath {
    uint256 internal constant MAX_CREDITS = type(uint128).max;
    uint256 internal constant MAX_BAND = type(uint96).max;
    uint256 internal constant MAX_Q_FIRST = type(uint64).max;

    error CreditsOutOfRange(uint256 credits);
    error BandOutOfRange(uint256 band);
    error QFirstOutOfRange(uint256 qFirst);

    /// @return Issued token atoms, floored once at the cumulative function.
    /// @dev Matches REFERENCE_MODEL.py exactly within the explicitly supported domain.
    /// Math.sqrt uses a fixed number of Newton steps; cost does not grow by stage count.
    function cumulative(uint256 credits, uint256 band, uint256 qFirst) internal pure returns (uint256) {
        if (credits > MAX_CREDITS) revert CreditsOutOfRange(credits);
        if (band == 0 || band > MAX_BAND) revert BandOutOfRange(band);
        if (qFirst == 0 || qFirst > MAX_Q_FIRST) revert QFirstOutOfRange(qFirst);

        uint256 completed = (Math.sqrt(1 + 8 * (credits / qFirst)) - 1) / 2;
        uint256 next = completed + 1;
        uint256 threshold = qFirst * completed * next / 2;
        uint256 denominator = qFirst * next;

        // credits < 2^128 implies completed and next < 2^65. Therefore the
        // threshold product is < 2^194, denominator < 2^129, and band*completed
        // < 2^161. The fractional term is < band, so the sum is also < 2^161.
        return band * completed + Math.mulDiv(credits - threshold, band, denominator);
    }
}
