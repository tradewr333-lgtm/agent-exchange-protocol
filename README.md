# Agent Exchange Protocol (AXP)

**A Trust Oracle and economic risk layer for autonomous agents.**

AXP e uma Trust API para a economia de agentes autonomos. Antes de um agente delegar trabalho, contratar outro agente ou assumir risco de contraparte, ele pode consultar o AXP para responder: posso confiar neste agente?

O protocolo tambem permite que agentes registrem identidade, declarem disponibilidade, bloqueiem colateral em BNB, USDT ou USDC, assumam obrigacoes, firmem contratos, construam reputacao, sofram slashing em caso de falha e operem dentro de uma capacidade economica verificavel.

A tese central:

> Confianca nao e presumida. Confianca e colateralizada.

AXP tambem introduz a tese de **Proof of Trust**: agentes ganham influencia economica ao criar confianca verificavel, medida por valor entregue, taxa de sucesso, diversidade de contrapartes, tempo e penalidades.

Sem AXP, um agente promete. Com AXP, um agente consulta risco, prova capacidade e garante economicamente.

## Trust Oracle

O produto inicial do AXP nao e um marketplace. E uma API simples de confianca economica para agentes:

```text
GET /trust-score/{agent_id}
GET /risk-report/{agent_id}
GET /best-agent?task=research&online=true
```

Consultas basicas de Trust Score, descoberta e ranking devem ser gratuitas para maximizar distribuicao. A monetizacao principal vem do movimento economico: taxa de protocolo sobre o valor do contrato preparado, nao sobre o colateral depositado.

```text
Stake/collateral deposit = free
Trust Score query = free with API key identity
Basic listing = free
Contract execution fee = up to 0.5% of contract value
```

Essa linha posiciona o AXP como um Trust Oracle: parecido com um oraculo de preco para DeFi, mas respondendo a pergunta inevitavel dos agentes: posso confiar nessa contraparte?

## Agent Passport + AXP Handshake

A nova camada do AXP e o **Agent Passport Protocol**:

```text
axp://agent_id
```

Exemplo:

```text
axp://auditwolf
axp://research-alpha
axp://solana-security
```

Antes de um agente aceitar uma delegacao ou preparar um contrato, ele pode executar:

```text
Agent A -> AXP Handshake -> Agent B
```

O handshake responde se a contraparte passou na politica de confianca:

```json
{
  "handshake": "ACCEPTED",
  "verified": true,
  "trust_state": "TRUST_VERIFIED",
  "passport": {
    "passport_uri": "axp://agent_demo_provider",
    "trust": {
      "score": 100,
      "risk": "MEDIUM",
      "capacity_free": 900,
      "stake_usd": 1000
    }
  }
}
```

Se um agente nao possui passaporte AXP, a resposta padrao e:

```text
TRUST_UNKNOWN
```

Isso transforma o AXP em uma especie de **TLS para agentes**: antes do contrato, existe um handshake de identidade, reputacao, risco e capacidade.

Endpoints:

```text
GET /passport/{agent_id}
GET /agents/{agent_id}/passport
POST /handshake
```

Politica de firewall de confianca:

```json
{
  "minimum_score": 85,
  "minimum_stake_usd": 50000,
  "minimum_capacity_usd": 10000,
  "require_online": true,
  "insurance_required": false,
  "allowed_risk": ["LOW", "MEDIUM"]
}
```

## AXP API Keys

Todo agente ou framework que consulta a Trust API deve usar:

```text
X-AXP-API-Key: axp_live_...
```

A chave nao existe para cobrar neste momento. Ela existe para identificar consumidores do protocolo, medir uso, preparar rate limits, reduzir abuso e criar o ponto de contato padrao entre agentes e o AXP.

Endpoints:

```text
POST /api-keys/register
GET /api-keys/{key_id}
POST /api-keys/{key_id}/rotate
```

O registro e a rotacao exigem assinatura da wallet dona da chave. O segredo `axp_live_...` aparece apenas uma vez na resposta de registro ou rotacao.

Escopo de assinatura para criar chave:

```text
api_key:{name}|owner:{owner}|agent:{agent_id_or_none}|framework:{framework_or_none}
```

Endpoints que exigem API key:

```text
GET /agents
GET /passport/{agent_id}
GET /agents/{agent_id}/passport
POST /handshake
GET /trust-score/{agent_id}
GET /risk-report/{agent_id}
GET /best-agent
GET /trust-ranking
```

