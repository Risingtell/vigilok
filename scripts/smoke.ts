/**
 * Manual smoke test — exercises the engine directly (no HTTP/payment layer)
 * against a real wallet. Defaults to a real, live Aave V3 (X Layer) borrower.
 *
 *   npm run smoke [address]
 */
import { checkPosition, simulatePosition } from "../src/engine/aave.js";

const addr = process.argv[2] ?? "0xf2909e3Eb81AFD79Ebb216F34FFA97b052ABFf63";
const snap = await checkPosition(addr);
console.log("=== checkPosition ===");
console.log(JSON.stringify(snap, null, 2));

if (snap.legs.length > 0) {
  const collateralLeg = snap.legs.find((l) => l.collateralUsd > 0) ?? snap.legs[0];
  console.log(`\n=== simulatePosition(${collateralLeg.symbol}, -20%) ===`);
  const sim = await simulatePosition({ address: addr, asset: collateralLeg.symbol, pctChange: -20 });
  console.log(JSON.stringify(sim, null, 2));
}
