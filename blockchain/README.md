# AXP Blockchain Layer

Contratos Solidity para levar o AXP para BSC Testnet antes de qualquer mainnet.

## Contratos

- `AXPToken.sol`: token BEP-20/ERC-20 compativel com supply fixo.
- `AXPFounderVesting.sol`: vesting do fundador com cliff de 12 meses e vesting total de 48 meses.
- `AXPStaking.sol`: staking, travamento de obrigacoes e slashing on-chain.
- `AXPAgentRegistry.sol`: registro on-chain de agentes.
- `AXPParticipationVault.sol`: vault opcional para participacao publica contra BNB.
- `AXPTrustAnchor.sol`: ancora Merkle Roots do ledger Proof of Trust na BSC.

## BSC Mainnet Deployment

```text
Network: BNB Smart Chain
Chain ID: 56
AXPToken: 0x88cF3943F6e250C4f15Bc6aFEd5192663b68Eda2
AXPFounderVesting: 0x7C6AB042076468e9e4B45B9caaBB3DD3da5bcD6e
AXPAgentRegistry: 0x5e91402c50EC9D7655617ec787dc8087f7AB4678
AXPStaking: 0xb3faFa1d03b852DFe9BfDe413efEF856788fd787
AXPParticipationVault: 0xF70605341b4f73a5bFa89D363652a973007CC338
```

Deployment metadata:

```text
blockchain/deployments/bsc-mainnet.json
```

The Participation Vault is deployed but paused. No public sale is open.

All BSC mainnet contracts are verified on BscScan.

## Proof of Trust Anchor

`AXPTrustAnchor.sol` e a camada leve de prova publica para o AXP Trust Oracle.

Ele grava somente:

- Merkle Root de um lote de `trust_events`
- primeiro e ultimo event id
- quantidade de eventos
- registry URL / batch URI

Ele nao grava dados completos de agentes, evidencias privadas, API keys ou payloads de contratos. Os registros completos ficam no Postgres do AXP; a BSC guarda o checkpoint criptografico publico.

Deploy apenas do contrato de anchor:

```bash
npm run deploy:trust-anchor:bsc-mainnet
```

Deploy mainnet continua bloqueado sem:

```text
AXP_CONFIRM_MAINNET_DEPLOY=YES_I_UNDERSTAND
```

Depois do deploy, configure:

```text
AXP_TRUST_ANCHOR_ADDRESS=0x...
```

E rode o worker privado a partir da raiz do repositorio:

```bash
node examples/proof-of-trust-anchor/anchor-bsc.js
```

## Verify on BscScan

Create an Etherscan API V2 key and add it to `.env`:

```text
ETHERSCAN_API_KEY=
```

Then run:

```bash
npm run verify:bsc-mainnet
```

The verification script uses the deployed constructor arguments from `blockchain/deployments/bsc-mainnet.json`.

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

A vault existe como mecanismo legado pausado para uma futura rodada publica de participacao. No deploy, ela recebe 20.000.000 AXP e nasce pausada. Ela nao e o modulo de colateral operacional do protocolo e nao deve ser aberta antes de:

- BSC Testnet validada
- contratos revisados
- parametros publicados
- riscos explicados
- decisao explicita de lancamento

Esta vault nao deve ser divulgada como investimento, promessa de retorno ou garantia de valorizacao.

Fluxo economico:

```text
Comprador envia ativo permitido pela governanca futura
-> Vault envia AXP ao comprador
-> eventual captacao vai diretamente para a proceeds wallet indicada pelo fundador/protocolo
```

No deploy inicial, a vault nasceu com suporte a BNB nativo e WBNB oficial, mas permanece pausada. A politica operacional de colateral do protocolo aceita BNB, USDT e USDC.

```text
0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
```

Qualquer outro token e rejeitado pelo contrato.

Parametros obrigatorios:

```text
Pagamento aceito: nao aberto
Deposito minimo: nao ativo
Ratio: nao definido
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

## Deploy BSC Mainnet

Mainnet usa BNB real e contratos reais. Nao use a chave de testnet por acidente.

Para mainnet, preencha uma variavel separada:

```text
BSC_MAINNET_PRIVATE_KEY=
```

O script bloqueia deploy mainnet por padrao. Para liberar conscientemente:

```text
AXP_CONFIRM_MAINNET_DEPLOY=YES_I_UNDERSTAND
```

Depois:

```bash
npm run deploy:bsc-mainnet
```

Antes de mainnet, confirme:

- wallet deployer e nova e separada
- ha BNB suficiente para gas
- wallets de alocacao estao corretas
- vault esta pausada
- ratio da vault ainda nao foi divulgado
- nenhum endereco de projeto existente foi usado por engano

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