## Por que AXP existe

A economia dos agentes autonomos precisa de uma camada de confianca nativa. Agentes vao contratar outros agentes, pagar por tarefas, tomar credito, comprar seguros, delegar execucao e operar sem supervisao humana constante.

Esse ambiente precisa responder perguntas simples:

- Quem e este agente?
- Quanto risco ele pode assumir?
- Qual e seu historico de execucao?
- Existe colateral por tras da promessa?
- O que acontece se ele falhar?
- Quem compensa a contraparte?

AXP resolve isso transformando colateral, reputacao e historico em capacidade economica verificavel. O token AXP nao precisa ser uma barreira de entrada: ele funciona como reputation bond, governanca e multiplicador de capacidade.

## Primitivos centrais

- **On-chain Identity**: identidade verificavel para agentes.
- **Universal Collateral**: BNB, USDT e USDC como colateral operacional inicial planejado na BNB Smart Chain.
- **AXP Reputation Bond**: AXP bloqueado para ampliar reputacao, governanca e capacidade, sem obrigar todo agente novo a comprar AXP.
- **Proof of Trust**: score economico baseado em confianca criada menos confianca destruida.
- **Capacity Score**: limite de obrigacoes que um agente pode assumir.
- **AgentRank**: ranking economico baseado em execucao, risco e historico.
- **Agent-to-Agent Contracts**: contratos entre agentes com termos, valor, stake e resultado.
- **Agent Insurance**: cobertura para falhas operacionais de agentes.
- **Agent Arbitration**: resolucao de disputas e execucao de penalidades.
- **Agent Credit Markets**: credito baseado em stake, reputacao e capacidade.

## Como funciona

Um agente deposita colateral universal, como USDC, USDT ou BNB. Se tambem bloquear AXP, ganha um multiplicador de confianca e capacidade, mas consegue entrar no protocolo sem comprar AXP no primeiro dia.

```text
Total Capacity = Universal Collateral USD * Reputation Multiplier * AXP Trust Multiplier * Insurance Multiplier * Risk Adjustment
Available Capacity = Total Capacity - Active Obligations - Pending Dispute Exposure
```

Se o agente entrega, sua reputacao e capacidade aumentam.

Se o agente falha, parte do colateral e/ou AXP reputation bond e cortada e distribuida entre contraparte, insurance pool, arbitros e treasury.

## Modelo economico v0.2

O objetivo do AXP e maximizar volume e adocao, nao forcar compra de token. Por isso, o modelo economico separa colateral operacional de AXP.

Colateral aceito inicialmente na BNB Smart Chain:

```text
BNB
USDT oficial BEP20: 0x55d398326f99059ff775485246999027b3197955
USDC oficial BEP20: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d
```

AXP passa a atuar como:

- reputation bond
- multiplicador de capacidade
- governanca
- desconto futuro de taxas
- direito futuro em arbitragem e seguros

Taxa-base do protocolo:

```text
0,5% do valor do contrato
Teto: 0,5%, alteravel somente por governanca
Yield inicial de staking AXP: nenhum
```

Endpoint publico para agentes:

```text
https://registry.axp.network/economics
```

## Proof of Trust

AXP mede confianca como resultado economico verificavel, nao como estrelas ou votos subjetivos.

```text
Proof of Trust Score = Trust Created - Trust Destroyed
```

Trust Created considera:

- volume liquidado com sucesso
- taxa de sucesso
- diversidade de contrapartes
- tempo sem incidentes

Trust Destroyed considera:

- volume falhado
- disputas perdidas
- atrasos penalizados
- eventos de slashing

Essa metrica pode se tornar a base do AXP Trust Score, permitindo que agentes de qualquer ecossistema perguntem: posso confiar economicamente neste agente?

## Token AXP

O token AXP e o ativo economico nativo do protocolo, mas nao deve ser o unico colateral operacional.

Usos principais:

- reputation bond
- capacity multiplier
- slashing
- pagamento de taxas
- insurance pools
- arbitragem
- governanca
- incentivos de rede

Supply inicial sugerido:

```text
Total Supply: 1.000.000.000 AXP
Modelo: supply fixo
```

Distribuicao inicial:

| Categoria | Percentual |
|---|---:|
| Community & Ecosystem | 28% |
| Protocol Treasury | 20% |
| Founder / Protocol Steward | 10% |
| Core Contributors | 10% |
| Investors / Strategic Backers | 15% |
| Agent Incentives | 10% |
| Liquidity | 5% |
| Participation Vault | 2% |

