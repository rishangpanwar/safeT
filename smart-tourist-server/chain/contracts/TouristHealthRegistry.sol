// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev ERC-5192 Minimal Soulbound interface (interfaceId 0xb45a3c0e).
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/**
 * @title TouristHealthRegistry
 * @notice Non-transferable digital tourist permits (Soulbound Tokens) that anchor a
 *         hash of each tourist's emergency clinical directives (report §2.2-F).
 *
 *  - tokenId      = uint256(SHA-256(NationalID || Salt))        — computed off-chain
 *  - clinicalHash = SHA-256(BloodGroup || Conditions || Allergies || Contacts || PrivateSalt)
 *
 * Raw medical data is never written on-chain. Transfers and approvals always revert,
 * so permits cannot be sold or shared between people.
 */
contract TouristHealthRegistry is ERC721, Ownable, IERC5192 {
    enum SafetyStatus { Normal, Alert, Danger }

    struct Permit {
        bytes32 clinicalHash;
        uint64 issuedAt;
        uint64 validUntil;
        SafetyStatus status;
    }

    mapping(uint256 => Permit) private _permits;

    event PermitIssued(uint256 indexed tokenId, address indexed soul, bytes32 clinicalHash, uint64 validUntil);
    event ClinicalHashUpdated(uint256 indexed tokenId, bytes32 clinicalHash);
    event SafetyStatusUpdated(uint256 indexed tokenId, SafetyStatus status);
    event PermitRevoked(uint256 indexed tokenId);

    error Soulbound();
    error UnknownPermit(uint256 tokenId);

    constructor() ERC721("Smart Tourist Health Permit", "STHP") Ownable(msg.sender) {}

    // ------------------------------------------------------------------ issuance

    function issuePermit(address soul, uint256 tokenId, bytes32 clinicalHash, uint64 validUntil) external onlyOwner {
        _safeMint(soul, tokenId);
        _permits[tokenId] = Permit(clinicalHash, uint64(block.timestamp), validUntil, SafetyStatus.Normal);
        emit Locked(tokenId);
        emit PermitIssued(tokenId, soul, clinicalHash, validUntil);
    }

    function updateClinicalHash(uint256 tokenId, bytes32 clinicalHash) external onlyOwner {
        _requireOwned(tokenId);
        _permits[tokenId].clinicalHash = clinicalHash;
        emit ClinicalHashUpdated(tokenId, clinicalHash);
    }

    function updateSafetyStatus(uint256 tokenId, SafetyStatus status) external onlyOwner {
        _requireOwned(tokenId);
        _permits[tokenId].status = status;
        emit SafetyStatusUpdated(tokenId, status);
    }

    function revokePermit(uint256 tokenId) external onlyOwner {
        _burn(tokenId);
        delete _permits[tokenId];
        emit PermitRevoked(tokenId);
    }

    // ------------------------------------------------------------------ views

    function permitOf(uint256 tokenId) external view returns (Permit memory) {
        _requireOwned(tokenId);
        return _permits[tokenId];
    }

    /// @notice First-responder check: does the hash sealed in a QR code match the chain, and is the permit live?
    function verifyClinicalHash(uint256 tokenId, bytes32 clinicalHash) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        Permit memory p = _permits[tokenId];
        return p.clinicalHash == clinicalHash && block.timestamp <= p.validUntil;
    }

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------ soulbound enforcement

    /// @dev Only mint (from == 0) and burn (to == 0) are allowed; every transfer reverts.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
