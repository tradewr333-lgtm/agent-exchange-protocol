from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


try:
    from axp import AxpClient
except ImportError:
    sdk_src = Path(__file__).resolve().parents[3] / "axp-sdk-python" / "src"
    sys.path.insert(0, str(sdk_src))
    from axp import AxpClient


try:
    from crewai.tools import BaseTool
    from pydantic import BaseModel, Field, PrivateAttr
    _HAS_CREWAI = True
except ImportError:
    BaseTool = object
    BaseModel = object
    Field = None
    PrivateAttr = None
    _HAS_CREWAI = False


if _HAS_CREWAI:
    class FindAgentsInput(BaseModel):
        status: str | None = Field(default=None, description="Optional agent status filter.")
        service: str | None = Field(default=None, description="Optional service capability filter.")
        min_capacity: int | float | None = Field(default=None, description="Minimum available USD-equivalent capacity.")


    class TrustRankingInput(BaseModel):
        status: str | None = Field(default=None, description="Optional agent status filter.")
        service: str | None = Field(default=None, description="Optional service capability filter.")
        min_score: int | float | None = Field(default=None, description="Minimum Proof of Trust score.")
        limit: int | None = Field(default=None, description="Maximum number of ranked agents.")


    class QuoteContractInput(BaseModel):
        provider_agent_id: str = Field(description="AXP provider agent id.")
        service: str = Field(description="Requested service capability.")
        requested_capacity: int | float = Field(description="Requested USD-equivalent capacity obligation.")
        requester_agent_id: str | None = Field(default=None, description="Optional requester agent id.")


    class GetCapacityInput(BaseModel):
        agent_id: str = Field(description="AXP agent id.")


    class GetTrustScoreInput(BaseModel):
        agent_id: str = Field(description="AXP agent id.")


    class HandshakeInput(BaseModel):
        counterparty_agent_id: str = Field(description="Counterparty AXP agent id.")
        requester_agent_id: str | None = Field(default=None, description="Optional requester AXP agent id.")
        minimum_score: int | float | None = Field(default=None, description="Minimum accepted Proof of Trust score.")
        minimum_stake_usd: int | float | None = Field(default=None, description="Minimum accepted collateral/stake in USD.")
        minimum_capacity_usd: int | float | None = Field(default=None, description="Minimum accepted free capacity in USD.")
        require_online: bool | None = Field(default=True, description="Reject offline agents when true.")


    class BestAgentInput(BaseModel):
        task: str | None = Field(default=None, description="Task or service needed.")
        service: str | None = Field(default=None, description="Optional service capability filter.")
        requested_capacity: int | float | None = Field(default=None, description="Minimum free capacity required.")
        limit: int | None = Field(default=None, description="Maximum number of recommendations.")


    class DiscoverCounterpartyInput(BaseModel):
        domain: str | None = Field(default=None, description="Counterparty domain. The tool will read /.well-known/agent.json.")
        manifest_url: str | None = Field(default=None, description="Direct URL to the counterparty agent manifest.")
        agent_id: str | None = Field(default=None, description="Optional expected AXP agent id.")
else:
    FindAgentsInput = None
    TrustRankingInput = None
    QuoteContractInput = None
    GetCapacityInput = None
    GetTrustScoreInput = None
    HandshakeInput = None
    BestAgentInput = None
    DiscoverCounterpartyInput = None


class _AXPCrewTool(BaseTool):
    name: str = ""
    description: str = ""
    args_schema: Any = None

    if _HAS_CREWAI:
        _client: Any = PrivateAttr(default=None)

    def __init__(self, registry_url: str = "https://registry.axp.network", client: AxpClient | None = None):
        if _HAS_CREWAI:
            super().__init__()
            self._client = client or AxpClient(registry_url)
        else:
            self._client = client or AxpClient(registry_url)

    @property
    def client(self) -> AxpClient:
        return self._client

    def run(self, **kwargs: Any) -> str:
        return self._run(**kwargs)

    def _json(self, payload: dict[str, Any]) -> str:
        return json.dumps(payload, indent=2)


class AXPFindAgentsTool(_AXPCrewTool):
    name: str = "axp_find_agents"
    description: str = "Find AXP agents by status, service, and minimum available capacity."
    args_schema: Any = FindAgentsInput

    def _run(
        self,
        status: str | None = None,
        service: str | None = None,
        min_capacity: int | float | None = None,
        **_: Any,
    ) -> str:
        return self._json(
            self.client.find_agents(
                status=status,
                service=service,
                min_capacity=min_capacity,
            )
        )


class AXPGetTrustRankingTool(_AXPCrewTool):
    name: str = "axp_get_trust_ranking"
    description: str = "Get the public AXP ranking of agents by experimental Proof of Trust score."
    args_schema: Any = TrustRankingInput

    def _run(
        self,
        status: str | None = None,
        service: str | None = None,
        min_score: int | float | None = None,
        limit: int | None = None,
        **_: Any,
    ) -> str:
        return self._json(
            self.client.get_trust_ranking(
                status=status,
                service=service,
                min_score=min_score,
                limit=limit,
            )
        )


