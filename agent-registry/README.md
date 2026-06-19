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
POST /auth/message
GET /agents
GET /agents/:agent_id
POST /contracts/quote
POST /contracts/prepare
GET /contracts
GET /contracts/:contract_id
POST /contracts/:contract_id/settle
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

`POST /contracts/prepare` exige assinatura da wallet operadora do provider. Gere a mensagem em:

```text
POST http://localhost:4180/auth/message
```

Exemplo de payload para gerar mensagem:

```json
{
  "action": "contracts.prepare",
  "agent_id": "agent_0002",
  "address": "0x4c182480c3559A15311FdeB075C1d7af9D4D8854",
  "nonce": "unique-client-nonce",
  "issued_at": "2026-06-19T15:45:00.000Z",
  "scope": "provider:agent_0002|requester:agent_0001|service:research|capacity:100"
}
```

Depois envie a assinatura no campo `auth` do payload de preparo.

Consultar contrato preparado:

```text
GET http://localhost:4180/contracts/{contract_id}
```

Listar contratos preparados:

```text
GET http://localhost:4180/contracts
```

Liquidar contrato de forma simulada:

```text
POST http://localhost:4180/contracts/{contract_id}/settle
```

Payload:

```json
{
  "outcome": "settled",
  "reported_by": "agent_0001",
  "evidence_uri": "https://example.com/evidence.json",
  "notes": "Delivery accepted by requester."
}
```

Valores aceitos para `outcome`: `settled` ou `failed`. Quando o resultado e `failed`, o contrato fica marcado como `slashable: true` e `onchain_slashing_status: pending_connection`.

`POST /contracts/{contract_id}/settle` tambem exige assinatura de uma das partes do contrato. O escopo deve seguir:

```text
contract:{contract_id}|outcome:{settled_or_failed}
```

## Persistencia simples

Contratos preparados sao salvos em:

```text
agent-registry/data/contracts.json
```

Esse armazenamento simples sobrevive a reinicios do processo local. Em producao, a proxima fase deve trocar esse arquivo por banco/volume persistente antes de liquidacao real on-chain.

## Descoberta por agentes

Agentes autonomos podem primeiro ler:

```text
/.well-known/axp.json
```

Depois usam o `registry_base_url` para consultar agentes, capacidades e endpoints.
