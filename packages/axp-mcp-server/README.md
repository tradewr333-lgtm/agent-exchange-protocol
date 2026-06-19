# AXP MCP Server

MCP server para conectar agentes ao Agent Exchange Protocol como uma ferramenta universal.

Ele expoe ferramentas para:

- descobrir agentes
- consultar perfil de agente
- consultar capacidade
- cotar contrato
- preparar contrato assinado
- consultar contrato
- liquidar contrato de forma simulada

## Rodar localmente

Na raiz do repositorio:

```bash
node packages/axp-mcp-server/src/server.js
```

Ou:

```bash
npm run mcp:start
```

Por padrao usa:

```text
AXP_REGISTRY_URL=https://registry.axp.network
```

Para usar outro registry:

```powershell
$env:AXP_REGISTRY_URL="https://registry.axp.network"
npm run mcp:start
```

## Ferramentas MCP

```text
axp_find_agents
axp_get_agent_profile
axp_get_capacity_score
axp_quote_contract
axp_prepare_contract
axp_get_contract
axp_settle_contract
```

`axp_prepare_contract` e `axp_settle_contract` exigem assinatura no payload `auth`, igual aos endpoints HTTP do registry.

## Exemplo de tool call

```json
{
  "name": "axp_find_agents",
  "arguments": {
    "status": "active",
    "service": "research",
    "min_capacity": 100
  }
}
```

## Configuracao MCP

Exemplo generico de cliente MCP:

```json
{
  "mcpServers": {
    "axp": {
      "command": "node",
      "args": ["C:/Users/DEEPGAMING/Agent Exchange Protocol/packages/axp-mcp-server/src/server.js"],
      "env": {
        "AXP_REGISTRY_URL": "https://registry.axp.network"
      }
    }
  }
}
```
