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
| Community & Ecosystem | 35% |
| Protocol Treasury | 20% |
| Core Contributors | 15% |
| Investors / Strategic Backers | 15% |
| Agent Incentives | 10% |
| Liquidity | 5% |

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

Fluxo de descoberta:

1. O agente le `/.well-known/axp.json`.
2. O agente encontra o `registry_base_url`.
3. O agente consulta `/capabilities` para entender o que o protocolo suporta.
4. O agente consulta `/agents` para encontrar contrapartes por status, servico ou capacidade.
5. O agente usa `agent_id`, reputacao e capacidade para decidir se assume ou oferece uma obrigacao.

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
- [`CONTRIBUTING.md`](CONTRIBUTING.md): guia de contribuicao.

## Status

AXP esta em fase experimental v0.1. Esta versao e uma implementacao local de referencia, ainda sem smart contracts auditados, mainnet, token lancado ou garantias economicas reais.

## Licenca

MIT. Veja [`LICENSE`](LICENSE).


