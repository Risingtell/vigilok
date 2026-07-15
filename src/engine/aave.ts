/**
 * Real Aave V3 (X Layer) position reads — health factor, per-asset collateral
 * and debt legs, and a liquidation stress simulation. Every number here comes
 * from a live on-chain read (Pool, Oracle, ProtocolDataProvider); nothing is
 * estimated or faked.
 */
import { type Address, getAddress, zeroAddress } from "viem";
import { publicClient, AAVE_V3_XLAYER } from "../chain/xlayer.js";
import { POOL_ABI, ORACLE_ABI, DATA_PROVIDER_ABI, ERC20_ABI } from "./abi.js";

const WAD = 10n ** 18n; // Aave expresses healthFactor and bps-style ratios in 18-decimal fixed point
const MAX_UINT256 = 2n ** 256n - 1n;

export type RiskLevel = "NO_DEBT" | "SAFE" | "CAUTION" | "DANGER" | "LIQUIDATABLE";

export interface ReserveLeg {
  asset: Address;
  symbol: string;
  decimals: number;
  priceUsd: number;
  collateralUsd: number;
  debtUsd: number;
  liquidationThreshold: number; // fraction, e.g. 0.75
  usageAsCollateralEnabled: boolean;
}

export interface PositionSnapshot {
  address: Address;
  hasPosition: boolean;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  availableBorrowsUsd: number;
  weightedLiquidationThreshold: number; // fraction
  ltv: number; // fraction
  healthFactor: number | null; // null = no debt, effectively infinite
  riskLevel: RiskLevel;
  legs: ReserveLeg[];
}

export function classifyRisk(healthFactor: number | null): RiskLevel {
  if (healthFactor === null) return "NO_DEBT";
  if (healthFactor < 1.0) return "LIQUIDATABLE";
  if (healthFactor < 1.1) return "DANGER";
  if (healthFactor < 1.5) return "CAUTION";
  return "SAFE";
}

async function baseCurrencyUnit(): Promise<bigint> {
  return publicClient.readContract({ address: AAVE_V3_XLAYER.ORACLE, abi: ORACLE_ABI, functionName: "BASE_CURRENCY_UNIT" });
}

async function reservesList(): Promise<readonly Address[]> {
  return publicClient.readContract({ address: AAVE_V3_XLAYER.POOL, abi: POOL_ABI, functionName: "getReservesList" });
}

/** Per-asset legs for a user across every Aave reserve — the raw material for both check() and simulate(). */
export async function getPositionLegs(user: Address): Promise<{ legs: ReserveLeg[]; baseUnit: bigint }> {
  const [assets, baseUnit] = await Promise.all([reservesList(), baseCurrencyUnit()]);

  const legs = await Promise.all(
    assets.map(async (asset): Promise<ReserveLeg | null> => {
      const [userReserve, config] = await Promise.all([
        publicClient.readContract({ address: AAVE_V3_XLAYER.PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [asset, user] }),
        publicClient.readContract({ address: AAVE_V3_XLAYER.PROTOCOL_DATA_PROVIDER, abi: DATA_PROVIDER_ABI, functionName: "getReserveConfigurationData", args: [asset] }),
      ]);
      const [aTokenBalance, , currentVariableDebt, , , , , , usageAsCollateralEnabled] = userReserve;
      const [decimals, , liquidationThreshold] = config;
      const totalDebtRaw = currentVariableDebt; // stable debt deprecated across recent Aave V3 pools; variable covers real usage
      if (aTokenBalance === 0n && totalDebtRaw === 0n) return null; // no position in this reserve — skip the extra calls below

      const [price, symbol] = await Promise.all([
        publicClient.readContract({ address: AAVE_V3_XLAYER.ORACLE, abi: ORACLE_ABI, functionName: "getAssetPrice", args: [asset] }),
        publicClient.readContract({ address: asset, abi: ERC20_ABI, functionName: "symbol" }).catch(() => asset.slice(0, 8)),
      ]);

      const priceUsd = Number(price) / Number(baseUnit);
      const scale = 10 ** Number(decimals);
      return {
        asset,
        symbol,
        decimals: Number(decimals),
        priceUsd,
        collateralUsd: (Number(aTokenBalance) / scale) * priceUsd,
        debtUsd: (Number(totalDebtRaw) / scale) * priceUsd,
        liquidationThreshold: Number(liquidationThreshold) / 10_000,
        usageAsCollateralEnabled,
      };
    }),
  );

  return { legs: legs.filter((l): l is ReserveLeg => l !== null), baseUnit };
}