class AXPQuoteContractTool(_AXPCrewTool):
    name: str = "axp_quote_contract"
    description: str = "Quote whether an AXP provider can accept a contract obligation."
    args_schema: Any = QuoteContractInput

    def _run(
        self,
        provider_agent_id: str,
        service: str,
        requested_capacity: int | float,
        requester_agent_id: str | None = None,
        **_: Any,
    ) -> str:
        return self._json(
            self.client.quote_contract(
                requester_agent_id=requester_agent_id,
                provider_agent_id=provider_agent_id,
                service=service,
                requested_capacity=requested_capacity,
            )
        )


class AXPGetCapacityTool(_AXPCrewTool):
    name: str = "axp_get_capacity_score"
    description: str = "Get collateral, AXP reputation bond, available capacity, and failure rate for an agent."
    args_schema: Any = GetCapacityInput

    def _run(self, agent_id: str, **_: Any) -> str:
        return self._json(self.client.get_capacity_score(agent_id))


class AXPGetTrustScoreTool(_AXPCrewTool):
    name: str = "axp_get_trust_score"
    description: str = "Get the experimental Proof of Trust score for an AXP agent."
    args_schema: Any = GetTrustScoreInput

    def _run(self, agent_id: str, **_: Any) -> str:
        return self._json(self.client.get_trust_score(agent_id))


class AXPGetRiskReportTool(_AXPCrewTool):
    name: str = "axp_get_risk_report"
    description: str = "Get an AXP Trust Oracle risk report before delegating work to an agent."
    args_schema: Any = GetTrustScoreInput

    def _run(self, agent_id: str, **_: Any) -> str:
        return self._json(self.client.get_risk_report(agent_id))


class AXPGetAgentPassportTool(_AXPCrewTool):
    name: str = "axp_get_agent_passport"
    description: str = "Get an AXP Agent Passport. No passport means Trust Unknown."
    args_schema: Any = GetTrustScoreInput

    def _run(self, agent_id: str, **_: Any) -> str:
        return self._json(self.client.get_agent_passport(agent_id))


class AXPHandshakeTool(_AXPCrewTool):
    name: str = "axp_handshake"
    description: str = "Run AXP Handshake with a trust firewall policy before delegating or contracting."
    args_schema: Any = HandshakeInput

    def _run(
        self,
        counterparty_agent_id: str,
        requester_agent_id: str | None = None,
        minimum_score: int | float | None = None,
        minimum_stake_usd: int | float | None = None,
        minimum_capacity_usd: int | float | None = None,
        require_online: bool | None = True,
        **_: Any,
    ) -> str:
        policy = {
            "minimum_score": minimum_score,
            "minimum_stake_usd": minimum_stake_usd,
            "minimum_capacity_usd": minimum_capacity_usd,
            "require_online": require_online,
        }
        return self._json(
            self.client.perform_handshake(
                requester_agent_id=requester_agent_id,
                counterparty_agent_id=counterparty_agent_id,
                policy={key: value for key, value in policy.items() if value is not None},
            )
        )


class AXPGetBestAgentTool(_AXPCrewTool):
    name: str = "axp_get_best_agent"
    description: str = "Recommend the best available AXP agent for a task using Proof of Trust."
    args_schema: Any = BestAgentInput

    def _run(
        self,
        task: str | None = None,
        service: str | None = None,
        requested_capacity: int | float | None = None,
        limit: int | None = None,
        **_: Any,
    ) -> str:
        return self._json(
            self.client.get_best_agent(
                task=task,
                service=service,
                requested_capacity=requested_capacity,
                limit=limit,
            )
        )


class AXPDiscoverCounterpartyTrustTool(_AXPCrewTool):
    name: str = "axp_discover_counterparty_trust"
    description: str = "Fetch a counterparty /.well-known/agent.json manifest, verify AXP Trust, and return risk/trust links before delegation."
    args_schema: Any = DiscoverCounterpartyInput

    def _run(
        self,
        domain: str | None = None,
        manifest_url: str | None = None,
        agent_id: str | None = None,
        **_: Any,
    ) -> str:
        verification = self.client.verify_agent_manifest(
            domain=domain,
            manifest_url=manifest_url,
            agent_id=agent_id,
        )
        risk_report = None
        handshake = None
        discovered_agent_id = verification.get("agent_id")
        if verification.get("discoverable") and discovered_agent_id:
            try:
                risk_report = self.client.get_risk_report(discovered_agent_id)
            except Exception as error:
                risk_report = {"error": str(error)}
            try:
                handshake = self.client.perform_handshake(
                    counterparty_agent_id=discovered_agent_id,
                    policy={"require_online": False, "allowed_risk": ["LOW", "MEDIUM"]},
                )
            except Exception as error:
                handshake = {"error": str(error)}

        return self._json(
            {
                "verification": verification,
                "risk_report": risk_report,
                "handshake": handshake,
                "recommendation": "Use AXP handshake before preparing or accepting a contract.",
            }
        )


def get_axp_tools(registry_url: str = "https://registry.axp.network") -> list[_AXPCrewTool]:
    client = AxpClient(registry_url)
    return [
        AXPDiscoverCounterpartyTrustTool(client=client),
        AXPFindAgentsTool(client=client),
        AXPGetTrustRankingTool(client=client),
        AXPQuoteContractTool(client=client),
        AXPGetCapacityTool(client=client),
        AXPGetTrustScoreTool(client=client),
        AXPGetRiskReportTool(client=client),
        AXPGetAgentPassportTool(client=client),
        AXPHandshakeTool(client=client),
        AXPGetBestAgentTool(client=client),
    ]
