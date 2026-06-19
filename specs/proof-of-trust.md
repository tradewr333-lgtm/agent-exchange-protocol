# AXP Proof of Trust

## Conceito

Proof of Trust e a tese economica do AXP para medir confianca criada por agentes autonomos.

Bitcoin recompensa energia gasta.

Ethereum recompensa capital travado.

AXP busca medir confianca economica criada.

Em v0.2, Proof of Trust e uma especificacao e metrica de ranking. Qualquer emissao futura de AXP baseada nessa metrica exigiria formulas auditadas, resistencia a abuso e aprovacao de governanca.

## Formula base

```text
Proof of Trust Score = Trust Created - Trust Destroyed
```

## Trust Created

Trust Created mede valor economico entregue sem incidente.

Entradas iniciais:

- settled_volume_usd
- success_rate
- counterparty_diversity
- time_weight
- dispute_free_streak

Formula conceitual:

```text
Trust Created =
Settled Volume USD
* Success Rate
* Counterparty Diversity Multiplier
* Time Weight
```

## Trust Destroyed

Trust Destroyed mede dano economico, falhas e risco imposto a contrapartes.

Entradas iniciais:

- failed_volume_usd
- disputes_lost
- late_delivery_penalties
- slashing_events
- fraud_flags

Formula conceitual:

```text
Trust Destroyed =
Failed Volume USD
+ Dispute Penalties
+ Delay Penalties
+ Slashing Penalties
+ Fraud Penalties
```

## Counterparty Diversity

Diversidade e essencial para reduzir wash trading e contratos artificiais.

Um agente que negocia com uma unica contraparte nao deve receber o mesmo peso de um agente que entrega valor para muitas contrapartes independentes.

Sinal sugerido:

```text
Counterparty Diversity Multiplier =
min(1, log(1 + unique_counterparties) / target_diversity_log)
```

## Anti-abuse

Proof of Trust nao deve recompensar volume bruto sozinho.

Mitigacoes necessarias:

- detectar circularidade entre contrapartes
- limitar peso de contrapartes relacionadas
- reduzir peso de contratos sem disputa mas com baixa diversidade
- exigir tempo minimo para score maduro
- aplicar penalidade severa para falhas e fraude
- separar volume liquidado de volume preparado

## Uso no AXP

Proof of Trust pode alimentar:

- AXP Trust Score
- AgentRank
- Capacity Score
- fee discounts
- insurance pricing
- credit limits
- future governance weight

## Emissao futura

Em v0.2, nao ha emissao ativa baseada em Proof of Trust.

Uma politica futura poderia distribuir AXP com base na participacao de cada agente no Trust Score global, mas somente se:

- houver receita real;
- houver formulas auditadas;
- houver protecao anti-spam;
- houver governanca;
- houver simulacoes publicas;
- houver limites de emissao claros.

## Frase central

AXP is the trust and risk layer for agentic AI.

Em portugues:

AXP e a camada de confianca e risco da economia dos agentes autonomos.
