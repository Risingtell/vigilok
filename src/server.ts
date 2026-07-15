/**
 * VigilOK — the DeFi position risk sentinel.
 *
 * Real Aave V3 (X Layer) position reads, settled via the OKX Agent Payments
 * Protocol. Three surfaces:
 *
 *   POST /api/check     x402 exact   $0.01   health-factor snapshot for a wallet
 *   POST /api/simulate   x402 exact   $0.02   stress-test a position against a hypothetical price move
 *   POST /session/watch  MPP session          continuous re-check channel, alerts on threshold breach
 *
 * The x402 body-mirror and GET/POST challenge parity below are baked in from
 * day one — both were post-listing review fixes on Argus (see argus/SUBMISSION.md
 * history); no reason to relearn them here.
 */
import "dotenv/config";
import express from "express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import {
  x402ResourceServer,
  x402HTTPResourceServer,
  paymentMiddlewareFromHTTPServer,
} from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { checkPosition, simulatePosition } from "./engine/aave.js";
import { watchSessionHandler } from "./payments/mpp.js";

const PORT = Number(process.env.PORT ?? 4100);
const PAY_TO = process.env.PAY_TO ?? "0x0000000000000000000000000000000000000000";
const NETWORK = "eip155:196" as const; // X Layer mainnet — payment chain AND the chain the positions live on

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY!,
  secretKey: process.env.OKX_SECRET_KEY!,
  passphrase: process.env.OKX_PASSPHRASE!,
  syncSettle: true,
  ...(process.env.OKX_BASE_URL ? { baseUrl: process.env.OKX_BASE_URL } : {}),
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

function mirrorChallengeInBody(
  accepts: { scheme: string; network: typeof NETWORK; payTo: string; price: string; maxTimeoutSeconds: number },
  description: string,
  mimeType: string,
) {
  return async (context: { adapter: { getUrl(): string } }) => {
    const requirements = await resourceServer.buildPaymentRequirementsFromOptions([accepts], context);
    const paymentRequired = await resourceServer.createPaymentRequiredResponse(
      requirements,
      { url: context.adapter.getUrl(), description, mimeType },
      "Payment required",
    );
    return { contentType: "application/json", body: paymentRequired };
  };
}

const checkAccepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.01", maxTimeoutSeconds: 300 };
const simulateAccepts = { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.02", maxTimeoutSeconds: 300 };

function route(description: string, accepts: typeof checkAccepts) {
  return { description, mimeType: "application/json", accepts, unpaidResponseBody: mirrorChallengeInBody(accepts, description, "application/json") };
}

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "POST /api/check": route("Aave V3 (X Layer) health-factor snapshot for a wallet", checkAccepts),
  "GET /api/check": route("Aave V3 (X Layer) health-factor snapshot for a wallet", checkAccepts),
  "POST /api/simulate": route("Stress-test a position against a hypothetical asset price move", simulateAccepts),
  "GET /api/simulate": route("Stress-test a position against a hypothetical asset price move", simulateAccepts),
});

const app = express();
app.set("trust proxy", true); // Render/Cloudflare terminate TLS in front — trust X-Forwarded-Proto so 402 challenge URLs are https://
app.use(express.json());

let paymentsReady = false;

async function initWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await httpServer.initialize();
      paymentsReady = true;
      console.log(`Facilitator ready — paid surfaces live on X Layer (${NETWORK}).`);
      return;
    } catch (e) {
      const wait = Math.min(60_000, 2_000 * attempt);
      console.warn(`Facilitator init failed (attempt ${attempt}): ${(e as Error).message}. Retrying in ${wait / 1000}s.`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

process.on("unhandledRejection", (reason) => console.error("unhandledRejection:", reason));

app.get("/", (_req, res) =>
  res.json({
    name: "VigilOK",
    tagline: "The DeFi position risk sentinel — real Aave V3 health checks, settled per-query on X Layer",
    paymentsReady,
    surfaces: {
      check: "POST /api/check — $0.01 x402/exact — { address } -> health-factor snapshot",
      simulate: "POST /api/simulate — $0.02 x402/exact — { address, asset, pctChange } -> stressed health factor",
      watch: "POST /session/watch — MPP session channel — { address, alertBelow? } -> continuous re-checks + threshold alert",
    },
    protocols: ["x402: exact", "MPP: session"],
    network: "X Layer (eip155:196), settled in USD₮0",
    dataSource: "Aave V3 Pool 0xE3F3Caefdd7180F884c01E57f65Df979Af84f116 (X Layer mainnet, live)",
  }),
);

app.get("/healthz", (_req, res) => res.json({ ok: true, paymentsReady }));

app.use((req, res, next) => {
  if (!paymentsReady && req.method === "POST") {
    return res.status(503).json({ error: "payment facilitator initializing — retry shortly", paymentsReady });
  }
  next();
});

app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));

app.post("/api/check", async (req, res) => {
  const { address } = req.body ?? {};
  if (!address) return res.status(400).json({ error: "body must include { address }" });
  try {
    res.json(await checkPosition(String(address)));
  } catch (e) {
    res.status(400).json({ error: `check failed: ${(e as Error).message}` });
  }
});

app.post("/api/simulate", async (req, res) => {
  const { address, asset, pctChange } = req.body ?? {};
  if (!address || !asset || typeof pctChange !== "number") {
    return res.status(400).json({ error: "body must include { address, asset, pctChange }" });
  }
  try {
    res.json(await simulatePosition({ address: String(address), asset: String(asset), pctChange }));
  } catch (e) {
    res.status(400).json({ error: `simulate failed: ${(e as Error).message}` });
  }
});

// MPP-gated route (self-handles its own 402 — not intercepted by the x402 middleware above)
app.post("/session/watch", watchSessionHandler);

app.listen(PORT, () => {
  console.log(`VigilOK watching on :${PORT} — discovery live, warming facilitator (${NETWORK})...`);
  void initWithRetry();
});
