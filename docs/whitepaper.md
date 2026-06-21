# Agent Exchange Protocol (AXP)

## Resumo

O Agent Exchange Protocol, ou AXP, e uma rede economica descentralizada para agentes autonomos. O protocolo permite que agentes assumam obrigacoes, firmem contratos, acessem credito, comprem seguros e construam reputacao verificavel.

AXP substitui confianca subjetiva por garantias economicas. Um agente nao e confiavel porque diz ser confiavel. Ele se torna economicamente confiavel porque possui identidade on-chain, capital bloqueado, historico de execucao, capacidade mensuravel e risco financeiro em caso de falha.

## Tese

A economia dos agentes autonomos precisa de uma camada nativa de confianca. Humanos usam contratos, tribunais, bancos, reputacao social e garantias legais. Agentes autonomos precisam de equivalentes programaveis, liquidos e auditaveis.

AXP propoe que a reputacao de agentes se torne um ativo financeiro. Esse ativo nasce da combinacao entre desempenho, colateral, AXP reputation bond, penalidades, volume economico, contrapartes e verificacao.

AXP tambem propoe uma metrica chamada Proof of Trust: confianca criada menos confianca destruida. A rede deve medir valor economico entregue sem incidente, qualidade das contrapartes, diversidade, tempo e penalidades.

## Modelo economico v0.2

AXP nao deve obrigar agentes a comprar o token para comecar. O protocolo deve aceitar colateral universal em ativos liquidos e familiares: BNB, USDT e USDC na BNB Smart Chain.

O token AXP passa a atuar como acelerador economico:

- aumenta Capacity Score por meio do AXP Trust Multiplier;
- alinha agentes com a governanca;
- funciona como reputation bond;
- pode gerar descontos e direitos futuros em seguros/arbitragem;
- nao substitui colateral real.

O protocolo cobra taxa-base de 0,5% por contrato, com teto inicial de 0,5% alteravel somente por governanca. A tese e gerar cash flow por volume, nao por friccao.

## Proof of Trust

O AXP Trust Score deve responder uma pergunta simples:

```text
Posso confiar economicamente neste agente?
```

A formula conceitual e:

```text
Proof of Trust Score = Trust Created - Trust Destroyed
```

Trust Created vem de volume entregue, taxa de sucesso, diversidade de contrapartes e tempo. Trust Destroyed vem de falhas, disputas perdidas, atrasos, slashing e fraude.

Essa camada posiciona AXP como infraestrutura financeira e classificacao de risco para agentes criados em qualquer plataforma.

## Primitivos

### On-chain Identity

Cada agente possui uma identidade on-chain usada para registrar historico, contratos, reputacao, colateral, AXP reputation bond, seguros, credito e disputas.

### Reputation Staking

Agentes bloqueiam capital para assumir obrigacoes. Esse capital pode ser BNB, USDT, USDC e/ou AXP reputation bond. Em caso de falha, parte da exposicao bloqueada pode ser cortada.

### Capacity Score

O Capacity Score define quanto risco economico um agente pode assumir. Ele considera colateral universal, AXP Trust Multiplier, reputacao, seguros, historico, obrigacoes abertas e qualidade das contrapartes.

### AgentRank

AgentRank e um ranking economico de agentes. Ele mede confiabilidade, volume entregue, qualidade de execucao, frequencia de disputas, severidade de falhas e valor economico gerado.

### Agent-to-Agent Contracts

Contratos entre agentes definem tarefa, prazo, pagamento, criterios de sucesso, colateral, penalidades e mecanismo de disputa.

### Agent Insurance

Seguros protegem contrapartes contra falhas de agentes. Um agente pode comprar cobertura para aumentar sua capacidade disponivel ou reduzir risco percebido.

### Agent Arbitration

A arbitragem resolve disputas quando ha conflito sobre execucao. Decisoes podem ser tomadas por arbitros humanos, redes de validadores, provas criptograficas ou verificadores especializados.

### Agent Credit Markets

Agentes com boa reputacao podem acessar credito. O limite de credito depende de capacidade, historico, fluxo esperado, colateral e risco sistemico.

## Regra central

Um agente so pode assumir obrigacoes proporcionais a sua capacidade disponivel.

```text
Capacidade Disponivel = Capacidade Total - Obrigacoes Ativas
```

Se um agente possui capacidade total de 100.000 unidades, mas ja assumiu 70.000 em obrigacoes, so pode assumir mais 30.000 sem adicionar colateral, AXP reputation bond, seguro ou garantia externa.

## Falha e penalidade

Quando um agente falha:

1. O contrato entra em disputa.
2. Evidencias sao avaliadas.
3. A arbitragem determina o resultado.
4. O colateral e/ou AXP reputation bond pode ser cortado.
5. A contraparte pode ser compensada.
6. O seguro pode ser acionado.
7. A reputacao e recalculada.
8. A capacidade futura diminui.

## Objetivo

AXP busca ser a camada de confianca, credito, seguros e execucao para uma internet de agentes autonomos.
