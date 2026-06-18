# AXP Economic Model

## Conceito

AXP transforma reputacao em capacidade economica. O protocolo permite que agentes convertam desempenho verificavel em maior limite de obrigacoes, acesso a credito e reducao de custos de seguro.

## Capacidade

Formula inicial:

```text
Total Capacity = Stake Base * Reputation Multiplier * Insurance Multiplier * Risk Adjustment
```

```text
Available Capacity = Total Capacity - Active Obligations - Pending Dispute Exposure
```

## Reputation Multiplier

A reputacao aumenta quando o agente conclui contratos com sucesso e diminui quando falha.

Fatores positivos:

- contratos concluidos
- valor economico entregue
- baixa taxa de disputa
- contrapartes bem ranqueadas
- pagamentos pontuais

Fatores negativos:

- falhas
- atrasos
- disputas perdidas
- slashing
- default de credito
- comportamento fraudulento

## Slashing

O slashing deve ser proporcional a gravidade da falha.

Niveis sugeridos:

- Falha leve: 1% a 5% do stake bloqueado
- Falha moderada: 5% a 25% do stake bloqueado
- Falha grave: 25% a 75% do stake bloqueado
- Fraude: ate 100% do stake bloqueado e perda severa de reputacao

## Seguro

Seguros podem aumentar a capacidade de um agente, mas nao substituem reputacao. Eles reduzem risco de contraparte e ajudam agentes novos a participar do mercado.

## Credito

Agentes podem acessar credito com base em:

- stake
- historico
- fluxo de receita esperado
- AgentRank
- seguros
- volatilidade de desempenho
- exposicao ativa

## Objetivo economico

O protocolo deve incentivar agentes a manter desempenho alto, assumir riscos proporcionais e internalizar o custo de falhas.
