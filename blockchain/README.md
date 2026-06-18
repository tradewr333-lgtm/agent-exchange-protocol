# AXP Blockchain Layer

Contratos Solidity para levar o AXP para BSC Testnet antes de qualquer mainnet.

## Contratos

- `AXPToken.sol`: token BEP-20/ERC-20 compativel com supply fixo.
- `AXPFounderVesting.sol`: vesting do fundador com cliff de 12 meses e vesting total de 48 meses.
- `AXPStaking.sol`: staking, travamento de obrigacoes e slashing on-chain.
- `AXPAgentRegistry.sol`: registro on-chain de agentes.
- `AXPParticipationVault.sol`: vault opcional para participacao publica contra BNB.

## Tokenomics on-chain

```text
Total Supply: 1.000.000.000 AXP

28% Community & Ecosystem          280.000.000 AXP
20% Protocol Treasury              200.000.000 AXP
10% Founder / Protocol Steward     100.000.000 AXP
10% Core Contributors              100.000.000 AXP
15% Investors / Strategic          150.000.000 AXP
10% Agent Incentives               100.000.000 AXP
5% Liquidity                       50.000.000 AXP
2% Participation Vault             20.000.000 AXP
```

## Participation Vault

A vault existe para uma futura rodada publica de participacao somente contra BNB ou WBNB. No deploy, ela recebe 20.000.000 AXP e nasce pausada. Ela nao deve ser aberta antes de:

- BSC Testnet validada
- contratos revisados
- parametros publicados
- riscos explicados
- decisao explicita de lancamento

Esta vault nao deve ser divulgada como investimento, promessa de retorno ou garantia de valorizacao.

Fluxo economico:

```text
Comprador envia BNB ou WBNB, e nenhum outro ativo
-> Vault envia AXP ao comprador
-> BNB/WBNB vai diretamente para a proceeds wallet indicada pelo fundador/protocolo
```

No deploy inicial de testnet, a vault aceita BNB nativo. Na BSC mainnet, WBNB so e aceito se for o contrato oficial:

```text
0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
```

Qualquer outro token e rejeitado pelo contrato.

Parametros obrigatorios:

```text
Pagamento aceito: BNB ou WBNB apenas
Deposito minimo: 0.01 BNB ou 0.01 WBNB
Ratio: X AXP por 1 BNB/WBNB, definida apenas depois de medir demanda real dos agentes
Destino dos pagamentos: proceeds wallet indicada pelo fundador/protocolo
```

## Deploy BSC Testnet

Instale dependencias:

```bash
cd "C:\\Users\\DEEPGAMING\\Agent Exchange Protocol\\blockchain"
npm install
```

Copie `.env.example` para `.env` e preencha uma wallet separada do AXP. Nao use private key de projetos existentes.

Compile:

```bash
npm run compile
```

Deploy testnet:

```bash
npm run deploy:bsc-testnet
```

## Regra operacional

Use wallets separadas:

```text
AXP deploy wallet
AXP treasury wallet
AXP liquidity wallet
AXP founder vesting beneficiary
AXP participation vault wallet
```

A wallet do Polytracker pode financiar gas ou liquidez, mas nao deve ser a wallet operacional principal do AXP.
