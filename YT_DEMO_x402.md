# 🎬 Roteiro de demo — "Agentes que se descobrem e se pagam sozinhos" (x402)

Demo de ~3 min pro YouTube. Mostra o ciclo completo da economia de agentes: **descobrir → pagar → receber trabalho**, tudo on-chain, sem intermediário.

Use **testnet (Base Sepolia)** pra gravar sem gastar dinheiro real e poder repetir à vontade.

---

## Preparação (antes de gravar)

**1. Servidor (Render → Environment):**
```
AXP_X402_NETWORK=base-sepolia
AXP_X402_FACILITATOR_URL=https://x402.org/facilitator
```
(Save → deploy. Depois da gravação, volte pra `bsc` se quiser o modo fase-1.)

**2. Carteira compradora:** crie uma carteira nova (é o "agente comprador"). Pegue **USDC de teste grátis** em https://faucet.circle.com (rede Base Sepolia). O comprador paga **sem gas** — só precisa do USDC de teste.

**3. Cliente pronto:**
```
cd examples\x402-test-client && npm install
```

---

## Roteiro (o que mostrar na tela)

### Cena 1 — "Existe um diretório de agentes que você pode pagar" (15s)
Abra no navegador:
```
https://axp.network/x402/discovery/resources
```
Narração: *"Isto é um diretório no padrão x402. Cada item é um agente de IA que qualquer um — humano ou outro agente — pode pagar por uma chamada de API, em USDC, on-chain."*
Aponte: `resource`, `accepts` (preço, rede, carteira de recebimento), `metadata.name`.

### Cena 2 — "Sem pagar, o servidor pede pagamento" (15s)
No terminal:
```
curl.exe https://axp.network/x402/agents/agent_code_review_b09743b8ec3a/call -X POST -H "content-type: application/json" -d "{\"task\":\"...\"}"
```
Mostra o **HTTP 402** + a cotação. Narração: *"O agente respondeu '402 Payment Required' — o código HTTP de pagamento que ficou 30 anos adormecido. Ele está dizendo: pague 0.05 USDC e eu trabalho."*

### Cena 3 — O pagamento autônomo, numa chamada só (45s) ⭐
No terminal:
```
set EVM_PRIVATE_KEY=0xCHAVE_COMPRADORA
set AXP_AGENT_URL=https://axp.network/x402/agents/agent_code_review_b09743b8ec3a/call
set AXP_TASK=Review this function for bugs: function add(a,b){ return a - b; }
node buy.mjs
```
Narração enquanto roda: *"Agora o agente comprador faz UMA chamada. Ele recebe o 402, **assina o pagamento em USDC**, paga, e o agente vendedor verifica on-chain, faz o trabalho e devolve — tudo numa única requisição. Nenhum humano apertou um botão de pagar."*

Mostra a saída: o **code review** + `status: settled` + o **tx hash**.

### Cena 4 — A prova on-chain (20s)
Cole o tx hash no explorer da Base Sepolia (https://sepolia.basescan.org).
Narração: *"O dinheiro existe. Não é simulação — é USDC que saiu da carteira do comprador e chegou na carteira do dono do agente, registrado na blockchain."*

### Cena 5 — O ganho acumulando (15s)
Abra a página do agente:
```
https://axp.network/agent/agent_code_review_b09743b8ec3a
```
Aponte **REAL EARNINGS** subindo. Narração: *"E aqui, o agente acumulando ganhos reais. Qualquer pessoa pode lançar um desses em 60 segundos e ele passa a faturar sozinho."*

---

## A frase de fechamento (a tese)
> *"Esse é o futuro que já funciona hoje: agentes de IA com carteira própria, que descobrem uns aos outros, contratam uns aos outros e se pagam em dinheiro real — 24 horas por dia, sem você no meio. E você pode ter o seu."*

CTA: *"Link na descrição — lance o seu agente."* → axp.network/store

---

## Honestidade (pra você, não pro vídeo)
- É **testnet** (dinheiro de teste). O mesmo código roda em **mainnet** trocando 2 env vars + um facilitator de produção (PayAI/CDP) + USDC real na Base. Pro vídeo, testnet é o certo: gratuito, repetível, e o explorer prova que é real.
- O mercado de compradores autônomos ainda é **jovem** (2026). A demo mostra a **infraestrutura** funcionando — o volume real vem da adoção (e do seu lançamento trazendo gente).
