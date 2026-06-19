from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_REGISTRY_URL = "https://registry.axp.network"


class AxpError(RuntimeError):
    """Raised when the AXP registry returns an error response."""


@dataclass
class AxpClient:
    registry_url: str = DEFAULT_REGISTRY_URL
    timeout: float = 30.0

    def __post_init__(self) -> None:
        self.registry_url = self.registry_url.rstrip("/")

    def get_manifest(self) -> dict[str, Any]:
        return self._get_json("/.well-known/axp.json")

    def get_capabilities(self) -> dict[str, Any]:
        return self._get_json("/capabilities")

    def find_agents(
        self,
        *,
        status: str | None = None,
        service: str | None = None,
        min_capacity: int | float | None = None,
    ) -> dict[str, Any]:
        query = _query_string(
            {
                "status": status,
                "service": service,
                "min_capacity": min_capacity,
            }
        )
        return self._get_json(f"/agents{query}")

    def get_agent_profile(self, agent_id: str) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._get_json(f"/agents/{agent_id}")

    def get_capacity_score(self, agent_id: str) -> dict[str, Any]:
        agent = self.get_agent_profile(agent_id)
        return {
            "agent_id": agent["agent_id"],
            "reputation": agent.get("reputation"),
            "stake_axp": agent.get("stake_axp"),
            "available_capacity": agent.get("available_capacity"),
            "completed_contracts": agent.get("completed_contracts"),
            "failed_contracts": agent.get("failed_contracts"),
            "failure_rate": agent.get("failure_rate"),
        }

    def quote_contract(
        self,
        *,
        provider_agent_id: str,
        service: str,
        requested_capacity: int | float,
        requester_agent_id: str | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/contracts/quote",
            {
                "requester_agent_id": requester_agent_id,
                "provider_agent_id": provider_agent_id,
                "service": service,
                "requested_capacity": requested_capacity,
            },
        )

    def build_auth_message(
        self,
        *,
        action: str,
        agent_id: str,
        address: str,
        nonce: str,
        issued_at: str,
        scope: str,
    ) -> dict[str, Any]:
        return self._post_json(
            "/auth/message",
            {
                "action": action,
                "agent_id": agent_id,
                "address": address,
                "nonce": nonce,
                "issued_at": issued_at,
                "scope": scope,
            },
        )

    def prepare_contract(
        self,
        *,
        provider_agent_id: str,
        service: str,
        requested_capacity: int | float,
        auth: dict[str, Any],
        requester_agent_id: str | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/contracts/prepare",
            {
                "requester_agent_id": requester_agent_id,
                "provider_agent_id": provider_agent_id,
                "service": service,
                "requested_capacity": requested_capacity,
                "auth": auth,
            },
        )

    def list_contracts(self) -> dict[str, Any]:
        return self._get_json("/contracts")

    def get_contract(self, contract_id: str) -> dict[str, Any]:
        _require_value(contract_id, "contract_id")
        return self._get_json(f"/contracts/{contract_id}")

    def settle_contract(
        self,
        contract_id: str,
        *,
        outcome: str,
        auth: dict[str, Any],
        evidence_uri: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        _require_value(contract_id, "contract_id")
        return self._post_json(
            f"/contracts/{contract_id}/settle",
            {
                "outcome": outcome,
                "auth": auth,
                "evidence_uri": evidence_uri,
                "notes": notes,
            },
        )

    def _get_json(self, path: str) -> dict[str, Any]:
        request = Request(f"{self.registry_url}{path}", method="GET")
        return self._read_json(request, path)

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(_drop_none(payload)).encode("utf-8")
        request = Request(
            f"{self.registry_url}{path}",
            data=body,
            method="POST",
            headers={"content-type": "application/json"},
        )
        return self._read_json(request, path)

    def _read_json(self, request: Request, path: str) -> dict[str, Any]:
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8-sig"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise AxpError(f"{path} failed with {error.code}: {detail}") from error


def build_prepare_scope(
    *,
    provider_agent_id: str,
    service: str,
    requested_capacity: int | float,
    requester_agent_id: str | None = None,
) -> str:
    requester = requester_agent_id or "none"
    return (
        f"provider:{provider_agent_id}|"
        f"requester:{requester}|"
        f"service:{service}|"
        f"capacity:{float(requested_capacity):g}"
    )


def build_settlement_scope(*, contract_id: str, outcome: str) -> str:
    return f"contract:{contract_id}|outcome:{outcome}"


def _query_string(params: dict[str, Any]) -> str:
    clean = _drop_none(params)
    return f"?{urlencode(clean)}" if clean else ""


def _drop_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _require_value(value: str, name: str) -> None:
    if value is None or value == "":
        raise ValueError(f"{name} is required")
