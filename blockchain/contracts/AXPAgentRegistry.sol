// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AXPAgentRegistry is Ownable {
    struct Agent {
        address operator;
        string metadataURI;
        uint256 reputationBps;
        uint256 completedContracts;
        uint256 failedContracts;
        bool active;
    }

    mapping(bytes32 => Agent) private agents;
    mapping(address => bytes32) public operatorAgentId;

    event AgentRegistered(bytes32 indexed agentId, address indexed operator, string metadataURI);
    event AgentMetadataUpdated(bytes32 indexed agentId, string metadataURI);
    event AgentScoreUpdated(bytes32 indexed agentId, uint256 reputationBps, uint256 completedContracts, uint256 failedContracts);
    event AgentStatusUpdated(bytes32 indexed agentId, bool active);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerAgent(bytes32 agentId, address operator, string calldata metadataURI) external onlyOwner {
        require(agentId != bytes32(0), "AXPRegistry: agent id required");
        require(operator != address(0), "AXPRegistry: operator required");
        require(agents[agentId].operator == address(0), "AXPRegistry: already registered");
        require(operatorAgentId[operator] == bytes32(0), "AXPRegistry: operator already used");

        agents[agentId] = Agent({
            operator: operator,
            metadataURI: metadataURI,
            reputationBps: 10_000,
            completedContracts: 0,
            failedContracts: 0,
            active: true
        });
        operatorAgentId[operator] = agentId;
        emit AgentRegistered(agentId, operator, metadataURI);
    }

    function updateMetadata(bytes32 agentId, string calldata metadataURI) external {
        Agent storage agent = requireAgent(agentId);
        require(msg.sender == owner() || msg.sender == agent.operator, "AXPRegistry: not authorized");
        agent.metadataURI = metadataURI;
        emit AgentMetadataUpdated(agentId, metadataURI);
    }

    function updateScore(
        bytes32 agentId,
        uint256 reputationBps,
        uint256 completedContracts,
        uint256 failedContracts
    ) external onlyOwner {
        require(reputationBps <= 20_000, "AXPRegistry: score too high");
        Agent storage agent = requireAgent(agentId);
        agent.reputationBps = reputationBps;
        agent.completedContracts = completedContracts;
        agent.failedContracts = failedContracts;
        emit AgentScoreUpdated(agentId, reputationBps, completedContracts, failedContracts);
    }

    function setActive(bytes32 agentId, bool active) external onlyOwner {
        Agent storage agent = requireAgent(agentId);
        agent.active = active;
        emit AgentStatusUpdated(agentId, active);
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    function requireAgent(bytes32 agentId) internal view returns (Agent storage agent) {
        agent = agents[agentId];
        require(agent.operator != address(0), "AXPRegistry: not registered");
    }
}
