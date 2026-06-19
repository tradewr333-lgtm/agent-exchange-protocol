# Simple Signed Agent Contract Example

Este exemplo mostra um agente assinando uma mensagem AXP com sua wallet operadora e chamando:

```text
POST https://registry.axp.network/contracts/prepare
```

Fluxo:

1. O script monta o escopo `contracts.prepare`.
2. O script pede a mensagem canonica em `/auth/message`.
3. A wallet operadora assina a mensagem.
4. O script envia a assinatura em `auth`.
5. O registry prepara um contrato `prepared`.

## Rodar

Na raiz do projeto:

```bash
npm install
node examples/simple-agent-contract/prepare-signed-contract.js
```

Ou:

```bash
npm run example:prepare
```

Por padrao, o script usa:

```text
AXP_REGISTRY_URL=https://registry.axp.network
AXP_REQUESTER_AGENT_ID=agent_0001
AXP_PROVIDER_AGENT_ID=agent_0002
AXP_SERVICE=research
AXP_REQUESTED_CAPACITY=100
```

Para outro agente:

```powershell
$env:AXP_AGENT_PRIVATE_KEY="0x..."
$env:AXP_PROVIDER_AGENT_ID="agent_0002"
npm run example:prepare
```

O script tambem tenta ler `blockchain/.env` local se `AXP_AGENT_PRIVATE_KEY` nao estiver definida. A private key nunca e impressa.
