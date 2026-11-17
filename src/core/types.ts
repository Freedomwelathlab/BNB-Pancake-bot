// Shared types. All BNB amounts in the decision layer are plain numbers in BNB
// (not wei); conversion to bigint happens only at the chain boundary.

export interface Candle {
  t: number; // open time, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume in quote units (informational)
}

export type Venue = 'pcs_v2' | 'pcs_v3';

export interface MarketRef {
  token: string; // token traded against WBNB
  pool: string;
  venue: Venue;
  feeBps: number; // pool swap fee
  symbol?: string;
}

/** Liquidity snapshot used for slippage: BNB-side reserve of a constant-product pool. */
export interface LiquidityState {
  reserveBnb: number;
  liquidityUsd?: number;
}

export interface CostInputs {
  sizeBnb: number;
  feeBps: number; // per swap
  buyTaxBps: number;
  sellTaxBps: number;
  reserveBnb: number; // BNB side of the pool (for price impact)
  gasBnbPerSwap: number;
  failureProb: number; // probability a swap reverts and only gas is lost
}

export interface SafetyFacts {
  token: string;
  goplus?: GoPlusFacts | null; // null = source failed / no data
  honeypot?: HoneypotFacts | null;
  market?: MarketFacts | null;
}

export interface GoPlusFacts {
  isHoneypot: boolean;
  isOpenSource: boolean;
  isProxy: boolean;
  isMintable: boolean;
  canTakeBackOwnership: boolean;
  ownerChangeBalance: boolean;
  hiddenOwner: boolean;
  selfDestruct: boolean;
  externalCall: boolean;
  isBlacklisted: boolean;
  isWhitelisted: boolean;
  transferPausable: boolean;
  tradingCooldown: boolean;
  slippageModifiable: boolean; // tax changeable
  personalSlippageModifiable: boolean;
  cannotSellAll: boolean;
  cannotBuy: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  holderCount: number;
  top10HolderPct: number; // excluding LP/burn/locked addresses
  creatorPct: number;
  ownerAddress: string | null;
  lpLockedOrBurnedPct: number; // share of LP tokens burned or locked
  lpHolderCount: number; // 0 = unknown (e.g. V3 NFT positions)
  lpTopHolderPct: number; // largest single LP holder (excluding burn/lock)
}

export interface HoneypotFacts {
  isHoneypot: boolean;
  simulationSuccess: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  transferTaxPct: number;
  flags: string[];
}

export interface MarketFacts {
  liquidityUsd: number;
  pairAgeMinutes: number;
  volume1hUsd: number;
  volume24hUsd: number;
  buys1h: number;
  sells1h: number;
  priceChange1hPct: number;
  fdvUsd: number | null;
}

export interface SafetyVerdict {
  pass: boolean;
  score: number; // 0..100, higher is safer
  hardRejects: string[];
  warnings: string[];
  sourcesOk: number;
  buyTaxPct: number;
  sellTaxPct: number;
}

export type ExitReason = 'hard_stop' | 'trailing_stop' | 'take_profit' | 'time_exit' | 'illiquidity' | 'kill_switch' | 'manual' | 'end_of_data';

export interface Position {
  id: string;
  token: string;
  strategy: string;
  entryTime: number; // unix s
  entryPrice: number; // BNB per token, after slippage
  sizeBnb: number; // BNB spent
  remainingFrac: number; // 1 = full position
  highWater: number; // highest price seen since entry
  realizedBnb: number; // BNB received from partial exits so far
  stagesTaken: number;
  entryReserveBnb: number;
}

export interface ExitDecision {
  action: 'hold' | 'exit';
  fraction: number; // fraction of the ORIGINAL position to sell now
  reason?: ExitReason;
  price?: number; // fill reference price
}

export interface Trade {
  id: string;
  token: string;
  strategy: string;
  entryTime: number;
  exitTime: number;
  sizeBnb: number;
  proceedsBnb: number; // net BNB back after fees, taxes, slippage, gas
  pnlBnb: number;
  returnPct: number;
  exitReason: ExitReason;
}
