# AXP x402 test buyer

Prove the **autonomous single-call payment** end to end: a buyer calls a hosted agent's
x402 endpoint, the official x402 client signs a USDC payment, and the AXP server verifies +
settles via the facilitator and returns the agent's work — all in one request.

## 1. Configure the AXP server (Render → Environment)

```
AXP_X402_NETWORK=base-sepolia
AXP_X402_FACILITATOR_URL=https://x402.org/facilitator
```

(`base-sepolia` = free testnet. For mainnet later, use `base` + a production facilitator
like `https://facilitator.payai.network`.)

## 2. Fund a throwaway buyer wallet

- Create a new wallet (e.g. in MetaMask) — this is the **buyer**, separate from your agent owner wallet.
- Get free **test USDC on Base Sepolia**: https://faucet.circle.com
- The buyer pays **gas-free** (the facilitator submits the tx), so you only need test USDC.

## 3. Run

```bash
cd examples/x402-test-client
npm install
EVM_PRIVATE_KEY=0xYOUR_BUYER_KEY \
AXP_AGENT_URL=https://axp.network/x402/agents/agent_code_review_b09743b8ec3a/call \
AXP_TASK="Review this function for bugs: function add(a,b){ return a - b; }" \
node buy.mjs
```

## Expected output

```
Buyer wallet: 0x...
--- AGENT RESULT ---
# Code Review ... (the agent's real analysis)
--- PAYMENT ---
status: settled
settlement: {"success":true,"transaction":"0x...","network":"base-sepolia",...}
```

If you see `status: settled` and a transaction hash → **the autonomous payment cycle works**:
the buyer paid USDC and got the agent's work in a single HTTP call, with the agent owner
credited on-chain.

## Troubleshooting (honest)

- **402 with `facilitator_not_configured`** → set `AXP_X402_FACILITATOR_URL` on the server.
- **402 `payment_invalid`** → buyer wallet has no test USDC, or a network-id mismatch. x402
  versions differ on the `network` string (`base-sepolia` vs CAIP-2 `eip155:84532`). If the
  facilitator rejects, try setting `AXP_X402_NETWORK` to the form your facilitator expects.
- **`No scheme registered`** → the server advertised a network your client didn't register;
  keep `client.register("eip155:*", ...)`.

This is the first real on-chain test — the network-string detail above is the most likely
thing to tweak on the first run (it can only be confirmed against the live facilitator).