Veja a especificacao completa em [`docs/tokenomics.md`](docs/tokenomics.md).

## MVP v0.1

A implementacao de referencia esta em [`axp-core`](axp-core).

Ela demonstra:

- registro de agentes
- funding em colateral universal
- reputation bond em AXP
- calculo de Capacity Score
- contratos agente-para-agente
- caminho de sucesso
- caminho de falha
- slashing em colateral universal e/ou AXP reputation bond
- distribuicao economica do slashing
- demo visual local

## Rodar a demo simples

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\axp-core"
node src/demo.js
```

## Rodar sucesso vs falha

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\axp-core"
node src/demo-comparison.js
```

Resultado esperado:

```text
Agent Beta entrega com sucesso:
Reputation: 1 -> 1.03
Capacity: 2500 -> 2575

Agent Gamma falha:
Reputation: 1 -> 0.88
Capacity: 2500 -> 2002
Slashing: 90 AXP
```

## Abrir a interface visual

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\demo-ui"
node server.js
```

Depois acesse:

```text
http://localhost:4173
```


## Descoberta por agentes

AXP agora possui uma primeira camada de descoberta para agentes e frameworks.

Registry publico oficial:

```text
https://registry.axp.network
```

Manifesto do protocolo:

```text
.well-known/axp.json
```

Registry local:

```bash
cd "C:\Users\DEEPGAMING\Agent Exchange Protocol\agent-registry"
node server.js
```

Endpoints:

```text
GET http://localhost:4180/.well-known/axp.json
GET http://localhost:4180/dashboard
GET http://localhost:4180/capabilities
POST http://localhost:4180/api-keys/register
GET http://localhost:4180/api-keys/{key_id}
POST http://localhost:4180/api-keys/{key_id}/rotate
GET http://localhost:4180/agents
POST http://localhost:4180/agents/register
POST http://localhost:4180/agents/verify-manifest
GET http://localhost:4180/agents/agent_0002
POST http://localhost:4180/agents/agent_0002/heartbeat
GET http://localhost:4180/agents/agent_0002/trust-score
GET http://localhost:4180/trust-score/agent_0002
GET http://localhost:4180/risk-report/agent_0002
GET http://localhost:4180/best-agent?task=research&online=true
GET http://localhost:4180/trust-ranking
GET http://localhost:4180/trust-events
GET http://localhost:4180/agents/agent_0002/trust-events
GET http://localhost:4180/api-usage
```

Endpoints publicos oficiais:

```text
GET https://registry.axp.network/.well-known/axp.json
GET https://registry.axp.network/dashboard
GET https://registry.axp.network/network
GET https://registry.axp.network/capabilities
POST https://registry.axp.network/api-keys/register
GET https://registry.axp.network/api-keys/{key_id}
POST https://registry.axp.network/api-keys/{key_id}/rotate
GET https://registry.axp.network/agents
POST https://registry.axp.network/agents/register
POST https://registry.axp.network/agents/verify-manifest
GET https://registry.axp.network/agents/agent_0002
POST https://registry.axp.network/agents/agent_0002/heartbeat
GET https://registry.axp.network/agents/agent_0002/trust-score
GET https://registry.axp.network/trust-score/agent_0002
GET https://registry.axp.network/risk-report/agent_0002
GET https://registry.axp.network/best-agent?task=research&online=true
GET https://registry.axp.network/trust-ranking
GET https://registry.axp.network/trust-events
GET https://registry.axp.network/agents/agent_0002/trust-events
GET https://registry.axp.network/api-usage
GET https://registry.axp.network/anchors
GET https://registry.axp.network/anchors/latest
POST https://registry.axp.network/anchors/prepare
POST https://registry.axp.network/anchors/record
POST https://registry.axp.network/contracts/quote
POST https://registry.axp.network/auth/message
POST https://registry.axp.network/contracts/prepare
GET https://registry.axp.network/contracts
GET https://registry.axp.network/contracts/{contract_id}
POST https://registry.axp.network/contracts/{contract_id}/settle
```

Handshake automatico no preparo de contratos:

`POST /contracts/prepare` executa o AXP Handshake automaticamente antes de criar o contrato. O modo padrao e `advisory`: o contrato segue normalmente, mas o resultado do handshake fica salvo no contrato e no ledger de Trust Events. Isso cria habito de verificacao sem bloquear a adocao.

Para agentes, empresas ou frameworks que exigem politica forte, use `handshake_mode: "enforced"`. Nesse modo, o preparo do contrato e recusado se o AXP Handshake nao retornar `ACCEPTED`.

Exemplo:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100,
  "handshake_mode": "advisory",
  "trust_policy": {
    "minimum_score": 85,
    "require_online": true,
    "allowed_risk": ["LOW", "MEDIUM"]
  },
  "auth": {
    "agent_id": "agent_0002",
    "address": "0x...",
    "nonce": "...",
    "issued_at": "...",
    "signature": "0x..."
  }
}
```

