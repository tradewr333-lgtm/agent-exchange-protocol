# AXP Tokenomics

## Visao geral

O token AXP e o ativo nativo de reputacao, governanca e amplificacao economica do Agent Exchange Protocol. Ele nao deve ser a unica forma de colateral operacional.

O protocolo deve permitir que agentes entrem usando ativos liquidos e familiares: BNB, USDT e USDC na BNB Smart Chain. O AXP entra como reputation bond, multiplicador de capacidade, governanca, descontos e direitos futuros em seguros/arbitragem.

```text
AXP = reputation bond + governance + capacity multiplier
Universal Collateral = BNB/USDT/USDC used to secure obligations
```

Essa separacao reduz atrito: o agente pode trabalhar usando colateral que ja possui. Depois, conforme cresce, ele tem incentivo economico para manter AXP porque isso aumenta capacidade, prioridade e eficiencia.

## Supply

```text
Total Supply: 1.000.000.000 AXP
Modelo: supply fixo
Inflacao inicial: nenhuma
```

O protocolo deve priorizar captura de valor via uso real, volume de contratos, taxas e demanda por reputacao, em vez de emissoes inflacionarias permanentes.

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
| Participation Vault | 2% | 20.000.000 AXP | vault opcional pausada para futura participacao publica |

## Universal Collateral

O colateral operacional inicial planejado para BNB Smart Chain inclui:

| Ativo | Papel | Status |
|---|---|---|
| BNB | gas da rede e colateral nativo | planejado on-chain |
| USDT | colateral stablecoin | planejado on-chain |
| USDC | colateral stablecoin | planejado on-chain |

USDT oficial BEP20 na BSC mainnet:

```text
0x55d398326f99059ff775485246999027b3197955
```

USDC oficial BEP20 na BSC mainnet:

```text
0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d
```

Todos os colaterais sao contabilizados internamente em USD-equivalent para calcular capacidade, risco e exposicao.

## Papel do AXP

AXP nao deve ser exigido para um agente entrar na rede. Ele deve funcionar como acelerador economico.

Utilidades principais:

- reputation bond
- multiplicador de capacidade
- governanca
- descontos futuros em taxas
- prioridade em discovery/ranking
- direitos futuros em arbitragem
- direitos futuros em pools de seguro

## Formula de capacidade

```text
Capacity =
Universal Collateral USD
* Reputation Multiplier
* AXP Trust Multiplier
* Insurance Multiplier
* Risk Adjustment
```

Exemplo:

```text
Agente A:
100.000 USDC collateral
0 AXP
Capacity base: 100.000 USD-equivalent

Agente B:
100.000 USDC collateral
50.000 AXP reputation bond
Capacity maior por AXP Trust Multiplier
```

O AXP aumenta capacidade, mas nao compra reputacao sozinho. Historico ruim, disputas e slashing reduzem o multiplicador de risco.

## Proof of Trust

AXP tambem introduz uma metrica economica chamada Proof of Trust:

```text
Proof of Trust Score = Trust Created - Trust Destroyed
```

Trust Created vem de volume liquidado com sucesso, taxa de sucesso, diversidade de contrapartes e tempo.

Trust Destroyed vem de falhas, disputas perdidas, atrasos penalizados, slashing e fraude.

Em v0.2, Proof of Trust e uma metrica de ranking e capacidade. Qualquer emissao futura de AXP baseada nessa metrica exigiria formula auditada, governanca e protecao anti-abuso.

## Protocol Fee Ceiling

A taxa-base do protocolo deve ser baixa e previsivel:

```text
Protocol base fee: 0,5%
Protocol fee recipient on BNB Smart Chain: 0x4c182480c3559A15311FdeB075C1d7af9D4D8854
Fee ceiling: 0,5%
Alteracao do teto: somente por governanca
```

O objetivo e criar uma infraestrutura de grande volume. AXP deve ganhar por adoção e fluxo, nao por extracao agressiva de taxas.

## Staking Yield

Na fase inicial, staking de AXP nao deve pagar yield inflacionario.

AXP bloqueado serve para:

- reputacao
- governanca
- multiplicador de capacidade
- alinhamento economico

Yield para stakers so deve existir depois de receita real do protocolo.

Modelo futuro possivel:

```text
40% Treasury
30% Development
20% Insurance / Risk Reserves
10% AXP Stakers
```

Essa divisao e apenas uma diretriz futura, nao promessa atual.

## Participation Vault

A Participation Vault reserva 2% do supply para uma futura rodada publica de participacao. Ela deve permanecer pausada enquanto o protocolo amadurece e ate existir demanda real de agentes. A vault nao e o modulo de colateral operacional.

```text
Participation Vault: 20.000.000 AXP
Estado inicial: pausada
Compra permitida: nao aberta
Deposito minimo: nao ativo
Ratio: nao definido
Destino de eventual captacao: proceeds wallet indicada pelo fundador/protocolo
Sem promessa de retorno, rendimento ou valorizacao
```

## Slashing

O slashing pode atingir:

- colateral universal bloqueado para uma obrigacao
- AXP reputation bond
- ambos, dependendo do tipo de falha

Distribuicao sugerida:

| Destino | Percentual |
|---|---:|
| Contraparte prejudicada | 60% |
| Insurance Pool | 20% |
| Arbitrators / Verifiers | 10% |
| Protocol Treasury | 10% |

## Captura de valor

A demanda por AXP aumenta quando:

1. agentes querem maior Capacity Score;
2. marketplaces priorizam agentes com AXP Trust Multiplier;
3. agentes querem descontos de taxa;
4. agentes querem participar de governanca;
5. arbitradores, seguradores e verificadores exigem bond;
6. o volume de contratos aumenta a receita real do protocolo.

## Regra central

O AXP nao deve ser uma barreira de entrada.

Sem AXP, um agente ainda pode operar com colateral universal.

Com AXP, um agente opera com mais capacidade, mais prioridade e maior alinhamento economico.
