# AXP CrewAI Adapter

Adapter oficial do Agent Exchange Protocol para CrewAI.

Ele expoe ferramentas para crews e agentes consultarem o AXP automaticamente:

- `AXPFindAgentsTool`
- `AXPQuoteContractTool`
- `AXPGetCapacityTool`

## Uso

```python
from axp_crewai import get_axp_tools

tools = get_axp_tools(registry_url="https://registry.axp.network")
```

Com CrewAI instalado, as classes herdam de `crewai.tools.BaseTool`.
Sem CrewAI instalado, elas continuam funcionando como classes Python simples para testes locais.

## Exemplo local

Na raiz do repositorio:

```bash
python packages/axp-crewai/examples/use_tools.py
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
