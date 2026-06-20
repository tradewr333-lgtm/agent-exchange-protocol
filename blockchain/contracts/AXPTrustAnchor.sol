// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AXPTrustAnchor is Ownable {
    struct Anchor {
        bytes32 merkleRoot;
        uint256 fromEventId;
        uint256 toEventId;
        uint256 eventCount;
        string registryUrl;
        string batchUri;
        uint256 createdAt;
    }

    Anchor[] private _anchors;
    mapping(bytes32 => bool) public rootRecorded;

    event TrustAnchorRecorded(
        uint256 indexed anchorId,
        bytes32 indexed merkleRoot,
        uint256 fromEventId,
        uint256 toEventId,
        uint256 eventCount,
        string registryUrl,
        string batchUri
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    function recordAnchor(
        bytes32 merkleRoot,
        uint256 fromEventId,
        uint256 toEventId,
        uint256 eventCount,
        string calldata registryUrl,
        string calldata batchUri
    ) external onlyOwner returns (uint256 anchorId) {
        require(merkleRoot != bytes32(0), "AXPTrustAnchor: empty root");
        require(!rootRecorded[merkleRoot], "AXPTrustAnchor: root exists");
        require(eventCount > 0, "AXPTrustAnchor: empty batch");
        require(fromEventId <= toEventId, "AXPTrustAnchor: invalid range");

        rootRecorded[merkleRoot] = true;
        _anchors.push(Anchor({
            merkleRoot: merkleRoot,
            fromEventId: fromEventId,
            toEventId: toEventId,
            eventCount: eventCount,
            registryUrl: registryUrl,
            batchUri: batchUri,
            createdAt: block.timestamp
        }));

        anchorId = _anchors.length - 1;
        emit TrustAnchorRecorded(anchorId, merkleRoot, fromEventId, toEventId, eventCount, registryUrl, batchUri);
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function getAnchor(uint256 anchorId) external view returns (Anchor memory) {
        require(anchorId < _anchors.length, "AXPTrustAnchor: anchor not found");
        return _anchors[anchorId];
    }

    function latestAnchor() external view returns (Anchor memory) {
        require(_anchors.length > 0, "AXPTrustAnchor: no anchors");
        return _anchors[_anchors.length - 1];
    }
}