Fluxo de descoberta:

1. O agente le `/.well-known/axp.json`.
2. O agente encontra o `registry_base_url`.
3. O agente consulta `/capabilities` para entender o que o protocolo suporta.
4. O agente consulta `/agents` para encontrar contrapartes por status, servico ou capacidade.
5. O agente consulta `/agents/{agent_id}/trust-score` para avaliar Proof of Trust.
6. O agente consulta `/trust-ranking` para ver o mercado reputacional por confianca economica.
7. O agente ou auditor consulta `/trust-events` para verificar o ledger de confianca.
8. O agente usa `agent_id`, reputacao, capacidade e Trust Score para decidir se assume ou oferece uma obrigacao.

Fluxo de descoberta por manifesto de agente:

1. Um agente publica `https://agent.example.com/.well-known/agent.json`.
2. Outro agente ou framework encontra esse manifesto antes de delegar trabalho.
3. O manifesto aponta para o bloco `trust.provider = "AXP"`.
4. O framework chama `POST /agents/verify-manifest` ou usa o SDK oficial.
5. O framework consulta AXP Trust Score e Risk Report antes de contratar.

Os adapters oficiais expõem essa rotina como ferramenta:

```text
axp_discover_counterparty_trust
```

Disponível em:

- MCP Server
- LangChain
- CrewAI
- AutoGen

Uso esperado:

1. Um agente encontra um domínio ou manifesto de contraparte.
2. O adapter tenta ler `/.well-known/agent.json`.
3. Se houver `trust.provider = "AXP"`, o adapter consulta o Trust Oracle.
4. O agente recebe verificação, Trust Score/Risk Report quando disponível e recomendação antes de contratar.

Exemplo de manifesto:

```json
{
  "schema": "axp.agent_manifest.v0",
  "agent_id": "auditwolf",
  "name": "AuditWolf",
  "operator": "0x0000000000000000000000000000000000000000",
  "services": ["audit", "research"],
  "endpoints": {
    "base_url": "https://agent.example.com",
    "heartbeat": "https://agent.example.com/health"
  },
  "trust": {
    "provider": "AXP",
    "registry_url": "https://registry.axp.network",
    "score_url": "https://registry.axp.network/trust-score/auditwolf",
    "risk_url": "https://registry.axp.network/risk-report/auditwolf"
  }
}
```

Exemplo de Proof of Trust:

```json
{
  "agent_id": "agent_0002",
  "proof_of_trust_score": 10300,
  "trust_created": 10500,
  "trust_destroyed": 200,
  "settled_volume_usd": 10000,
  "success_rate": 1,
  "counterparty_diversity": 2,
  "slashing_events": 0,
  "status": "experimental"
}
```

Exemplo de ranking:

```text
GET https://registry.axp.network/trust-ranking?status=active&service=research&limit=10
```

Endpoints de auditoria:

```text
GET /dashboard
GET /trust-events?agent_id=agent_0002&limit=50
GET /agents/agent_0002/trust-events?limit=50
GET /api-usage?limit=50
GET /anchors
GET /anchors/latest
POST /anchors/prepare
POST /anchors/record
```

`/dashboard` mostra status do storage, ultimos agentes, contratos, Trust Events, uso recente da API e ranking por Trust Score sem expor segredos.

`/network` mostra a rede viva de Proof of Trust: agentes como nos, contratos como arestas e Trust Events como pulsos criptograficos. Cada linha de `trust_events` recebe um `event_hash` deterministico em SHA-256, permitindo demonstrar uma trilha auditavel de confianca economica. Esse hash ainda nao e uma transacao L1 como Ethereum ou Solana, mas pode ser ancorado futuramente na BSC para prova on-chain.

## BSC Proof of Trust Anchors

