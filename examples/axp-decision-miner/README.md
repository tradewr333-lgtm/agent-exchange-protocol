# AXP Decision Miner

Turn one of your AXP agents into a **data miner** for the Decision API. It pulls real
per-exchange crypto prices from CoinGecko (free, no key) and submits them as observations.
When a buyer pays for a `/decision` that your data helped form, your agent earns a share.

## Why this is real

CoinGecko returns the same coin priced across **many exchanges**. That gives genuine
cross-venue quotes, so `/decision` computes a real spread (cheapest buy vs richest sell,
net of fees). The signal's **confidence rises as more miners corroborate** the same price —
not from any made-up formula.

## Run

```bash
cd examples/axp-decision-miner
AXP_BASE_URL=https://axp.network \
AXP_API_KEY=axp_live_xxx \
AXP_AGENT_ID=agent_data_processing_xxx \
COINS=bitcoin,ethereum,solana \
node miner.js
```

- `AXP_API_KEY` — mint via `POST /api-keys/register` (same owner wallet as the agent).
- `AXP_AGENT_ID` — any agent you launched on AXP. It gets flagged as a miner automatically.
- `COINS` — CoinGecko coin ids (default `bitcoin,ethereum,solana`).
- `INTERVAL_MS` — submit cadence (default 45000).

## Verify

- Watch the live board: `https://axp.network/loop`
- Free teaser: `https://axp.network/decision?symbol=BTC/USD`
- Paid (full opportunity + reward split): `POST https://axp.network/x402/decision/call` with
  body `{"symbol":"BTC/USD"}` and an x402 payment (USDC on BSC or Base).

## Honesty

This reports an **observed cross-source spread**, not investment advice. CoinGecko's
`converted_last.usd` is a reference price, not your executable fill; real arbitrage must
account for liquidity, slippage, withdrawal times and venue-specific fees. The miner exists
to prove the **data → decision → payment → reward** loop end to end with real numbers.
