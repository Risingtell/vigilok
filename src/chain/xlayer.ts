/**
 * X Layer (eip155:196) chain definition + shared viem public client.
 * The only network the OKX Agent Payments Protocol settles on — and, since
 * Aave V3 is deployed here too, the same chain VigilOK reads positions from.
 */
import { createPublicClient, defineChain, http } from "viem";

export const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? "https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/x-layer" } },
});

/** USD₮0 — the settlement token for every VigilOK service (6 decimals). */
export const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;

export const publicClient = createPublicClient({ chain: xlayer, transport: http() });

/**
 * Aave V3 on X Layer — from the canonical aave-dao/aave-address-book
 * (src/AaveV3XLayer.sol), cross-checked live against OKLink (labelled
 * "Aave V3") before anything here was built on top of it.
 */
export const AAVE_V3_XLAYER = {
  POOL: "0xE3F3Caefdd7180F884c01E57f65Df979Af84f116",
  POOL_ADDRESSES_PROVIDER: "0xdFf435BCcf782f11187D3a4454d96702eD78e092",
  PROTOCOL_DATA_PROVIDER: "0x6C505C31714f14e8af2A03633EB2Cdfb4959138F",
  ORACLE: "0x91FC11136d5615575a0fC5981Ab5C0C54418E2C6",
} as const;
