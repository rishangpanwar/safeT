// Specifies the version of the Solidity compiler to use.
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Imports a helper contract from OpenZeppelin for ownership control.
import "@openzeppelin/contracts/access/Ownable.sol";

// This is our main smart contract.
contract TouristRegistry is Ownable {
    // Defines the possible safety states for a tourist.
    enum SafetyStatus {
        Normal,
        Alert,
        Danger
    }

    // Defines the structure for storing tourist data on the blockchain.
    struct Tourist {
        bytes32 kycHash; // A cryptographic hash of the tourist's ID document (Aadhaar/Passport).
        SafetyStatus status; // The current safety status.
        bool isRegistered; // A flag to check if this ID exists.
    }

    // A mapping is like a hash map or dictionary. It links a tourist's ID (a number) to their data.
    mapping(uint256 => Tourist) public tourists;
    // A counter to ensure every tourist gets a unique ID.
    uint256 private _nextTouristId;

    // An event is like a log that gets emitted when something important happens.
    // Our backend can listen for these events.
    event TouristRegistered(uint256 indexed touristId, bytes32 kycHash);
    event SafetyStatusUpdated(
        uint256 indexed touristId,
        SafetyStatus newStatus
    );

    // The constructor is run only once when the contract is first deployed.
    // It sets the deployer of the contract as the initial owner.
    constructor() Ownable(msg.sender) {}

    /**
     * @dev Registers a new tourist on the blockchain. Only the contract owner can call this.
     * @param _kycHash A SHA-256 hash of the tourist's document ID.
     * @return The unique ID assigned to the new tourist.
     */
    function registerTourist(
        bytes32 _kycHash
    ) public onlyOwner returns (uint256) {
        // Assign the next available ID and then increment the counter.
        uint256 touristId = _nextTouristId++;

        // Create the new tourist record in our mapping.
        tourists[touristId] = Tourist({
            kycHash: _kycHash,
            status: SafetyStatus.Normal,
            isRegistered: true
        });

        // Emit an event to log that this registration happened.
        emit TouristRegistered(touristId, _kycHash);

        // Return the new ID.
        return touristId;
    }

    /**
     * @dev Updates the safety status of an existing tourist. Only the owner can call this.
     * @param _touristId The ID of the tourist to update.
     * @param _newStatus The new safety status (0 for Normal, 1 for Alert, 2 for Danger).
     */
    function updateSafetyStatus(
        uint256 _touristId,
        SafetyStatus _newStatus
    ) public onlyOwner {
        // Check to make sure the tourist actually exists before trying to update.
        require(tourists[_touristId].isRegistered, "Tourist not found");

        // Update the status.
        tourists[_touristId].status = _newStatus;

        // Emit an event to log the change.
        emit SafetyStatusUpdated(_touristId, _newStatus);
    }
}
