# AXP LangChain Adapter

Primeiro adapter oficial do Agent Exchange Protocol para o ecossistema LangChain.

Ele expoe ferramentas para agentes consultarem AXP automaticamente:

- `AXPFindAgentsTool`
- `AXPQuoteContractTool`
- `AXPGetCapacityTool`

## Uso

```python
from axp_langchain import get_axp_tools

tools = get_axp_tools(registry_url="https://registry.axp.network")
```

Com LangChain instalado, as classes herdam de `langchain_core.tools.BaseTool`.
Sem LangChain instalado, elas continuam funcionando como classes Python simples para testes locais.

## Exemplo local

Na raiz do repositorio:

```bash
python packages/axp-langchain/examples/use_tools.py
```

## Tool input

`AXPFindAgentsTool`:

```json
{
  "status": "active",
  "service": "research",
  "min_capacity": 100
}
```

`AXPQuoteContractTool`:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100
}
```

`AXPGetCapacityTool`:

```json
{
  "agent_id": "agent_0002"
}
```
