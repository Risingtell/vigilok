/**
 * On-chain verifier — a wallet-risk sentinel, verified the same way it
 * verifies positions: by reading the chain directly, not trusting an API.
 *
 * Re-derives VigilOK's revenue from X Layer chain data alone: every USD₮0
 * Transfer into the treasury (PAY_TO), plus current balances of every wallet
 * in the system. No VigilOK API, no database — a judge can run `npm run
 * verify` and check our claims against the chain directly.
 */
import "dotenv/config";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { publicClient, USDT0, xlayer } from "../src/chain/xlayer.js";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const LOOKBACK = BigInt(process.env.VERIFY_LOOKBACK_BLOCKS ?? 400_000);
const CHUNK = BigInt(process.env.VERIFY_CHUNK ?? 100);

// drpc.org's free tier now hard-rejects eth_getLogs outright ("upgrade to paid
// plan"), so rpc.xlayer.tech is the default — but it caps every call at 100
// blocks, so CONCURRENCY runs many of those 100-block calls in parallel
// (proven clean at 20 on the sibling Argus verifier) rather than one at a time.
// Balances still go through the default client — only log scans use this one.
const scanClient = createPublicClient({
  chain: xlayer,
  transport: http(process.env.VERIFY_RPC ?? "https://rpc.xlayer.tech"),
});
const CONCURRENCY = Number(process.env.VERIFY_CONCURRENCY ?? 20);

const payTo = process.env.PAY_TO;
if (!payTo || payTo.length !== 42) {
  console.error("PAY_TO missing from .env — nothing to verify.");
  process.exit(1);
}
const treasury = getAddress(payTo);
const buyer = process.env.BUYER_PRIVATE_KEY ? privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as Hex).address : null;
const patron = process.env.PATRON_PRIVATE_KEY ? privateKeyToAccount(process.env.PATRON_PRIVATE_KEY as Hex).address : null;

async function usdt0Balance(addr: `0x${string}`): Promise<string> {
  const bal = await publicClient.readContract({ address: USDT0, abi: erc20Abi, functionName: "balanceOf", args: [addr] });
  return formatUnits(bal, 6);
}

async function gasBalance(addr: `0x${string}`): Promise<string> {
  return formatUnits(await publicClient.getBalance({ address: addr }), 18);
}

console.log("VIGILOK — on-chain verification (X Layer, eip155:196)");
console.log(`  settlement token: USD₮0 ${USDT0}\n`);

const wallets: Array<[string, `0x${string}` | null]> = [
  ["treasury (PAY_TO)", treasury],
  ["patron/buyer", buyer],
  ["patron (alt key)", patron && patron !== buyer ? patron : null],
];
for (const [label, addr] of wallets) {
  if (!addr) continue;
  const [usd, gas] = await Promise.all([usdt0Balance(addr), gasBalance(addr)]);
  console.log(`  ${label.padEnd(18)} ${addr}  ${usd} USD₮0  |  ${gas} OKB`);
}

const latest = await publicClient.getBlockNumber();
const from = latest > LOOKBACK ? latest - LOOKBACK : 0n;
console.log(`\n  scanning USD₮0 transfers to treasury, blocks ${from}..${latest} (chunks of ${CHUNK})`);

interface Row {
  tx: string;
  from: string;
  usd: number;
  block: bigint;
}
const rows: Row[] = [];
const skippedRanges: Array<[bigint, bigint]> = [];

// Every 100-block window in [from, latest], as an explicit work queue rather
// than a sequential cursor, so CONCURRENCY workers can pull from it at once.
const ranges: Array<[bigint, bigint]> = [];
for (let s = from; s <= latest; s += CHUNK) {
  const e = s + CHUNK - 1n > latest ? latest : s + CHUNK - 1n;
  ranges.push([s, e]);
}

let done = 0;
let nextIdx = 0;
const RETRIES = 3;

async function worker(): Promise<void> {
  while (nextIdx < ranges.length) {
    const i = nextIdx++;
    const [start, end] = ranges[i];
    let ok = false;
    for (let attempt = 0; attempt < RETRIES && !ok; attempt++) {
      try {
        const logs = await scanClient.getLogs({ address: USDT0, event: TRANSFER, args: { to: treasury }, fromBlock: start, toBlock: end });
        for (const log of logs) {
          rows.push({ tx: log.transactionHash, from: getAddress(log.args.from!), usd: Number(formatUnits(log.args.value!, 6)), block: log.blockNumber });
        }
        ok = true;
      } catch {
        if (attempt < RETRIES - 1) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    if (!ok) skippedRanges.push([start, end]);
    done++;
    if (done % 500 === 0 || done === ranges.length) {
      process.stdout.write(`\r  scanned ${done}/${ranges.length} ranges...`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, worker));
if (ranges.length > 0) process.stdout.write("\n");
rows.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
if (skippedRanges.length > 0) {
  const skippedBlocks = skippedRanges.reduce((s, [a, b]) => s + Number(b - a + 1n), 0);
  console.log(`  ⚠ ${skippedRanges.length} range(s), ${skippedBlocks} blocks total, never returned after ${RETRIES} attempts — the totals below are a lower bound, not a full count.`);
}

if (rows.length === 0) {
  console.log("  no inbound USD₮0 transfers found in the scanned window.");
} else {
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const payers = new Set(rows.map((r) => r.from));
  console.log(`\n  ${rows.length} settlements  |  ${payers.size} distinct payer wallets  |  $${total.toFixed(4)} USD₮0 total\n`);
  const shown = rows.slice(-40);
  for (const r of shown) console.log(`   block ${r.block}  $${r.usd.toFixed(4).padStart(8)}  from ${r.from.slice(0, 10)}...  tx ${r.tx}`);
  if (rows.length > shown.length) console.log(`   ... and ${rows.length - shown.length} earlier settlements`);
  console.log(`\n  every row above is a real USD₮0 transfer on X Layer — check any tx on https://www.oklink.com/x-layer`);
}
