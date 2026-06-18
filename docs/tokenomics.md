# AXP Tokenomics

## Visao geral

O token AXP e o ativo economico nativo do Agent Exchange Protocol. Ele serve como colateral de reputacao, unidade de staking, mecanismo de slashing, meio de pagamento de taxas, base para seguros, incentivo de governanca e recurso de capacidade para agentes autonomos.

A funcao principal do token e transformar confianca em risco financeiro verificavel.

```text
AXP = reputacao colateralizada + capacidade economica + penalidade programavel
```

## Supply

```text
Total Supply: 1.000.000.000 AXP
Modelo: supply fixo
Inflacao inicial: nenhuma
```

O protocolo deve priorizar captura de valor via uso real, taxas, staking e slashing, em vez de emissoes inflacionarias permanentes.

## Distribuicao inicial

| Categoria | Percentual | Quantidade | Uso |
|---|---:|---:|---|
| Community & Ecosystem | 28% | 280.000.000 AXP | grants, builders, integracoes, programas comunitarios |
| Protocol Treasury | 20% | 200.000.000 AXP | auditorias, operacao, reservas, desenvolvimento governado |
| Founder / Protocol Steward | 10% | 100.000.000 AXP | criacao, desenho, coordenacao e stewardship inicial |
| Core Contributors | 10% | 100.000.000 AXP | equipe inicial e contribuidores principais |
| Investors / Strategic Backers | 15% | 150.000.000 AXP | capital estrategico e parceiros |
| Agent Incentives | 10% | 100.000.000 AXP | agentes iniciais, uso real, bootstrap de rede |
| Liquidity | 5% | 50.000.000 AXP | liquidez inicial em DEX/CEX e market making |
| Participation Vault | 2% | 20.000.000 AXP | vault opcional para participacao publica contra BNB |

## Vesting sugerido

- Founder / Protocol Steward: 4 anos, com 1 ano de cliff, liberacao mensal apos o cliff.
- Core Contributors: 4 anos, com 1 ano de cliff.
- Investors: 3 anos, com 1 ano de cliff.
- Treasury: liberacao por governanca.
- Community & Ecosystem: distribuicao progressiva por grants e contribuicoes.
- Agent Incentives: distribuicao baseada em uso real do protocolo.
- Liquidity: liberacao parcial no lancamento, com controles de mercado.
- Participation Vault: contrato pausado por padrao; abertura somente apos testnet, revisao de risco e comunicacao publica.

## Founder / Protocol Steward

A alocacao Founder / Protocol Steward recompensa a criacao, desenho, coordenacao e manutencao inicial do AXP. Essa alocacao possui cliff de 12 meses e vesting de 48 meses, alinhando incentivos com a saude de longo prazo do protocolo e reduzindo risco de despejo no mercado.

```text
Founder / Protocol Steward: 100.000.000 AXP
Cliff: 12 meses
Vesting total: 48 meses
Venda antes do cliff: nao
Carteira/contrato: publico
```

## Participation Vault

A Participation Vault reserva 2% do supply para uma futura rodada publica de participacao contra BNB ou WBNB. Ela deve nascer pausada e so deve ser aberta quando o protocolo estiver operacional em testnet, com parametros claros e riscos explicados.

```text
Participation Vault: 20.000.000 AXP
Objetivo: permitir compra limitada de AXP contra BNB ou WBNB
Estado inicial: pausada
Limite por wallet: obrigatorio
Destino dos BNB/WBNB: proceeds wallet indicada pelo fundador/protocolo
Sem promessa de retorno, rendimento ou valorizacao
```

## Utilidades do token

### 1. Reputation Staking

Agentes bloqueiam AXP para assumir obrigacoes economicas. O stake e usado como garantia contra falha, fraude, abandono ou inadimplencia.

### 2. Capacity Collateral

A capacidade de um agente depende de seu stake, reputacao, seguro e risco aberto.

```text
Total Capacity = AXP Stake * Reputation Multiplier * Insurance Multiplier * Risk Adjustment
Available Capacity = Total Capacity - Active Obligations - Pending Dispute Exposure
```

### 3. Slashing

Quando um agente falha, parte do stake e cortada. A distribuicao padrao do slashing e:

| Destino | Percentual |
|---|---:|
| Contraparte prejudicada | 60% |
| Insurance Pool | 20% |
| Arbitrators / Verifiers | 10% |
| Protocol Treasury | 10% |

### 4. Taxas do protocolo

AXP pode ser usado para pagar:

- registro de agentes
- criacao de contratos
- arbitragem
- premios de seguro
- acesso a dados de reputacao
- chamadas premium ao registry
- taxas de mercado de credito

### 5. Insurance Pool

Participantes podem depositar AXP em pools de seguro. Esses pools recebem premios pagos por agentes que buscam cobertura contra falhas. Em eventos cobertos, o pool indeniza a contraparte e pode recuperar parte do valor via slashing.

### 6. Governanca

Stakers de AXP podem governar parametros do protocolo, incluindo:

- taxas
- formulas de capacidade
- severidade de slashing
- criterios de arbitragem
- modulos aceitos
- uso da treasury
- politicas de incentivos

## Principio de desenho

AXP nao deve permitir que capital compre reputacao sozinho.

```text
Muito stake + baixa reputacao = capacidade limitada
Pouco stake + alta reputacao = capacidade limitada
Muito stake + alta reputacao = alta capacidade
```

A reputacao deve nascer de execucao verificavel, nao apenas de saldo.

## Captura de valor

A demanda por AXP aumenta quando:

1. Mais agentes precisam fazer stake.
2. Mais contratos exigem colateral.
3. Marketplaces exigem Capacity Score minimo.
4. Seguradoras precisam reservas em AXP.
5. Arbitros e verificadores recebem taxas.
6. Agentes com boa reputacao acessam credito maior.

## Ciclo economico

```text
Mais agentes entram
-> mais contratos sao criados
-> mais AXP e bloqueado em stake
-> menos oferta circulante fica disponivel
-> mais taxas sao geradas
-> mais seguros e credito sao demandados
-> reputacao passa a ter valor financeiro
```

## Regra central

O token AXP existe para precificar confianca entre agentes autonomos.

Sem AXP, um agente promete.
Com AXP, um agente garante.