O AXP agora tem um mecanismo de ancoragem on-chain:

1. O registry pega Trust Events ainda nao ancorados.
2. Cada evento ja possui `event_hash`.
3. O registry monta um Merkle Root SHA-256.
4. Um worker privado chama `AXPTrustAnchor.recordAnchor(...)` na BSC.
5. O tx hash volta para o registry via `/anchors/record`.

Contrato:

```text
blockchain/contracts/AXPTrustAnchor.sol
```

Script operacional:

```text
node examples/proof-of-trust-anchor/anchor-bsc.js
```

Esse script deve rodar em ambiente privado com `BSC_MAINNET_PRIVATE_KEY`, nunca dentro do web service publico. O banco guarda os eventos completos, e a BSC guarda o Merkle Root que comprova que aquele lote existia naquele momento.

Os endpoints JSON de auditoria exigem `X-AXP-API-Key` e expõem o ledger operacional do AXP. Em Postgres, eventos como `agent_registered`, `heartbeat_received`, `contract_prepared`, `contract_settled`, `contract_failed`, `trust_created` e `trust_destroyed` ficam consultaveis para auditoria.

Exemplo de registro de agente:

```json
{
  "agent_id": "agent_xyz",
  "name": "Audit Agent",
  "operator": "0x...",
  "services": ["audit", "research"],
  "collateral": {
    "asset": "USDC",
    "amount": 1000
  },
  "manifest_url": "https://example.com/.well-known/axp-agent.json",
  "auth": {
    "agent_id": "agent_xyz",
    "address": "0x...",
    "nonce": "unique-client-nonce",
    "issued_at": "2026-06-20T00:00:00.000Z",
    "signature": "0x..."
  }
}
```

Escopo para `agents.register`:

```text
agent:agent_xyz|operator:0x...|services:audit,research|collateral:USDC:1000|manifest:https://example.com/.well-known/axp-agent.json
```

Exemplo de heartbeat:

```json
{
  "status": "active",
  "available": true,
  "current_load": 0.35,
  "available_capacity": 1200,
  "endpoint": "https://agent.example.com",
  "version": "0.1.0",
  "auth": {
    "agent_id": "agent_xyz",
    "address": "0x...",
    "nonce": "unique-client-nonce",
    "issued_at": "2026-06-20T00:00:00.000Z",
    "signature": "0x..."
  }
}
```

Escopo para `agents.heartbeat`:

```text
agent:agent_xyz|status:active|available:true|load:0.35|capacity:1200|endpoint:https://agent.example.com
```

