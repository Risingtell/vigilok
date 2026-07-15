/**
 * MPP surface — the continuous-monitoring rail, alongside x402 (check/simulate).
 *
 *   /session/watch  MPP session channel — one on-chain deposit, then off-chain
 *                   per-recheck vouchers, so an agent can keep a position under
 *                   watch without a fresh on-chain payment every poll.
 */
import type { Request as ExReq, Response as ExRes } from "express";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { Mppx } from "@okxweb3/mpp";
import { SaApiClient } from "@okxweb3/mpp/evm";
import { session } from "@okxweb3/mpp/evm/server";
import { USDT0 } from "../chain/xlayer.js";
import { checkPosition } from "../engine/aave.js";

const CHAIN_ID = 196;
const ESCROW = process.env.MPP_ESCROW ?? "0x5E550002e64FaF79B41D89fE8439eEb1be66CE3b";

type MppResult =
  | { status: 402; challenge: Response }
  | { status: 200; withReceipt: (res: Response) => Response };

interface MppLike {
  session: (opts: unknown) => (req: Request) => Promise<MppResult>;
}

let cached: MppLike | null = null;

function mpp(): MppLike {
  if (cached) return cached;
  const saClient = new SaApiClient({
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    passphrase: process.env.OKX_PASSPHRASE!,
    ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
  });
  // Session vouchers are signed by the treasury key; its address must equal `recipient` (PAY_TO).
  const signer = privateKeyToAccount(process.env.MPP_MERCHANT_PRIVATE_KEY as Hex);
  cached = Mppx.create({
    methods: [session({ saClient, signer })],
    realm: process.env.MPP_REALM ?? "vigilok.watch",
    secretKey: process.env.MPP_SECRET_KEY!,
  }) as unknown as MppLike;
  return cached;
}

// ---- Express <-> Web Standards bridge (MPP speaks Request/Response) ----

function toWeb(req: ExReq): Request {
  const url = `https://${req.headers.host ?? "localhost"}${req.originalUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(","));
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    init.body = JSON.stringify(req.body ?? {});
  }
  return new Request(url, init);
}

async function send(res: ExRes, webRes: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(await webRes.text());
}

/** Continuous monitoring channel: deposit once, then pay per re-check with off-chain vouchers. */
export async function watchSessionHandler(req: ExReq, res: ExRes): Promise<void> {
  const sessionOpts = {
    amount: "500", // unit price: 0.0005 USD₮0 per re-check
    currency: USDT0,
    recipient: process.env.PAY_TO!,
    description: "VigilOK watch — per-recheck position monitoring channel",
    unitType: "check",
    suggestedDeposit: "50000", // ~100 rechecks
    methodDetails: {
      chainId: CHAIN_ID,
      escrowContract: ESCROW,
      feePayer: true,
      minVoucherDelta: "0",
    },
  };
  const { address, alertBelow } = (req.body ?? {}) as { address?: string; alertBelow?: number };
  if (!address) {
    res.status(400).json({ error: "body must include { address }" });
    return;
  }
  try {
    const result = await mpp().session(sessionOpts)(toWeb(req));
    if (result.status === 402) return send(res, result.challenge);
    // Every paid recheck runs the real Aave read — a session channel isn't a
    // discount on the work, just on the settlement overhead per check.
    const snapshot = await checkPosition(address);
    const threshold = alertBelow ?? 1.1;
    const alert = snapshot.healthFactor !== null && snapshot.healthFactor < threshold;
    return send(res, result.withReceipt(Response.json({ ...snapshot, alert, alertThreshold: threshold })));
  } catch (e) {
    res.status(500).json({ error: `watch session failed: ${(e as Error).message}` });
  }
}
