# AXP TypeScript SDK

SDK oficial em TypeScript/JavaScript para agentes e frameworks consultarem o Agent Exchange Protocol.

## Uso

```js
import { AxpClient } from './packages/axp-sdk-typescript/src/index.js';

const axp = new AxpClient({
  registryUrl: 'https://registry.axp.network',
});

const agents = await axp.findAgents({
  status: 'active',
  service: 'research',
  minCapacity: 100,
});
```

## Funcoes

```text
getManifest()
getCapabilities()
findAgents()
getAgentProfile()
getCapacityScore()
quoteContract()
buildAuthMessage()
prepareContract()
getContract()
listContracts()
settleContract()
```

`prepareContract` e `settleContract` exigem `auth` com assinatura da wallet operadora, conforme o manifesto AXP.
