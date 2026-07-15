/**
 * X402Payer — the buyer half of VigilOK's own demo (and any autonomous agent
 * that wants to pay for a check/simulate call programmatically).
 *
 * Wire (OKX x402 v2): request -> 402 with `PAYMENT-REQUIRED`; sign the chosen
 * `accepts` entry; replay with `PAYMENT-SIGNATURE`; settlement comes back in
 * `PAYMENT-RESPONSE` (-> status / transaction / amount / payer).
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";

export interface Settlement {
  status?: string;
  transaction?: string;
  amount?: string;
  payer?: string;
}

export interface Quote {
  scheme?: string;
  network?: string;
  payTo?: string;
  value?: string;
}

export interface CallOutcome {
  httpStatus: number;
  paid: boolean;
  latencyMs: number;
  rawBody: string;
  body: unknown;
  quote: Quote | null;
  settlement: Settlement | null;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class X402Payer {
  private readonly http: x402HTTPClient;
  readonly address: string;

  constructor(privateKey: string, rpcUrl = process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech") {
    const account = privateKeyToAccount(privateKey as Hex);
    this.address = account.address;
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: account, schemeOptions: { rpcUrl }, networks: ["eip155:196"] });
    this.http = new x402HTTPClient(client);
  }

  async call(url: string, init: RequestInit = {}): Promise<CallOutcome> {
    const started = Date.now();
    const first = await fetch(url, init);
    if (first.status !== 402) {
      const text = await first.text();
      return { httpStatus: first.status, paid: false, latencyMs: Date.now() - started, rawBody: text, body: parseBody(text), quote: null, settlement: null };
    }

    const getHeader = (name: string) => first.headers.get(name);
    const paymentRequired = this.http.getPaymentRequiredResponse(getHeader);
    const quote = firstAccept(paymentRequired);

    const payload = await this.http.createPaymentPayload(paymentRequired);
    const paymentHeaders = this.http.encodePaymentSignatureHeader(payload);

    const paid = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...paymentHeaders } });
    const text = await paid.text();
    const settlement = safeSettle(this.http, (n) => paid.headers.get(n));

    return { httpStatus: paid.status, paid: paid.status < 300, latencyMs: Date.now() - started, rawBody: text, body: parseBody(text), quote, settlement };
  }
}

function firstAccept(paymentRequired: unknown): Quote | null {
  const accepts = (paymentRequired as { accepts?: Array<Record<string, unknown>> })?.accepts;
  if (!accepts?.length) return null;
  const a = accepts[0];
  return {
    scheme: a.scheme as string | undefined,
    network: a.network as string | undefined,
    payTo: a.payTo as string | undefined,
    value: (a.amount ?? a.value) as string | undefined,
  };
}

function safeSettle(http: x402HTTPClient, getHeader: (n: string) => string | null | undefined): Settlement | null {
  try {
    return http.getPaymentSettleResponse(getHeader) as unknown as Settlement;
  } catch {
    return null;
  }
}
