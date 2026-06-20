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

    def get_economics(self) -> dict[str, Any]:
        return self._get_json("/economics")

    def get_trust_ranking(
        self,
        *,
        status: str | None = None,
        service: str | None = None,
        min_score: int | float | None = None,
        limit: int | None = None,
        online: bool | None = None,
    ) -> dict[str, Any]:
        query = _query_string(
            {
                "status": status,
                "service": service,
                "min_score": min_score,
                "limit": limit,
                "online": _bool_query(online),
            }
        )
        return self._get_json(f"/trust-ranking{query}")

    def find_agents(
        self,
        *,
        status: str | None = None,
        service: str | None = None,
        min_capacity: int | float | None = None,
        online: bool | None = None,
    ) -> dict[str, Any]:
        query = _query_string(
            {
                "status": status,
                "service": service,
                "min_capacity": min_capacity,
                "online": _bool_query(online),
            }
        )
        return self._get_json(f"/agents{query}")

    def register_agent(
        self,
        *,
        agent_id: str,
        name: str,
        operator: str,
        services: list[str],
        collateral: dict[str, Any],
        auth: dict[str, Any],
        manifest_url: str | None = None,
        role: str | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/agents/register",
            {
                "agent_id": agent_id,
                "name": name,
                "operator": operator,
                "services": services,
                "collateral": collateral,
                "manifest_url": manifest_url,
                "role": role,
                "auth": auth,
            },
        )

    def get_agent_profile(self, agent_id: str) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._get_json(f"/agents/{agent_id}")

    def send_heartbeat(
        self,
        agent_id: str,
        *,
        status: str,
        available: bool,
        current_load: int | float,
        available_capacity: int | float,
        auth: dict[str, Any],
        endpoint: str | None = None,
        version: str | None = None,
    ) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._post_json(
            f"/agents/{agent_id}/heartbeat",
            {
                "status": status,
                "available": available,
                "current_load": current_load,
                "available_capacity": available_capacity,
                "endpoint": endpoint,
                "version": version,
                "auth": auth,
            },
        )

    def get_trust_score(self, agent_id: str) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._get_json(f"/agents/{agent_id}/trust-score")

    def get_capacity_score(self, agent_id: str) -> dict[str, Any]:
        agent = self.get_agent_profile(agent_id)
        return {
            "agent_id": agent["agent_id"],
            "reputation": agent.get("reputation"),
            "stake_axp": agent.get("stake_axp"),
            "collateral": agent.get("collateral"),
            "collateral_usd": agent.get("collateral_usd"),
            "axp_reputation_bond": agent.get("axp_reputation_bond"),
            "axp_trust_multiplier": agent.get("axp_trust_multiplier"),
            "total_capacity": agent.get("total_capacity"),
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


def build_registration_scope(
    *,
    agent_id: str,
    operator: str,
    services: list[str],
    collateral: dict[str, Any],
    manifest_url: str | None = None,
) -> str:
    asset = str(collateral.get("asset") or collateral.get("symbol") or "").upper()
    amount = collateral.get("amount")
    return (
        f"agent:{agent_id}|"
        f"operator:{operator}|"
        f"services:{','.join(services)}|"
        f"collateral:{asset}:{amount}|"
        f"manifest:{manifest_url or 'none'}"
    )


def build_heartbeat_scope(
    *,
    agent_id: str,
    status: str,
    available: bool,
    current_load: int | float,
    available_capacity: int | float,
    endpoint: str | None = None,
) -> str:
    return (
        f"agent:{agent_id}|"
        f"status:{status}|"
        f"available:{str(bool(available)).lower()}|"
        f"load:{float(current_load):g}|"
        f"capacity:{float(available_capacity):g}|"
        f"endpoint:{endpoint or 'none'}"
    )


def build_settlement_scope(*, contract_id: str, outcome: str) -> str:
    return f"contract:{contract_id}|outcome:{outcome}"


def _query_string(params: dict[str, Any]) -> str:
    clean = _drop_none(params)
    return f"?{urlencode(clean)}" if clean else ""


def _drop_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _bool_query(value: bool | None) -> str | None:
    if value is None:
        return None
    return "true" if value else "false"


def _require_value(value: str, name: str) -> None:
    if value is None or value == "":
        raise ValueError(f"{name} is required")