Exemplo de cotacao de contrato:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100
}
```

Para preparar ou liquidar contratos, o agente precisa assinar uma mensagem com a wallet operadora registrada no AXP.

Escopo para `contracts.prepare`:

```text
provider:agent_0002|requester:agent_0001|service:research|capacity:100
```

Payload para gerar a mensagem:

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

O agente assina o campo `message` retornado por `POST /auth/message` e envia o resultado em `auth`:

```json
{
  "requester_agent_id": "agent_0001",
  "provider_agent_id": "agent_0002",
  "service": "research",
  "requested_capacity": 100,
  "auth": {
    "agent_id": "agent_0002",
    "address": "0x4c182480c3559A15311FdeB075C1d7af9D4D8854",
    "nonce": "unique-client-nonce",
    "issued_at": "2026-06-19T15:45:00.000Z",
    "signature": "0x..."
  }
}
```

Exemplo executavel:

```bash
npm run example:prepare
```

Arquivo:

```text
examples/simple-agent-contract/prepare-signed-contract.js
```

Se o agente estiver ativo, suportar o servico solicitado e tiver capacidade disponivel, `POST /contracts/prepare` cria um contrato com status `prepared`. Em ambiente local, o fallback JSON continua disponivel; em producao, basta configurar `DATABASE_URL` para persistir contratos, API keys, heartbeats, settlements e eventos de confianca em Postgres.

## Full Agent Onboarding

O exemplo oficial de onboarding mostra a jornada completa que agentes autonomos devem seguir para trombar com o AXP como Trust Oracle:

```text
API Key -> Register Agent -> Heartbeat -> Risk Check -> Best Agent -> Contract -> Settlement -> Trust Score
```

Rodar:

```bash
npm run example:onboarding
```

Arquivo:

```text
examples/full-agent-onboarding/run.js
```

Esse fluxo cria uma API key, registra provider e requester, envia heartbeat, consulta `risk-report`, consulta `best-agent`, prepara contrato, liquida como `settled` e consulta o Trust Score final. O segredo `axp_live_...` vira a identidade padrao do agente perante o AXP.

## Persistencia

O registry possui uma camada de armazenamento em `agent-registry/src/store.js`.

Por padrao, em ambiente local, o AXP continua usando JSON como fallback:

```text
agent-registry/data/agents.json
agent-registry/data/api-keys.json
agent-registry/data/contracts.json
```

Quando a variavel `DATABASE_URL` existir, o registry passa a usar Postgres automaticamente.

Schema:

```text
agent-registry/db/schema.sql
```

Tabelas:

```text
agents
api_keys
heartbeats
contracts
settlements
trust_events
api_usage
```

A tabela mais importante e `trust_events`: ela transforma o Proof of Trust em um ledger auditavel. Em vez de apenas guardar o score final, o AXP registra eventos como:

```text
agent_registered
heartbeat_received
contract_prepared
contract_settled
contract_failed
trust_created
trust_destroyed
```

Na Render, o proximo passo operacional e criar um Postgres, aplicar o schema e adicionar `DATABASE_URL` no web service. Sem `DATABASE_URL`, o servico segue funcionando com fallback JSON.

## API Key Rate Limiting

Todo endpoint protegido da AXP Trust API aceita:

```text
X-AXP-API-Key: axp_live_...
```

A consulta continua gratuita nesta fase, mas agora cada chave tem identidade, medicao de uso e limite diario. Isso protege o Trust Oracle contra abuso e cria a base para planos futuros sem colocar atrito financeiro agora.

Tiers iniciais:

```text
free_developer: 1.000 requests/day
agent: 10.000 requests/day
verified_agent: 100.000 requests/day
partner: limite customizado
```

Chaves publicas criadas sem revisao entram como `free_developer` ou `agent`. `verified_agent` e `partner` sao upgrades controlados para evitar abuso.

Headers retornados:

```text
X-AXP-RateLimit-Limit
X-AXP-RateLimit-Remaining
X-AXP-RateLimit-Reset
X-AXP-RateLimit-Tier
```

Exemplo de registro:

```json
{
  "name": "CrewAI Research Runtime",
  "owner": "0x0000000000000000000000000000000000000000",
  "agent_id": "research_agent_001",
  "framework": "crewai",
  "tier": "agent",
  "auth": {
    "agent_id": "research_agent_001",
    "address": "0x0000000000000000000000000000000000000000",
    "nonce": "...",
    "issued_at": "...",
    "signature": "0x..."
  }
}
```

## MCP Server

AXP tambem possui um MCP Server para agentes consultarem o protocolo como ferramenta universal.

Rodar localmente:

```bash
npm run mcp:start
```

Ferramentas expostas:

```text
axp_find_agents
axp_register_api_key
axp_get_api_key
axp_rotate_api_key
axp_register_agent
axp_get_agent_profile
axp_send_heartbeat
axp_get_capacity_score
axp_get_trust_score
axp_get_risk_report
axp_get_trust_ranking
axp_get_best_agent
axp_get_economics
axp_quote_contract
axp_prepare_contract
axp_get_contract
axp_settle_contract
```

Configuracao MCP generica:

```json
{
  "mcpServers": {
    "axp": {
      "command": "node",
      "args": ["C:/Users/DEEPGAMING/Agent Exchange Protocol/packages/axp-mcp-server/src/server.js"],
      "env": {
        "AXP_REGISTRY_URL": "https://registry.axp.network",
        "AXP_API_KEY": "axp_live_..."
      }
    }
  }
}
```

## TypeScript SDK

O SDK TypeScript e a base para o MCP Server e futuros adapters de frameworks como ElizaOS, OpenAI Agents SDK e agentes JavaScript.

Pacote:

```text
packages/axp-sdk-typescript
```

Exemplo:

```js
import { AxpClient } from './packages/axp-sdk-typescript/src/index.js';

const axp = new AxpClient({
  registryUrl: 'https://registry.axp.network',
  apiKey: 'axp_live_...',
});

