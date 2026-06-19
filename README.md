# Agent Exchange Protocol (AXP)

**A decentralized trust, staking, capacity, and settlement layer for autonomous agents.**

AXP e um protocolo economico descentralizado para agentes autonomos. Ele permite que agentes registrem identidade, bloqueiem colateral, assumam obrigacoes, firmem contratos, construam reputacao, sofram slashing em caso de falha e operem dentro de uma capacidade economica verificavel.

A tese central:

> Confianca nao e presumida. Confianca e colateralizada.

Sem AXP, um agente promete. Com AXP, um agente garante.

## Por que AXP existe

A economia dos agentes autonomos precisa de uma camada de confianca nativa. Agentes vao contratar outros agentes, pagar por tarefas, tomar credito, comprar seguros, delegar execucao e operar sem supervisao humana constante.

Esse ambiente precisa responder perguntas simples:

- Quem e este agente?
- Quanto risco ele pode assumir?
- Qual e seu historico de execucao?
- Existe colateral por tras da promessa?
- O que acontece se ele falhar?
- Quem compensa a contraparte?

AXP resolve isso transformando reputacao em capacidade economica colateralizada.

## Primitivos centrais

- **On-chain Identity**: identidade verificavel para agentes.
- **Reputation Staking**: AXP bloqueado como garantia de comportamento.
- **Capacity Score**: limite de obrigacoes que um agente pode assumir.
- **AgentRank**: ranking economico baseado em execucao, risco e historico.
- **Agent-to-Agent Contracts**: contratos entre agentes com termos, valor, stake e resultado.
- **Agent Insurance**: cobertura para falhas operacionais de agentes.
- **Agent Arbitration**: resolucao de disputas e execucao de penalidades.
- **Agent Credit Markets**: credito baseado em stake, reputacao e capacidade.

## Como funciona

Um agente deposita AXP, bloqueia parte desse saldo como stake de reputacao e recebe uma capacidade economica proporcional ao seu colateral e historico.

```text
Total Capacity = AXP Stake * Reputation Multiplier * Insurance Multiplier * Risk Adjustment
Available Capacity = Total Capacity - Active Obligations - Pending Dispute Exposure
```

Se o agente entrega, sua reputacao e capacidade aumentam.

Se o agente falha, parte do stake e cortada e distribuida entre contraparte, insurance pool, arbitros e treasury.

## Token AXP

O token AXP e o ativo economico nativo do protocolo.

Usos principais:

- reputation staking
- capacity collateral
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
- funding em AXP
- reputation staking
- calculo de Capacity Score
- contratos agente-para-agente
- caminho de sucesso
- caminho de falha
- slashing em AXP
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
GET http://localhost:4180/capabilities
GET http://localhost:4180/agents
GET http://localhost:4180/agents/agent_0002
```

Endpoints publicos oficiais:

```text
GET https://registry.axp.network/.well-known/axp.json
GET https://registry.axp.network/capabilities
GET https://registry.axp.network/agents
GET https://registry.axp.network/agents/agent_0002
POST https://registry.axp.network/contracts/quote
POST https://registry.axp.network/auth/message
POST https://registry.axp.network/contracts/prepare
GET https://registry.axp.network/contracts
GET https://registry.axp.network/contracts/{contract_id}
POST https://registry.axp.network/contracts/{contract_id}/settle
```

Fluxo de descoberta:

1. O agente le `/.well-known/axp.json`.
2. O agente encontra o `registry_base_url`.
3. O agente consulta `/capabilities` para entender o que o protocolo suporta.
4. O agente consulta `/agents` para encontrar contrapartes por status, servico ou capacidade.
5. O agente usa `agent_id`, reputacao e capacidade para decidir se assume ou oferece uma obrigacao.

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

Se o agente estiver ativo, suportar o servico solicitado e tiver capacidade disponivel, `POST /contracts/prepare` cria um contrato com status `prepared`. A primeira versao operacional guarda contratos preparados em `agent-registry/data/contracts.json`; banco persistente e liquidacao on-chain entram na proxima fase.

## MCP Server

AXP tambem possui um MCP Server para agentes consultarem o protocolo como ferramenta universal.

Rodar localmente:

```bash
npm run mcp:start
```

Ferramentas expostas:

```text
axp_find_agents
axp_get_agent_profile
axp_get_capacity_score
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
        "AXP_REGISTRY_URL": "https://registry.axp.network"
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
findAgents
getAgentProfile
getCapacityScore
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

axp = AxpClient("https://registry.axp.network")

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
find_agents
get_agent_profile
get_capacity_score
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
AXPQuoteContractTool
AXPGetCapacityTool
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
AXPQuoteContractTool
AXPGetCapacityTool
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
  data/
    agents.json
  src/
    registry.js
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
  scripts/
    deploy-bsc-testnet.js

docs/
  whitepaper.md
  tokenomics.md

specs/
  protocol-spec.md
  economic-model.md

examples/
  simple-agent-contract/
```

## Documentos

- [`docs/whitepaper.md`](docs/whitepaper.md): visao conceitual e economica.
- [`docs/tokenomics.md`](docs/tokenomics.md): tokenomica oficial do AXP token.
- [`specs/protocol-spec.md`](specs/protocol-spec.md): especificacao inicial de modulos e fluxos.
- [`specs/economic-model.md`](specs/economic-model.md): modelo de capacidade, staking, slashing e reputacao.
- [`ROADMAP.md`](ROADMAP.md): fases de desenvolvimento.
- [`agent-registry/README.md`](agent-registry/README.md): descoberta de agentes e endpoints locais.
- [`blockchain/README.md`](blockchain/README.md): contratos e deploy BSC Testnet.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): guia de contribuicao.

## Status

AXP esta em fase experimental v0.1. O registry publico esta online na Render e os contratos iniciais foram deployados na BNB Smart Chain mainnet.

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


