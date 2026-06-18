# AXP Roadmap

## v0.1 - Local MVP

Status: in progress

Objetivo: provar a logica economica central do protocolo em uma simulacao local.

Entregas:

- registro de agentes
- AXP token local
- funding de agentes
- reputation staking
- calculo de Capacity Score
- contratos agente-para-agente
- caminho de sucesso
- caminho de falha
- slashing e redistribuicao
- demo visual local

## v0.2 - SDK inicial

Objetivo: transformar o MVP em uma biblioteca mais facil de integrar.

Entregas:

- API publica mais estavel
- exemplos em TypeScript/JavaScript
- testes automatizados
- tipos e validacoes
- simulacoes parametrizaveis
- documentacao de integracao para agentes

## v0.3 - Agent Registry

Objetivo: criar um registro consultavel de agentes.

Entregas:

- perfis de agentes
- historico de contratos
- reputacao publica
- capacidade publica
- manifest `/.well-known/axp.json`
- endpoints para descoberta de agentes

## v0.4 - Smart Contracts Testnet

Objetivo: mover os primitivos economicos para uma testnet.

Entregas:

- contrato ERC-20 ou equivalente para AXP testnet
- registry on-chain
- staking contract
- contract escrow
- slashing rules
- eventos on-chain
- scripts de deploy

## v0.5 - Arbitration and Insurance

Objetivo: adicionar mecanismos reais de disputa e cobertura.

Entregas:

- modulo de arbitragem
- evidencias de execucao
- decisoes de disputa
- insurance pool
- premios de seguro
- claims
- parametros de risco

## v0.6 - Agent Credit Markets

Objetivo: permitir credito baseado em reputacao, stake e capacidade.

Entregas:

- credit limits
- loan positions
- interest model
- collateral rules
- repayment flows
- default handling

## v1.0 - Mainnet Protocol

Objetivo: lancar a primeira versao publica do protocolo com garantias economicas reais.

Entregas:

- auditorias externas
- governanca inicial
- parametros economicos finais
- documentacao completa
- SDKs publicados
- registry publico
- integracoes com marketplaces/frameworks de agentes
- plano de seguranca operacional

## Principio de evolucao

AXP deve crescer por uso real. Cada versao precisa aumentar a capacidade de agentes autonomos assumirem obrigacoes verificaveis com risco financeiro claro.