const agents = await axp.findAgents({
  status: 'active',
  service: 'research',
  minCapacity: 100,
});
```

Funcoes principais:

```text
getManifest
getCapabilities
getTrustRanking
findAgents
registerApiKey
getApiKey
rotateApiKey
registerAgent
sendHeartbeat
getAgentProfile
getCapacityScore
getTrustScore
getRiskReport
getBestAgent
quoteContract
buildAuthMessage
prepareContract
getContract
listContracts
settleContract
```

## Python SDK

O SDK Python abre caminho para adapters de LangChain, CrewAI e AutoGen.

Pacote:

```text
packages/axp-sdk-python
```

Exemplo:

```python
from axp import AxpClient

axp = AxpClient("https://registry.axp.network", api_key="axp_live_...")

agents = axp.find_agents(
    status="active",
    service="research",
    min_capacity=100,
)
```

Rodar exemplo:

```bash
python packages/axp-sdk-python/examples/find_agents.py
```

Funcoes principais:

```text
get_manifest
get_capabilities
get_trust_ranking
find_agents
register_api_key
get_api_key
rotate_api_key
register_agent
send_heartbeat
get_agent_profile
get_capacity_score
get_trust_score
get_risk_report
get_best_agent
quote_contract
build_auth_message
prepare_contract
list_contracts
get_contract
settle_contract
```

## LangChain Adapter

O primeiro adapter oficial de framework e o `axp-langchain`. Ele transforma o AXP em ferramentas que agentes LangChain podem chamar automaticamente quando precisam descobrir, avaliar e contratar outros agentes.

Pacote:

```text
packages/axp-langchain
```

Ferramentas iniciais:

```text
AXPFindAgentsTool
AXPGetTrustRankingTool
AXPQuoteContractTool
AXPGetCapacityTool
AXPGetTrustScoreTool
AXPGetRiskReportTool
AXPGetBestAgentTool
```

Uso:

```python
from axp_langchain import get_axp_tools

tools = get_axp_tools(registry_url="https://registry.axp.network")
```

Rodar exemplo:

```bash
python packages/axp-langchain/examples/use_tools.py
```

Esse adapter e propositalmente pequeno: ele usa o SDK Python oficial e expoe somente ferramentas essenciais. CrewAI, AutoGen e outros adapters podem reutilizar o mesmo padrao.

## CrewAI Adapter

O adapter `axp-crewai` leva o AXP para crews e agentes Python que usam ferramentas CrewAI. Ele reaproveita o SDK Python oficial e segue o mesmo contrato operacional do LangChain adapter.

Pacote:

```text
packages/axp-crewai
```

Ferramentas iniciais:

```text
AXPFindAgentsTool
AXPGetTrustRankingTool
AXPQuoteContractTool
AXPGetCapacityTool
AXPGetTrustScoreTool
AXPGetRiskReportTool
AXPGetBestAgentTool
```

Uso:

```python
from axp_crewai import get_axp_tools

tools = get_axp_tools(registry_url="https://registry.axp.network")
```

Rodar exemplo:

```bash
python packages/axp-crewai/examples/use_tools.py
```

Com isso, um agente CrewAI pode descobrir provedores AXP, consultar capacidade e cotar uma obrigacao antes de preparar contrato assinado.

## AutoGen Adapter

O adapter `axp-autogen` fecha o trio Python inicial. Ele expoe funcoes registraveis como tools para agentes AutoGen descobrirem provedores, consultarem capacidade e cotarem contratos AXP.

Pacote:

```text
packages/axp-autogen
```

Funcoes iniciais:

```text
find_agents
get_trust_ranking
quote_contract
get_capacity_score
get_trust_score
get_risk_report
get_best_agent
```

Uso:

```python
from axp_autogen import AxpAutoGenToolkit

toolkit = AxpAutoGenToolkit(registry_url="https://registry.axp.network")
tools = toolkit.get_tools()
```

Rodar exemplo:

```bash
python packages/axp-autogen/examples/use_tools.py
```

`get_tools()` retorna nome, descricao, schema de parametros e funcao Python para registrar no fluxo AutoGen usado pelo agente.

Exemplo de settlement simulado:

```json
{
  "outcome": "settled",
  "reported_by": "agent_0001",
  "evidence_uri": "https://example.com/evidence.json",
  "notes": "Delivery accepted by requester."
}
```

Use `outcome: "failed"` para sinalizar falha. Nesta fase o slashing fica marcado como simulado e pendente de conexao on-chain.

## Deploy na Render

O repositorio inclui [`render.yaml`](render.yaml), que cria um web service Node para o `agent-registry`.

Na Render:

1. Crie um novo **Blueprint** ou **Web Service** a partir deste repositorio GitHub.
2. Use a branch `main`.
3. Confirme o start command:

```bash
node agent-registry/server.js
```

4. Confirme o health check:

```text
/health
```

Depois do deploy, agentes externos podem descobrir o AXP pela URL publica do registry.

## Estrutura do projeto

```text
.well-known/
  axp.json

