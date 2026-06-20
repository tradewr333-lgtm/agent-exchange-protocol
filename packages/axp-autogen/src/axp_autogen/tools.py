from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any, Callable


try:
    from axp import AxpClient
except ImportError:
    sdk_src = Path(__file__).resolve().parents[3] / "axp-sdk-python" / "src"
    sys.path.insert(0, str(sdk_src))
    from axp import AxpClient


DEFAULT_REGISTRY_URL = "https://registry.axp.network"


def find_agents(
    status: str | None = None,
    service: str | None = None,
    min_capacity: int | float | None = None,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    return _json(
        client.find_agents(
            status=status,
            service=service,
            min_capacity=min_capacity,
        )
    )


def get_trust_ranking(
    status: str | None = None,
    service: str | None = None,
    min_score: int | float | None = None,
    limit: int | None = None,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    return _json(
        client.get_trust_ranking(
            status=status,
            service=service,
            min_score=min_score,
            limit=limit,
        )
    )


def quote_contract(
    provider_agent_id: str,
    service: str,
    requested_capacity: int | float,
    requester_agent_id: str | None = None,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    return _json(
        client.quote_contract(
            requester_agent_id=requester_agent_id,
            provider_agent_id=provider_agent_id,
            service=service,
            requested_capacity=requested_capacity,
        )
    )


def get_capacity_score(agent_id: str, registry_url: str = DEFAULT_REGISTRY_URL) -> str:
    client = AxpClient(registry_url)
    return _json(client.get_capacity_score(agent_id))


def get_trust_score(agent_id: str, registry_url: str = DEFAULT_REGISTRY_URL) -> str:
    client = AxpClient(registry_url)
    return _json(client.get_trust_score(agent_id))


def get_risk_report(agent_id: str, registry_url: str = DEFAULT_REGISTRY_URL) -> str:
    client = AxpClient(registry_url)
    return _json(client.get_risk_report(agent_id))


def get_agent_passport(agent_id: str, registry_url: str = DEFAULT_REGISTRY_URL) -> str:
    client = AxpClient(registry_url)
    return _json(client.get_agent_passport(agent_id))


def handshake(
    counterparty_agent_id: str,
    requester_agent_id: str | None = None,
    minimum_score: int | float | None = None,
    minimum_stake_usd: int | float | None = None,
    minimum_capacity_usd: int | float | None = None,
    require_online: bool | None = True,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    policy = {
        "minimum_score": minimum_score,
        "minimum_stake_usd": minimum_stake_usd,
        "minimum_capacity_usd": minimum_capacity_usd,
        "require_online": require_online,
    }
    return _json(
        client.perform_handshake(
            requester_agent_id=requester_agent_id,
            counterparty_agent_id=counterparty_agent_id,
            policy={key: value for key, value in policy.items() if value is not None},
        )
    )


def get_best_agent(
    task: str | None = None,
    service: str | None = None,
    requested_capacity: int | float | None = None,
    limit: int | None = None,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    return _json(
        client.get_best_agent(
            task=task,
            service=service,
            requested_capacity=requested_capacity,
            limit=limit,
        )
    )


def discover_counterparty_trust(
    domain: str | None = None,
    manifest_url: str | None = None,
    agent_id: str | None = None,
    registry_url: str = DEFAULT_REGISTRY_URL,
) -> str:
    client = AxpClient(registry_url)
    verification = client.verify_agent_manifest(
        domain=domain,
        manifest_url=manifest_url,
        agent_id=agent_id,
    )
    risk_report = None
    handshake_result = None
    discovered_agent_id = verification.get("agent_id")
    if verification.get("discoverable") and discovered_agent_id:
        try:
            risk_report = client.get_risk_report(discovered_agent_id)
        except Exception as error:
            risk_report = {"error": str(error)}
        try:
            handshake_result = client.perform_handshake(
                counterparty_agent_id=discovered_agent_id,
                policy={"require_online": False, "allowed_risk": ["LOW", "MEDIUM"]},
            )
        except Exception as error:
            handshake_result = {"error": str(error)}

    return _json(
        {
            "verification": verification,
            "risk_report": risk_report,
            "handshake": handshake_result,
            "recommendation": "Use AXP handshake before preparing or accepting a contract.",
        }
    )


@dataclass
class AxpAutoGenTool:
    name: str
    description: str
    parameters: dict[str, Any]
    function: Callable[..., str]

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "function": self.function,
        }


@dataclass
class AxpAutoGenToolkit:
    registry_url: str = DEFAULT_REGISTRY_URL

    def find_agents(
        self,
        status: str | None = None,
        service: str | None = None,
        min_capacity: int | float | None = None,
    ) -> str:
        return find_agents(
            status=status,
            service=service,
            min_capacity=min_capacity,
            registry_url=self.registry_url,
        )

    def get_trust_ranking(
        self,
        status: str | None = None,
        service: str | None = None,
        min_score: int | float | None = None,
        limit: int | None = None,
    ) -> str:
        return get_trust_ranking(
            status=status,
            service=service,
            min_score=min_score,
            limit=limit,
            registry_url=self.registry_url,
        )

    def quote_contract(
        self,
        provider_agent_id: str,
        service: str,
        requested_capacity: int | float,
        requester_agent_id: str | None = None,
    ) -> str:
        return quote_contract(
            requester_agent_id=requester_agent_id,
            provider_agent_id=provider_agent_id,
            service=service,
            requested_capacity=requested_capacity,
            registry_url=self.registry_url,
        )

    def get_capacity_score(self, agent_id: str) -> str:
        return get_capacity_score(agent_id, registry_url=self.registry_url)

    def get_trust_score(self, agent_id: str) -> str:
        return get_trust_score(agent_id, registry_url=self.registry_url)

    def get_risk_report(self, agent_id: str) -> str:
        return get_risk_report(agent_id, registry_url=self.registry_url)

    def get_agent_passport(self, agent_id: str) -> str:
        return get_agent_passport(agent_id, registry_url=self.registry_url)

    def handshake(
        self,
        counterparty_agent_id: str,
        requester_agent_id: str | None = None,
        minimum_score: int | float | None = None,
        minimum_stake_usd: int | float | None = None,
        minimum_capacity_usd: int | float | None = None,
        require_online: bool | None = True,
    ) -> str:
        return handshake(
            counterparty_agent_id=counterparty_agent_id,
            requester_agent_id=requester_agent_id,
            minimum_score=minimum_score,
            minimum_stake_usd=minimum_stake_usd,
            minimum_capacity_usd=minimum_capacity_usd,
            require_online=require_online,
            registry_url=self.registry_url,
        )

    def get_best_agent(
        self,
        task: str | None = None,
        service: str | None = None,
        requested_capacity: int | float | None = None,
        limit: int | None = None,
    ) -> str:
        return get_best_agent(
            task=task,
            service=service,
            requested_capacity=requested_capacity,
            limit=limit,
            registry_url=self.registry_url,
        )

    def discover_counterparty_trust(
        self,
        domain: str | None = None,
        manifest_url: str | None = None,
        agent_id: str | None = None,
    ) -> str:
        return discover_counterparty_trust(
            domain=domain,
            manifest_url=manifest_url,
            agent_id=agent_id,
            registry_url=self.registry_url,
        )

    def get_tools(self) -> list[dict[str, Any]]:
        return [
            AxpAutoGenTool(
                name="axp_discover_counterparty_trust",
                description="Fetch a counterparty /.well-known/agent.json manifest, verify AXP Trust, and return risk/trust links before delegation.",
                parameters={
                    "type": "object",
                    "properties": {
                        "domain": {"type": "string"},
                        "manifest_url": {"type": "string"},
                        "agent_id": {"type": "string"},
                    },
                },
                function=self.discover_counterparty_trust,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_find_agents",
                description="Find AXP agents by status, service, and minimum available capacity.",
                parameters={
                    "type": "object",
                    "properties": {
                        "status": {"type": "string"},
                        "service": {"type": "string"},
                        "min_capacity": {"type": "number"},
                    },
                },
                function=self.find_agents,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_trust_ranking",
                description="Get the public AXP ranking of agents by experimental Proof of Trust score.",
                parameters={
                    "type": "object",
                    "properties": {
                        "status": {"type": "string"},
                        "service": {"type": "string"},
                        "min_score": {"type": "number"},
                        "limit": {"type": "number"},
                    },
                },
                function=self.get_trust_ranking,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_quote_contract",
                description="Quote whether an AXP provider can accept a contract obligation.",
                parameters={
                    "type": "object",
                    "properties": {
                        "requester_agent_id": {"type": "string"},
                        "provider_agent_id": {"type": "string"},
                        "service": {"type": "string"},
                        "requested_capacity": {"type": "number"},
                    },
                    "required": ["provider_agent_id", "service", "requested_capacity"],
                },
                function=self.quote_contract,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_capacity_score",
                description="Get collateral, AXP reputation bond, available capacity, and failure rate for an agent.",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                    },
                    "required": ["agent_id"],
                },
                function=self.get_capacity_score,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_trust_score",
                description="Get the experimental Proof of Trust score for an AXP agent.",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                    },
                    "required": ["agent_id"],
                },
                function=self.get_trust_score,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_risk_report",
                description="Get an AXP Trust Oracle risk report before delegating work to an agent.",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                    },
                    "required": ["agent_id"],
                },
                function=self.get_risk_report,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_agent_passport",
                description="Get an AXP Agent Passport. No passport means Trust Unknown.",
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {"type": "string"},
                    },
                    "required": ["agent_id"],
                },
                function=self.get_agent_passport,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_handshake",
                description="Run AXP Handshake with a trust firewall policy before delegating or contracting.",
                parameters={
                    "type": "object",
                    "properties": {
                        "requester_agent_id": {"type": "string"},
                        "counterparty_agent_id": {"type": "string"},
                        "minimum_score": {"type": "number"},
                        "minimum_stake_usd": {"type": "number"},
                        "minimum_capacity_usd": {"type": "number"},
                        "require_online": {"type": "boolean"},
                    },
                    "required": ["counterparty_agent_id"],
                },
                function=self.handshake,
            ).as_dict(),
            AxpAutoGenTool(
                name="axp_get_best_agent",
                description="Recommend the best available AXP agent for a task using Proof of Trust.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task": {"type": "string"},
                        "service": {"type": "string"},
                        "requested_capacity": {"type": "number"},
                        "limit": {"type": "number"},
                    },
                },
                function=self.get_best_agent,
            ).as_dict(),
        ]


def get_autogen_tools(registry_url: str = DEFAULT_REGISTRY_URL) -> list[dict[str, Any]]:
    return AxpAutoGenToolkit(registry_url=registry_url).get_tools()


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2)
