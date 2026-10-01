// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Permanent nontransferable record; it is not the tradable project token.
/// @dev The contribution identifier is the token identifier. Metadata is fixed at mint.
contract Receipt is ERC721 {
    address public immutable issuer;
    mapping(uint256 contributionId => string uri) private _uris;

    error InvalidIssuer();
    error IssuerOnly();
    error Soulbound();

    constructor(address issuer_) ERC721("FairFlow Contribution Receipt", "FFR") {
        if (issuer_ == address(0)) revert InvalidIssuer();
        issuer = issuer_;
    }

    /// @dev Uses _mint intentionally: issuance permits contract beneficiaries without callbacks.
    function mint(address beneficiary, uint256 contributionId, string calldata uri) external {
        if (_msgSender() != issuer) revert IssuerOnly();
        _mint(beneficiary, contributionId);
        _uris[contributionId] = uri;
    }

    function tokenURI(uint256 contributionId) public view override returns (string memory) {
        _requireOwned(contributionId);
        return _uris[contributionId];
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// @dev All inherited transfer entry points reach this guard and fail for existing tokens.
    /// Transfers of nonexistent tokens fail ERC721 authorization in super._update instead.
    /// This also forbids internal transfers, burns and reminting an existing identifier.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0) || to == address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