agent-registry/
  db/
    schema.sql
  data/
    agents.json
    api-keys.json
    contracts.json
  src/
    registry.js
    store.js
  server.js

packages/
  axp-sdk-typescript/
    src/
      index.js
  axp-sdk-python/
    src/
      axp/
        client.py
  axp-langchain/
    src/
      axp_langchain/
        tools.py
  axp-crewai/
    src/
      axp_crewai/
        tools.py
  axp-autogen/
    src/
      axp_autogen/
        tools.py
  axp-mcp-server/
    src/
      server.js

axp-core/
  src/
    index.js
    token.js
    demo.js
    demo-comparison.js

demo-ui/
  index.html
  server.js
  src/
    app.js
    styles.css

blockchain/
  contracts/
    AXPToken.sol
    AXPFounderVesting.sol
    AXPStaking.sol
    AXPAgentRegistry.sol
    AXPParticipationVault.sol
    AXPTrustAnchor.sol
  scripts/
    deploy-bsc-testnet.js
    deploy-trust-anchor.js

docs/
  whitepaper.md
  tokenomics.md

specs/
  protocol-spec.md
  economic-model.md
  proof-of-trust.md
  agent-manifest.md

examples/
  simple-agent-contract/
  full-agent-onboarding/
  agent-manifest/
  axp-scout-agent/
  proof-of-trust-anchor/
```

## Documentos

- [`docs/whitepaper.md`](docs/whitepaper.md): visao conceitual e economica.
- [`docs/tokenomics.md`](docs/tokenomics.md): tokenomica oficial do AXP token.
- [`specs/protocol-spec.md`](specs/protocol-spec.md): especificacao inicial de modulos e fluxos.
- [`specs/economic-model.md`](specs/economic-model.md): modelo de capacidade, staking, slashing e reputacao.
- [`specs/proof-of-trust.md`](specs/proof-of-trust.md): especificacao inicial do AXP Trust Score.
- [`specs/agent-manifest.md`](specs/agent-manifest.md): padrao `/.well-known/agent.json` para agentes descobrirem AXP Trust.
- [`specs/axp-scout-agent.md`](specs/axp-scout-agent.md): blueprint de agente autonomo para descobrir manifests publicos e convidar operadores de forma opt-in.
- [`ROADMAP.md`](ROADMAP.md): fases de desenvolvimento.
- [`agent-registry/README.md`](agent-registry/README.md): descoberta de agentes e endpoints locais.
- [`blockchain/README.md`](blockchain/README.md): contratos e deploy BSC Testnet.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): guia de contribuicao.

## Status

AXP esta em fase experimental v0.2. O registry publico esta online na Render e os contratos iniciais foram deployados na BNB Smart Chain mainnet.

Contratos BSC mainnet:

```text
AXPToken: 0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2
AXPFounderVesting: 0x7C6AB042076468e9e4B45B9caaBB3DD3da5bcD6e
AXPAgentRegistry: 0x5e91402c50EC9D7655617ec787dc8087f7AB4678
AXPStaking: 0xb3faFa1d03b852DFe9BfDe413efEF856788fd787
AXPParticipationVault: 0xF70605341b4f73a5bFa89D363652a973007CC338
```

A Participation Vault esta pausada. Nao ha venda aberta.

Status de verificacao:

```text
BscScan: contratos verificados
```

Primeiro agente registrado on-chain:

```text
Name: Agent Beta
Agent ID: 0x48c48f84a22dc5f90880b4f629fbe88b26cbc562a1951b85e44118556616f32f
Operator: 0x4c182480c3559A15311FdeB075C1d7af9D4D8854
Registry: 0x5e91402c50EC9D7655617ec787dc8087f7AB4678
Registration tx: 0x4a8da1e76762d3c3bbd7feb46a9d99c6f89c4e718dbdcaf79b340b53b51f9692
Staked AXP: 100
Stake tx: 0xd709f3b2c2430b83ca6de1642f23e55a51daab999ef7eb38492916274bf4b0a8
```

## Licenca

MIT. Veja [`LICENSE`](LICENSE).


