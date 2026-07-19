# VigilOK — OKX.AI listing runbook

Everything needed to take VigilOK from "working locally" to "listed and live."
Submitting to OKX.AI Genesis as its own separate entry alongside Argus (not
merged — see [[project-okx-genesis]]). Deadline: **2026-07-27 23:59 UTC**.

---

## Step 1 — Deploy (get a permanent public URL)

VigilOK needs a persistent process (the facilitator warm-up retry loop), so it
runs as a web service, not a serverless function. `render.yaml` is already
committed.

1. Go to **render.com**, sign in with GitHub.
2. **New +** -> **Blueprint** -> pick the repo `Risingtell/vigilok`.
3. Set the secret env vars (copy from your local `.env` — never paste them
   anywhere public): `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`,
   `PAY_TO`, `MPP_MERCHANT_PRIVATE_KEY`, `MPP_SECRET_KEY`, `BUYER_PRIVATE_KEY`.
4. **Apply**, wait for the build. You'll get a URL like `https://vigilok.onrender.com`.
5. Confirm health: `https://<your-url>/healthz` should read
   `{"ok":true,"paymentsReady":true}`. If `paymentsReady` is false, give it a
   minute (facilitator warm-up) and refresh.

> Free tier sleeps after ~15 min idle (first call then takes ~50s). For the
> OKX review window and any live demo, either ping it to keep it warm or bump
> to the paid instance.

**Done** — pushed to `github.com/Risingtell/vigilok` (public), deployed at
`https://vigilok.onrender.com`, listed as Agent #6032, confirmed live with a
real sale.

---

## Step 2 — List VigilOK as an ASP on OKX.AI

**Done** — approved and live as Agent **#6032**, searchable as "VigilOK."
Kept below for reference (identity/service copy as actually submitted).

### ASP identity

- **Name:** `VigilOK`
- **Description:**
  > The DeFi position risk sentinel for the agent economy. VigilOK reads live
  > Aave V3 positions on X Layer and reports the real health factor before a
  > liquidation does — plus what a hypothetical price move would do to it.
  > Real on-chain reads, not an estimate, settled per query in USD₮0.
- **Avatar:** `build/vigilok-avatar.html` -> open in a browser -> Download PNG
  (512x512, hard corners already, no rounding to fix later).

### Services (two A2MCP services — flat-fee, fits the listing schema)

`watch` (MPP session) stays live on the deployed API as bonus protocol-breadth
surface, same as Argus's `/api/monitor`/`/session/watch` — session/metered
pricing doesn't fit the single-flat-fee A2MCP schema, so it's not one of the
two formally listed services below.

**1. Position Health Check** — fee `0.01`
> Real-time Aave V3 health-factor snapshot for a wallet with an open lending
> position, for agents that need to know if a position is safe before acting on it.
> Provide the wallet address; get collateral, debt, and a safe / caution /
> danger / liquidatable verdict with the full per-asset breakdown.
- Endpoint: `https://vigilok.onrender.com/api/check`

**2. Liquidation Stress Simulation** — fee `0.02`
> Stress-tests an open Aave V3 position against a hypothetical price move on
> any collateral or debt asset, recomputing the real resulting health factor.
> Provide the wallet address, the asset symbol, and a percent price change;
> get the simulated health factor and a liquidation flag.
- Endpoint: `https://vigilok.onrender.com/api/simulate`

> OKX reviews within 24h; result comes to the email on your Agentic Wallet and
> the agent window.

---

## Step 3 — X post + demo + Google form (still to do)

VigilOK is going into the Genesis campaign as its own entry. Submit
**https://forms.gle/mddEUagmDbyV37ws8** with Agent #6032's details + the
link to the X post below, before **2026-07-27 23:59 UTC**. Note the form
takes one Agent ID per submission — this is a separate form pass from
Argus's, not a shared one.

### X post draft

> Meet **VigilOK** — the DeFi position risk sentinel, live on OKX.AI.
>
> It reads your agent's real Aave V3 position on X Layer and tells you the
> actual health factor — then stress-tests it against a hypothetical price
> move before that move happens. Real on-chain math, not a guess, settled
> per-query in USD₮0.
>
> #OKXAI

### Demo script (~60s)

| Time | Show | Say |
|---|---|---|
| 0:00 | `GET /` service card | "This is VigilOK — a risk sentinel for DeFi positions." |
| 0:10 | `npm run patron`, check step on a real live borrower wallet | "It reads a real Aave V3 position — collateral, debt, health factor — live off X Layer." |
| 0:30 | simulate step, price shock | "Then it stress-tests it: what happens to this position if the collateral drops 20%?" |
| 0:50 | `npm run verify` | "Every payment is real, re-derived straight from X Layer — check any tx on OKLink." |

---

## Live proof

- `scripts/preflight.ts` — live ABI verification against the real Aave V3
  Pool/Oracle/DataProvider on X Layer.
- `scripts/smoke.ts` — `check`/`simulate` tested against a real live borrower
  wallet (`0xf2909e3Eb81AFD79Ebb216F34FFA97b052ABFf63`): $285k collateral
  (xBTC/xETH/xSOL), $131k USD₮0 debt, HF 1.618 (SAFE); a -20% xBTC shock
  correctly recomputes HF to 1.32 (CAUTION).
- `npm run verify` — re-derive real settlements from X Layer chain data once
  the treasury has received payments.
