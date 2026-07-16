/**
 * PATRON — an autonomous buyer agent that is VigilOK's first customer.
 *
 * It has its own wallet and a hard budget, and it walks the risk-review
 * journey a real portfolio-managing agent would run, paying real USD₮0 on
 * X Layer at every step:
 *
 *   1. discover  GET  /              free  — read the service card
 *   2. check     POST /api/check     $0.01 exact — real Aave V3 health-factor snapshot
 *   3. simulate  POST /api/simulate  $0.02 exact — stress-test the largest collateral leg
 *
 * Default subject is a real, live Aave V3 (X Layer) borrower found by scanning
 * on-chain Borrow events (see scripts/preflight.ts history) — not a synthetic
 * wallet, so the demo is checking an actual position with actual money in it.
 *
 *   npm run patron
 *   VIGILOK_URL=… SUBJECT_ADDRESS=… npm run patron
 */
import "dotenv/config";
import { X402Payer, type CallOutcome } from "../src/buyer/payer.js";

const VIGILOK_URL = (process.env.VIGILOK_URL ?? "http://localhost:4100").replace(/\/+$/, "");
const SUBJECT = process.env.SUBJECT_ADDRESS ?? "0xf2909e3Eb81AFD79Ebb216F34FFA97b052ABFf63";
const SHOCK_PCT = Number(process.env.SHOCK_PCT ?? -20);

const BUDGET_USD = Number(process.env.PATRON_BUDGET_USD ?? 0.1);

const key = process.env.PATRON_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;
if (!key) {
  console.error("Set PATRON_PRIVATE_KEY (or BUYER_PRIVATE_KEY) in .env — the patron needs a funded X Layer wallet.");
  process.exit(1);
}
const payer = new X402Payer(key);

let spentUsd = 0;
const receipts: Array<{ step: string; usd: number; tx: string | null }> = [];

function usd(atomic: string | undefined | null): number {
  return atomic ? Number(atomic) / 1e6 : 0; // USD₮0 has 6 decimals
}

function decide(step: string, priceUsd: number): boolean {
  const remaining = BUDGET_USD - spentUsd;
  if (priceUsd > remaining) {
    console.log(`  budget: $${remaining.toFixed(3)} left, ${step} costs ~$${priceUsd.toFixed(3)} — DECLINE`);
    return false;
  }
  console.log(`  budget: $${remaining.toFixed(3)} left, ${step} costs ~$${priceUsd.toFixed(3)} — worth it, PAY`);
  return true;
}

function record(step: string, out: CallOutcome): void {
  // OKX's PAYMENT-RESPONSE always reports settlement.amount as null (a known
  // platform quirk, not specific to VigilOK — see scripts/verify.ts for the
  // trustless source of truth). Since every VigilOK route is x402 `exact`
  // (never metered), the quoted price from the 402 challenge IS the settled
  // amount, so fall back to that instead of showing a misleading $0.0000.
  const paidUsd = usd(out.settlement?.amount) || usd(out.quote?.value);
  spentUsd += paidUsd;
  receipts.push({ step, usd: paidUsd, tx: out.settlement?.transaction ?? null });
  const tx = out.settlement?.transaction;
  console.log(`  settled $${paidUsd.toFixed(4)}${tx ? ` — tx ${tx.slice(0, 14)}...` : ""} (HTTP ${out.httpStatus}, ${out.latencyMs}ms)`);
}

function fail(step: string, out: CallOutcome): never {
  console.error(`  ✗ ${step} failed: HTTP ${out.httpStatus} — ${out.rawBody.slice(0, 300)}`);
  process.exit(1);
}

console.log("PATRON — autonomous buyer agent");
console.log(`  wallet  : ${payer.address}`);
console.log(`  budget  : $${BUDGET_USD.toFixed(2)} USD₮0 (hard cap)`);
console.log(`  sentinel: ${VIGILOK_URL}`);
console.log(`  subject : ${SUBJECT} (real, live Aave V3 X Layer position)\n`);

console.log("① discover — reading the service card (free)");
const card = await fetch(`${VIGILOK_URL}/`).then((r) => r.json());
console.log(`  found "${card.name}" — ${card.tagline}`);

console.log(`\n② check — is ${SUBJECT.slice(0, 10)}... position healthy right now?`);
if (!decide("check", 0.01)) process.exit(0);
const checkOut = await payer.call(`${VIGILOK_URL}/api/check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: SUBJECT }),
});
if (!checkOut.paid) fail("check", checkOut);
record("check", checkOut);
const snapshot = checkOut.body as {
  hasPosition?: boolean;
  totalCollateralUsd?: number;
  totalDebtUsd?: number;
  healthFactor?: number | null;
  riskLevel?: string;
  legs?: Array<{ symbol: string; collateralUsd: number; debtUsd: number }>;
};
console.log(
  `  snapshot: collateral $${snapshot.totalCollateralUsd?.toFixed(2)}, debt $${snapshot.totalDebtUsd?.toFixed(2)}, ` +
    `HF ${snapshot.healthFactor?.toFixed(4) ?? "∞"} — ${snapshot.riskLevel}`,
);

const legs = snapshot.legs ?? [];
const biggestLeg = [...legs].sort((a, b) => b.collateralUsd - a.collateralUsd)[0];
if (!biggestLeg || biggestLeg.collateralUsd === 0) {
  console.log("\nNo collateral leg to stress-test — stopping after check().");
} else {
  console.log(`\n③ simulate — what if ${biggestLeg.symbol} drops ${SHOCK_PCT}%?`);
  if (!decide("simulate", 0.02)) process.exit(0);
  const simOut = await payer.call(`${VIGILOK_URL}/api/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: SUBJECT, asset: biggestLeg.symbol, pctChange: SHOCK_PCT }),
  });
  if (!simOut.paid) fail("simulate", simOut);
  record("simulate", simOut);
  const sim = simOut.body as { healthFactor?: number | null; riskLevel?: string; wouldLiquidate?: boolean; baselineHealthFactor?: number | null };
  console.log(
    `  stressed HF ${sim.healthFactor?.toFixed(4) ?? "∞"} (was ${sim.baselineHealthFactor?.toFixed(4) ?? "∞"}) — ${sim.riskLevel}` +
      (sim.wouldLiquidate ? " — WOULD BE LIQUIDATED" : ""),
  );
}

console.log("\n═══ patron session receipt ═══");
for (const r of receipts) console.log(`  ${r.step.padEnd(9)} $${r.usd.toFixed(4)}  ${r.tx ?? "(no tx reported)"}`);
console.log(`  total     $${spentUsd.toFixed(4)} of $${BUDGET_USD.toFixed(2)} budget — every payment real, settled on X Layer`);
