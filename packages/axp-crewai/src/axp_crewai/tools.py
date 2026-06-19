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
        min_capacity: int | float | None = Field(default=None, description="Minimum available AXP capacity.")


    class QuoteContractInput(BaseModel):
        provider_agent_id: str = Field(description="AXP provider agent id.")
        service: str = Field(description="Requested service capability.")
        requested_capacity: int | float = Field(description="Requested AXP capacity obligation.")
        requester_agent_id: str | None = Field(default=None, description="Optional requester agent id.")


    class GetCapacityInput(BaseModel):
        agent_id: str = Field(description="AXP agent id.")
else:
    FindAgentsInput = None
    QuoteContractInput = None
    GetCapacityInput = None


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
    description: str = "Get AXP stake, reputation, available capacity, and failure rate for an agent."
    args_schema: Any = GetCapacityInput

    def _run(self, agent_id: str, **_: Any) -> str:
        return self._json(self.client.get_capacity_score(agent_id))


def get_axp_tools(registry_url: str = "https://registry.axp.network") -> list[_AXPCrewTool]:
    client = AxpClient(registry_url)
    return [
        AXPFindAgentsTool(client=client),
        AXPQuoteContractTool(client=client),
        AXPGetCapacityTool(client=client),
    ]
