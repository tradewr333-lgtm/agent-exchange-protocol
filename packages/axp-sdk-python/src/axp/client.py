from __future__ import annotations

import json
import os
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
    api_key: str | None = None

    def __post_init__(self) -> None:
        self.registry_url = self.registry_url.rstrip("/")
        if self.api_key is None:
            self.api_key = os.environ.get("AXP_API_KEY")

    def get_manifest(self) -> dict[str, Any]:
        return self._get_json("/.well-known/axp.json")

    def get_capabilities(self) -> dict[str, Any]:
        return self._get_json("/capabilities")

    def get_economics(self) -> dict[str, Any]:
        return self._get_json("/economics")

    def discover_agent_manifest(
        self,
        target: str | None = None,
        *,
        domain: str | None = None,
        manifest_url: str | None = None,
    ) -> dict[str, Any]:
        url = _resolve_agent_manifest_url(target, domain=domain, manifest_url=manifest_url)
        request = Request(url, method="GET", headers={"accept": "application/json"})
        manifest = self._read_json(request, url)
        return {
            "schema": "axp.agent_manifest_discovery.v0",
            "manifest_url": url,
            "agent_id": manifest.get("agent_id"),
            "axp_trust": manifest.get("trust") if manifest.get("trust", {}).get("provider") == "AXP" else None,
            "manifest": manifest,
        }

    def verify_agent_manifest(
        self,
        *,
        manifest_url: str | None = None,
        domain: str | None = None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/agents/verify-manifest",
            {
                "manifest_url": manifest_url,
                "domain": domain,
                "agent_id": agent_id,
            },
            skip_api_key=True,
        )

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

    def register_api_key(
        self,
        *,
        name: str,
        owner: str,
        auth: dict[str, Any],
        agent_id: str | None = None,
        framework: str | None = None,
        scopes: list[str] | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/api-keys/register",
            {
                "name": name,
                "owner": owner,
                "agent_id": agent_id,
                "framework": framework,
                "scopes": scopes,
                "auth": auth,
            },
            skip_api_key=True,
        )

    def get_api_key(self, key_id: str) -> dict[str, Any]:
        _require_value(key_id, "key_id")
        return self._get_json(f"/api-keys/{key_id}", skip_api_key=True)

    def rotate_api_key(self, key_id: str, *, auth: dict[str, Any]) -> dict[str, Any]:
        _require_value(key_id, "key_id")
        return self._post_json(f"/api-keys/{key_id}/rotate", {"auth": auth}, skip_api_key=True)

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
        return self._get_json(f"/trust-score/{agent_id}")

    def get_risk_report(self, agent_id: str) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._get_json(f"/risk-report/{agent_id}")

    def get_agent_passport(self, agent_id: str) -> dict[str, Any]:
        _require_value(agent_id, "agent_id")
        return self._get_json(f"/passport/{agent_id}")

    def perform_handshake(
        self,
        *,
        counterparty_agent_id: str,
        requester_agent_id: str | None = None,
        policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        _require_value(counterparty_agent_id, "counterparty_agent_id")
        return self._post_json(
            "/handshake",
            {
                "requester_agent_id": requester_agent_id,
                "counterparty_agent_id": counterparty_agent_id,
                "policy": policy,
            },
        )

    def get_best_agent(
        self,
        *,
        task: str | None = None,
        service: str | None = None,
        requested_capacity: int | float | None = None,
        limit: int | None = None,
        online: bool | None = None,
    ) -> dict[str, Any]:
        query = _query_string(
            {
                "task": task,
                "service": service,
                "requested_capacity": requested_capacity,
                "limit": limit,
                "online": _bool_query(online),
            }
        )
        return self._get_json(f"/best-agent{query}")

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
        handshake_mode: str | None = None,
        trust_policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._post_json(
            "/contracts/prepare",
            {
                "requester_agent_id": requester_agent_id,
                "provider_agent_id": provider_agent_id,
                "service": service,
                "requested_capacity": requested_capacity,
                "handshake_mode": handshake_mode,
                "trust_policy": trust_policy,
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

    def _get_json(self, path: str, *, skip_api_key: bool = False) -> dict[str, Any]:
        request = Request(f"{self.registry_url}{path}", method="GET", headers=self._headers(skip_api_key=skip_api_key))
        return self._read_json(request, path)

    def _post_json(self, path: str, payload: dict[str, Any], *, skip_api_key: bool = False) -> dict[str, Any]:
        body = json.dumps(_drop_none(payload)).encode("utf-8")
        request = Request(
            f"{self.registry_url}{path}",
            data=body,
            method="POST",
            headers=self._headers(skip_api_key=skip_api_key),
        )
        return self._read_json(request, path)

    def _headers(self, *, skip_api_key: bool = False) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.api_key and not skip_api_key:
            headers["x-axp-api-key"] = self.api_key
        return headers

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


def _resolve_agent_manifest_url(
    target: str | None = None,
    *,
    domain: str | None = None,
    manifest_url: str | None = None,
) -> str:
    value = manifest_url or target
    if value:
        if value.startswith("https://"):
            return value
        clean_domain = value.removeprefix("http://").removeprefix("https://").split("/", 1)[0]
        return f"https://{clean_domain}/.well-known/agent.json"

    if domain:
        clean_domain = domain.removeprefix("http://").removeprefix("https://").split("/", 1)[0]
        return f"https://{clean_domain}/.well-known/agent.json"

    raise ValueError("domain or manifest_url is required")


def _require_value(value: str, name: str) -> None:
    if value is None or value == "":
        raise ValueError(f"{name} is required")
