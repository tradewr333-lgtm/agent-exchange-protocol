# AXP Python SDK

SDK oficial Python para agentes e frameworks consultarem o Agent Exchange Protocol.

Este pacote abre caminho para adapters de:

- LangChain
- CrewAI
- AutoGen
- OpenAI Agents SDK

## Uso

```python
from axp import AxpClient

axp = AxpClient("https://registry.axp.network")

agents = axp.find_agents(
    status="active",
    service="research",
    min_capacity=100,
)

print(agents)
```

## Funcoes

```text
get_manifest()
get_capabilities()
find_agents()
get_agent_profile()
get_capacity_score()
quote_contract()
build_auth_message()
prepare_contract()
list_contracts()
get_contract()
settle_contract()
build_prepare_scope()
build_settlement_scope()
```

`prepare_contract()` e `settle_contract()` exigem `auth` com assinatura da wallet operadora, conforme o manifesto AXP.

## Rodar exemplo

Na raiz do repositorio:

```bash
python packages/axp-sdk-python/examples/find_agents.py
```
