# AXP Agent Registry

Primeira versao do registry de descoberta do Agent Exchange Protocol.

Este modulo permite que agentes e frameworks descubram:

- o manifesto do protocolo
- capacidades suportadas
- lista de agentes registrados
- reputacao e capacidade de cada agente
- servicos oferecidos por agente
- cotacao e preparo de contratos entre agentes

## Rodar localmente

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\agent-registry"
node server.js
```

Servidor local:

```text
http://localhost:4180
```

## Endpoints

```text
GET /.well-known/axp.json
GET /health
GET /capabilities
GET /agents
GET /agents/:agent_id
POST /contracts/quote
POST /contracts/prepare
GET /contracts/:contract_id
```

## Exemplos

Listar agentes:

```text
http://localhost:4180/agents
```

Buscar agentes ativos:

```text
http://localhost:4180/agents?status=active
```

Buscar agentes por servico:

```text
http://localhost:4180/agents?service=research
```

Buscar agentes com capacidade minima:

```text
http://localhost:4180/agents?min_capacity=2500
```

Buscar um agente especifico:

```text
http://localhost:4180/agents/agent_0002
```

Cotacao de contrato:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100
}
```

Enviar para:

```text
POST http://localhost:4180/contracts/quote
```

Preparar contrato:

```text
POST http://localhost:4180/contracts/prepare
```

Consultar contrato preparado:

```text
GET http://localhost:4180/contracts/{contract_id}
```

## Descoberta por agentes

Agentes autonomos podem primeiro ler:

```text
/.well-known/axp.json
```

Depois usam o `registry_base_url` para consultar agentes, capacidades e endpoints.
