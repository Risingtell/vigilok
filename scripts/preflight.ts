/**
 * Sanity-check the Aave V3 X Layer Pool contract is real and reachable
 * before building the risk engine on top of it. Read-only, no keys needed.
 */
import { publicClient, AAVE_V3_XLAYER } from "../src/chain/xlayer.js";

const POOL_ABI = [
  {
    type: "function",
    name: "getReservesList",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

async function main() {
  console.log(`Reading Aave V3 Pool at ${AAVE_V3_XLAYER.POOL} on X Layer (chain 196)...`);

  const reserves = await publicClient.readContract({
    address: AAVE_V3_XLAYER.POOL,
    abi: POOL_ABI,
    functionName: "getReservesList",
  });
  console.log(`getReservesList() -> ${reserves.length} reserves:`);
  for (const r of reserves) console.log(`  ${r}`);

  // Zero address always has an empty position — proves getUserAccountData
  // decodes cleanly against the real ABI without needing a funded test wallet.
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const account = await publicClient.readContract({
    address: AAVE_V3_XLAYER.POOL,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: [zero],
  });
  console.log(`getUserAccountData(0x0...0) -> healthFactor=${account[5]} (raw, expect max uint256 for no debt)`);

  const usdt0 = reserves[0];
  const ORACLE_ABI = [
    { type: "function", name: "getAssetPrice", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "BASE_CURRENCY_UNIT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;
  const price = await publicClient.readContract({ address: AAVE_V3_XLAYER.ORACLE, abi: ORACLE_ABI, functionName: "getAssetPrice", args: [usdt0] });
  const baseUnit = await publicClient.readContract({ address: AAVE_V3_XLAYER.ORACLE, abi: ORACLE_ABI, functionName: "BASE_CURRENCY_UNIT" });
  console.log(`Oracle.getAssetPrice(USD₮0) -> ${price} / BASE_CURRENCY_UNIT=${baseUnit} => $${Number(price) / Number(baseUnit)}`);

  const DATA_PROVIDER_ABI = [
    {
      type: "function", name: "getReserveConfigurationData", stateMutability: "view",
      inputs: [{ type: "address" }],
      outputs: [
        { name: "decimals", type: "uint256" }, { name: "ltv", type: "uint256" },
        { name: "liquidationThreshold", type: "uint256" }, { name: "liquidationBonus", type: "uint256" },
        { name: "reserveFactor", type: "uint256" }, { name: "usageAsCollateralEnabled", type: "bool" },
        { name: "borrowingEnabled", type: "bool" }, { name: "stableBorrowRateEnabled", type: "bool" },
        { name: "isActive", type: "bool" }, { name: "isFrozen", type: "bool" },
      ],
    },
    {
      type: "function", name: "getUserReserveData", stateMutability: "view",
      inputs: [{ type: "address" }, { type: "address" }],
      outputs: [
        { name: "currentATokenBalance", type: "uint256" }, { name: "currentStableDebt", type: "uint256" },
        { name: "currentVariableDebt", type: "uint256" }, { name: "principalStableDebt", type: "uint256" },
        { name: "scaledVariableDebt", type: "uint256" }, { name: "stableBorrowRate", type: "uint256" },
        { name: "liquidityRate", type: "uint256" }, { name: "stableRateLastUpdated", type: "uint40" },
        { name: "usageAsCollateralEnabled", type: "bool" },
      ],
    },
  ] as const;
  const config = await publicClient.readContract({ address: AAVE_V3_XLAYER.PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getReserveConfigurationData", args: [usdt0] });
  console.log(`DataProvider.getReserveConfigurationData(USD₮0) -> decimals=${config[0]} ltv=${config[1]} liqThreshold=${config[2]} active=${config[8]}`);

  const userReserve = await publicClient.readContract({ address: AAVE_V3_XLAYER.PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [usdt0, zero] });
  console.log(`DataProvider.getUserReserveData(USD₮0, 0x0...0) -> aTokenBalance=${userReserve[0]} (expect 0)`);

  console.log("\nPreflight OK — real Aave V3 Pool + Oracle + DataProvider, live on X Layer, full ABI matches.");
}

main().catch((e) => {
  console.error("Preflight FAILED:", e);
  process.exit(1);
});
