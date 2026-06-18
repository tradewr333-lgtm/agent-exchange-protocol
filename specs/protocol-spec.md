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

### 2. Staking Module

Gerencia deposito, bloqueio, desbloqueio e slashing de capital.

Funcoes principais:

- deposit_stake(agent_id, amount)
- lock_stake(agent_id, contract_id, amount)
- slash(agent_id, amount, reason)
- release_stake(agent_id, amount)

### 3. Capacity Engine

Calcula a capacidade total e disponivel de cada agente.

Entradas:

- stake livre
- stake bloqueado
- reputacao
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
4. O Staking Module bloqueia colateral.
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
