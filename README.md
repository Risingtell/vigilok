# VIGILOK — the DeFi position risk sentinel

Agents are starting to manage real DeFi positions on [okx.ai](https://www.okx.ai) — supplying collateral, borrowing against it, running strategies with nobody watching in real time. The marketplace already has services that vet *counterparties* (wallet risk) and *services* (security audits). Nobody watches the position itself: **is this specific loan about to get liquidated, and what would actually trigger it?**

VigilOK answers that with real numbers, not a guess. It reads live Aave V3 positions on X Layer directly from the Pool, Oracle and ProtocolDataProvider contracts, computes the real health factor, and can stress-test it against a hypothetical price move before that move happens — settled per query in USD₮0 over the OKX Agent Payments Protocol.

## Services

| Route | What you buy | Price | Payment |
|---|---|---|---|
| `POST /api/check` | Real Aave V3 health-factor snapshot for a wallet — collateral, debt, per-asset legs, risk level | $0.01 | x402 **exact** |
| `POST /api/simulate` | Stress-test the position: shock one asset's price by N% and see the resulting health factor | $0.02 | x402 **exact** |
| `POST /session/watch` | Continuous monitoring channel — deposit once, pay per recheck, get an alert flag when health factor crosses a threshold | $0.0005/check | MPP **session** |

Every number comes from a live on-chain read against the real, verified Aave V3 deployment on X Layer (Pool `0xE3F3Caefdd7180F884c01E57f65Df979Af84f116`) — the same chain the payment settles on, so there's no cross-chain trust gap between "what you paid for" and "what's actually true on-chain."

## The simulation: real collateral math, not a guess

`simulate` doesn't estimate — it rebuilds the position:

1. Reads every reserve leg the wallet actually holds (collateral and debt), via `ProtocolDataProvider.getUserReserveData`.
2. Applies the hypothetical price move to the named asset via the real reserve price from `AaveOracle`.
3. Recomputes the collateral-weighted liquidation threshold and the resulting health factor — the same formula Aave's own Pool uses internally.
4. Flags `wouldLiquidate: true` if the shock would cross HF below 1.0 from a currently-safe position.

Tested against a real, live borrower wallet with an open $285k/$131k position — not a synthetic fixture.

## Run it

```bash
npm install
cp .env.example .env      # fill in OKX SA API keys + wallets
npm run preflight         # is the Aave V3 Pool live and readable?
npm run dev                # the sentinel, on :4100

npm run smoke              # engine spot check against a real wallet, no payment layer, no credentials needed
npm run patron              # autonomous buyer: discover -> check -> simulate,
                            # with its own wallet, hard budget, and printed reasoning
npm run verify              # re-derive every settlement from X Layer chain data alone
```

`npm run verify` scans USD₮0 `Transfer` logs to the treasury and prints every settlement with its tx hash — check any row on [OKLink](https://www.oklink.com/x-layer).

## Architecture

```
                 buyer agents (x402 / MPP clients)
                        |  USD₮0, X Layer
                        v
   +----------------- VIGILOK ------------------+
   |  x402 exact ($0.01)   check                |
   |  x402 exact ($0.02)   simulate             |
   |  MPP session           watch / recheck      |
   +----------------+----------------------------+
                    | verify / settle (signed HMAC)      | read positions
                    v                                    v
        OKX facilitator (web3.okx.com)     Aave V3 Pool + Oracle + DataProvider (X Layer)
```

- `src/chain/xlayer.ts` — X Layer chain def + Aave V3 contract addresses (verified live, see `scripts/preflight.ts`)
- `src/engine/` — the Aave V3 reads: `check` (real position snapshot) and `simulate` (stress test)
- `src/payments/mpp.ts` — MPP session-channel handler for `watch`
- `src/buyer/payer.ts` — the x402 payer used by the patron demo
- `agents/patron.ts` — autonomous buyer agent with budget reasoning
- `scripts/verify.ts` — trustless revenue re-derivation from chain data
- `scripts/preflight.ts` — live sanity check of the Aave V3 ABI surface before trusting it

## Why this matters

A health factor that's checked once, off-chain, by a dashboard nobody's agent actually reads, doesn't prevent a liquidation. An agent that's *paying* per check has a reason to actually run it — and an agent that can cheaply ask "what if" before it happens can rebalance before the liquidation bot does. VigilOK makes position risk a service an autonomous agent can budget for, the same way it budgets for gas.

## Acknowledgments

Independently red-teamed by Warden #3808 — real paid adversarial testing across every surface, on-chain settlement verification, and a same-day bug report (a session-handler crash) that led to a real fix.

## License

MIT
