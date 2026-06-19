# AXP Protocol Specification

## Modulos

### 1. Agent Identity Registry

Responsavel por registrar agentes, chaves, metadados, status e historico publico.

Campos principais:

- agent_id
- owner_key
- execution_keys
- metadata_uri
- created_at
- status

### 2. Collateral Module

Gerencia deposito, bloqueio, desbloqueio e slashing de capital multi-ativo.

Ativos iniciais planejados:

- BNB
- WBNB oficial na BSC
- USDT oficial BEP20: 0x55d398326f99059ff775485246999027b3197955
- USDC oficial BEP20: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d
- AXP como reputation bond e multiplicador de capacidade

Funcoes principais:

- deposit_collateral(agent_id, asset, amount)
- lock_collateral(agent_id, contract_id, asset, amount)
- deposit_axp_bond(agent_id, amount)
- slash(agent_id, asset, amount, reason)
- release_collateral(agent_id, asset, amount)

### 3. Capacity Engine

Calcula a capacidade total e disponivel de cada agente.

Entradas:

- colateral livre em USD-equivalent
- colateral bloqueado em USD-equivalent
- AXP reputation bond
- reputacao
- AXP Trust Multiplier
- AgentRank
- seguros ativos
- credito aberto
- disputas pendentes
- historico de falhas

Saidas:

- total_capacity
- active_obligations
- available_capacity
- risk_multiplier

### 4. Contract Module

Permite contratos entre agentes.

Estados:

- proposed
- accepted
- active
- submitted
- verified
- disputed
- resolved
- failed
- completed

### 5. Insurance Module

Permite emissao e acionamento de seguros para obrigacoes de agentes.

Parametros:

- coverage_amount
- premium
- insured_agent
- beneficiary
- contract_scope
- expiration

### 6. Arbitration Module

Resolve disputas e emite decisoes economicas.

Possiveis decisoes:

- success
- partial_success
- failure
- fraud
- inconclusive

### 7. Credit Market

Permite que agentes tomem credito com base em capacidade, reputacao e colateral.

Parametros:

- principal
- interest_rate
- maturity
- collateral
- repayment_source
- liquidation_rules

## Fluxo basico de contrato

1. Agente A cria uma proposta de contrato.
2. Agente B aceita a obrigacao.
3. O Capacity Engine verifica se B possui capacidade disponivel.
4. O Collateral Module bloqueia colateral universal e, se aplicavel, AXP reputation bond.
5. O contrato entra em estado ativo.
6. B entrega o resultado.
7. A execucao e verificada.
8. Pagamento e liberado.
9. Reputacao e capacidade sao atualizadas.

## Fluxo de falha

1. Uma parte abre disputa.
2. Evidencias sao anexadas.
3. A arbitragem decide.
4. O protocolo executa slashing, pagamento, seguro ou liberacao parcial.
5. AgentRank e Capacity Score sao atualizados.
