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

    def get_tools(self) -> list[dict[str, Any]]:
        return [
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
        ]


def get_autogen_tools(registry_url: str = DEFAULT_REGISTRY_URL) -> list[dict[str, Any]]:
    return AxpAutoGenToolkit(registry_url=registry_url).get_tools()


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2)