export async function checkPosition(address: string): Promise<PositionSnapshot> {
  const user = getAddress(address);
  const [account, { legs }] = await Promise.all([
    publicClient.readContract({ address: AAVE_V3_XLAYER.POOL, abi: POOL_ABI, functionName: "getUserAccountData", args: [user] }),
    getPositionLegs(user),
  ]);
  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactorRaw] = account;

  const healthFactor = totalDebtBase === 0n || healthFactorRaw >= MAX_UINT256 / 2n ? null : Number(healthFactorRaw) / Number(WAD);

  return {
    address: user,
    hasPosition: totalCollateralBase > 0n || totalDebtBase > 0n,
    totalCollateralUsd: legs.reduce((s, l) => s + l.collateralUsd, 0),
    totalDebtUsd: legs.reduce((s, l) => s + l.debtUsd, 0),
    availableBorrowsUsd: Number(availableBorrowsBase) / 1e8, // Aave's Base currency on X Layer is USD-denominated, 8 decimals (verified in preflight)
    weightedLiquidationThreshold: Number(currentLiquidationThreshold) / 10_000,
    ltv: Number(ltv) / 10_000,
    healthFactor,
    riskLevel: classifyRisk(healthFactor),
    legs,
  };
}

export interface SimulationInput {
  address: string;
  /** Reserve asset address or symbol (case-insensitive) to shock. */
  asset: string;
  /** Percent price change, e.g. -15 for a 15% drop. */
  pctChange: number;
}

export interface SimulationResult extends PositionSnapshot {
  shockedAsset: Address;
  shockedAssetSymbol: string;
  pctChange: number;
  baselineHealthFactor: number | null;
  wouldLiquidate: boolean;
}

/** Recomputes health factor after shocking one asset's price — collateral and debt legs both reprice if the user holds that asset on either side. */
export async function simulatePosition(input: SimulationInput): Promise<SimulationResult> {
  const user = getAddress(input.address);
  const { legs } = await getPositionLegs(user);
  if (legs.length === 0) {
    throw new Error("wallet has no open Aave V3 position on X Layer to simulate");
  }

  const target = legs.find(
    (l) => l.asset.toLowerCase() === input.asset.toLowerCase() || l.symbol.toLowerCase() === input.asset.toLowerCase(),
  );
  if (!target) {
    throw new Error(`wallet has no exposure to ${input.asset} — has: ${legs.map((l) => l.symbol).join(", ")}`);
  }

  const factor = 1 + input.pctChange / 100;
  const shocked = legs.map((l) => (l.asset === target.asset ? { ...l, collateralUsd: l.collateralUsd * factor, debtUsd: l.debtUsd * factor } : l));

  const totalCollateralUsd = shocked.reduce((s, l) => s + l.collateralUsd, 0);
  const totalDebtUsd = shocked.reduce((s, l) => s + l.debtUsd, 0);
  const weightedThresholdNumerator = shocked.reduce((s, l) => s + (l.usageAsCollateralEnabled ? l.collateralUsd * l.liquidationThreshold : 0), 0);
  const weightedLiquidationThreshold = totalCollateralUsd > 0 ? weightedThresholdNumerator / totalCollateralUsd : 0;

  const healthFactor = totalDebtUsd === 0 ? null : (totalCollateralUsd * weightedLiquidationThreshold) / totalDebtUsd;

  const baseline = await checkPosition(input.address);

  return {
    address: user,
    hasPosition: true,
    totalCollateralUsd,
    totalDebtUsd,
    availableBorrowsUsd: baseline.availableBorrowsUsd,
    weightedLiquidationThreshold,
    ltv: baseline.ltv,
    healthFactor,
    riskLevel: classifyRisk(healthFactor),
    legs: shocked,
    shockedAsset: target.asset,
    shockedAssetSymbol: target.symbol,
    pctChange: input.pctChange,
    baselineHealthFactor: baseline.healthFactor,
    wouldLiquidate: healthFactor !== null && healthFactor < 1.0 && (baseline.healthFactor === null || baseline.healthFactor >= 1.0),
  };
}

export { zeroAddress };
