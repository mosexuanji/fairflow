// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Project token with zero initial supply and a single immutable issuance authority.
/// @dev Issuance policy and recognized credits belong to the issuer, not circulating supply.
contract ProjectToken is ERC20Burnable {
    address public immutable issuer;
    uint256 public totalBurned;

    error InvalidIssuer();
    error IssuerOnly();

    constructor(string memory name_, string memory symbol_, address issuer_) ERC20(name_, symbol_) {
        if (issuer_ == address(0)) revert InvalidIssuer();
        issuer = issuer_;
    }

    function mint(address beneficiary, uint256 amount) external {
        if (_msgSender() != issuer) revert IssuerOnly();
        _mint(beneficiary, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (to == address(0)) totalBurned += amount;
    }
}
