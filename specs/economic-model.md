# AXP Economic Model

## Conceito

AXP transforma colateral, reputacao e historico em capacidade economica verificavel. O protocolo permite que agentes assumam obrigacoes proporcionais ao capital bloqueado, ao desempenho passado e ao risco de falha.

O modelo v0.2 separa dois papeis:

- **Universal Collateral**: BNB, USDT e USDC usados como garantia operacional.
- **AXP Reputation Bond**: AXP usado como multiplicador de confianca, governanca e alinhamento economico.

Essa separacao reduz atrito de entrada. Um agente pode comecar com stablecoins ou BNB e, com o tempo, adquirir AXP para ampliar capacidade.

## Ativos aceitos

Colateral inicial planejado para BNB Smart Chain:

```text
BNB
USDT oficial BEP20: 0x55d398326f99059ff775485246999027b3197955
USDC oficial BEP20: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d
```

Todos os ativos sao convertidos internamente para USD-equivalent por oraculos ou precificacao governada.

## Capacidade

Formula v0.2:

```text
Total Capacity =
Universal Collateral USD
* Reputation Multiplier
* AXP Trust Multiplier
* Insurance Multiplier
* Risk Adjustment
```

```text
Available Capacity =
Total Capacity
- Active Obligations
- Pending Dispute Exposure
```

## AXP Trust Multiplier

AXP nao e exigido para entrada, mas amplia a capacidade de agentes que ja possuem colateral operacional.

Exemplo:

```text
Agente novo:
100.000 USDC collateral
0 AXP
Capacity base: 100.000

Agente alinhado:
100.000 USDC collateral
50.000 AXP reputation bond
Capacity: maior por AXP Trust Multiplier
```

O multiplicador deve ser limitado por governanca para evitar que AXP substitua colateral real.

## Protocol Fee

A taxa-base do protocolo e:

```text
0,5% por contrato preparado/executado
```

O teto inicial tambem e:

```text
0,5%
```

Qualquer aumento desse teto deve exigir governanca. A previsibilidade da taxa e uma vantagem competitiva para agentes e marketplaces que constroem sobre AXP.

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

O slashing deve ser proporcional a gravidade da falha e pode atingir colateral universal, AXP reputation bond ou ambos.

Niveis sugeridos:

- Falha leve: 1% a 5% da exposicao bloqueada
- Falha moderada: 5% a 25% da exposicao bloqueada
- Falha grave: 25% a 75% da exposicao bloqueada
- Fraude: ate 100% da exposicao bloqueada e perda severa de reputacao

## Seguro

Seguros podem aumentar a capacidade de um agente, mas nao substituem reputacao nem colateral. Eles reduzem risco de contraparte e ajudam agentes novos a participar do mercado.

## Credito

Agentes podem acessar credito com base em:

- colateral universal
- AXP reputation bond
- historico
- fluxo de receita esperado
- AgentRank
- seguros
- volatilidade de desempenho
- exposicao ativa

## Receita e staking AXP

Na fase inicial, AXP staking nao deve pagar yield inflacionario. Qualquer remuneracao futura deve vir de receita real do protocolo.

Diretriz futura possivel:

```text
40% Treasury
30% Development
20% Insurance / Risk Reserves
10% AXP Stakers
```

Essa regra nao esta ativa em v0.2.

## Objetivo economico

O protocolo deve incentivar agentes a manter desempenho alto, assumir riscos proporcionais e internalizar o custo de falhas.

O objetivo nao e forcar compra de AXP. O objetivo e criar a camara de compensacao e reputacao para contratos maquina-para-maquina.

## Proof of Trust

O modelo economico do AXP tambem inclui Proof of Trust:

```text
Proof of Trust Score = Trust Created - Trust Destroyed
```

Essa metrica deve alimentar AgentRank, Capacity Score, precificacao de seguro e limites de credito.
