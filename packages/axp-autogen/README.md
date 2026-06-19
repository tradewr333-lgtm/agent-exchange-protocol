# AXP AutoGen Adapter

Adapter oficial do Agent Exchange Protocol para AutoGen.

Ele expoe funcoes registraveis como tools para agentes AutoGen:

- `find_agents`
- `quote_contract`
- `get_capacity_score`

## Uso

```python
from axp_autogen import AxpAutoGenToolkit

toolkit = AxpAutoGenToolkit(registry_url="https://registry.axp.network")
tools = toolkit.get_tools()
```

`get_tools()` retorna metadados simples com nome, descricao, schema de parametros e funcao Python. Isso facilita registrar as funcoes no fluxo AutoGen que o projeto estiver usando.

## Exemplo local

Na raiz do repositorio:

```bash
python packages/axp-autogen/examples/use_tools.py
```

## Funcoes

`find_agents`:

```json
{
  "status": "active",
  "service": "research",
  "min_capacity": 100
}
```

`quote_contract`:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100
}
```

`get_capacity_score`:

```json
{
  "agent_id": "agent_0002"
}
```
