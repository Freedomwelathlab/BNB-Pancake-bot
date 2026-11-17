// Contract addresses and event topics on BNB Smart Chain (chainId 56).
// Verified 2026-11-17 against developer.pancakeswap.finance and live mainnet receipts.
// Re-verify on BscScan before enabling live trading: contracts can be upgraded or replaced.
import type { Address } from 'viem';

export const CHAIN_ID = 56;

export const ADDR = {
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  PCS_V2_FACTORY: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  PCS_V2_ROUTER: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  PCS_V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  PCS_V3_QUOTER_V2: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
  PCS_SMART_ROUTER: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  // Four.meme exchange proxy (TokenManager2). Emits TokenCreate / TokenPurchase / TokenSale.
  FOUR_MEME_PROXY: '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
  FOUR_MEME_HELPER3: '0xF251F83e40a78868FcfA3FA4599Dad6494E46034',
} as const satisfies Record<string, Address>;

// Contracts the live executor may send transactions to. Anything else is refused.
export const TX_ALLOWLIST: ReadonlySet<string> = new Set(
  [ADDR.PCS_V2_ROUTER, ADDR.PCS_SMART_ROUTER].map((a) => a.toLowerCase()),
);

// Fee tiers in basis points.
export const PCS_V2_FEE_BPS = 25; // 0.25%
export const FOUR_MEME_CURVE_FEE_BPS = 100; // 1% each side on the bonding curve (SDK default)

export const ABI = {
  erc20: [
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
    { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  ],
  v2Pair: [
    { type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [], outputs: [{ name: 'r0', type: 'uint112' }, { name: 'r1', type: 'uint112' }, { name: 't', type: 'uint32' }] },
    { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  ],
  v2Router: [
    { type: 'function', name: 'getAmountsOut', stateMutability: 'view', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
    { type: 'function', name: 'swapExactETHForTokensSupportingFeeOnTransferTokens', stateMutability: 'payable', inputs: [{ name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'swapExactTokensForETHSupportingFeeOnTransferTokens', stateMutability: 'nonpayable', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' }], outputs: [] },
  ],
  v2Factory: [
    { type: 'function', name: 'getPair', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }], outputs: [{ type: 'address' }] },
    { type: 'event', name: 'PairCreated', inputs: [{ name: 'token0', type: 'address', indexed: true }, { name: 'token1', type: 'address', indexed: true }, { name: 'pair', type: 'address', indexed: false }, { name: 'n', type: 'uint256', indexed: false }] },
  ],
  v3Factory: [
    { type: 'event', name: 'PoolCreated', inputs: [{ name: 'token0', type: 'address', indexed: true }, { name: 'token1', type: 'address', indexed: true }, { name: 'fee', type: 'uint24', indexed: true }, { name: 'tickSpacing', type: 'int24', indexed: false }, { name: 'pool', type: 'address', indexed: false }] },
  ],
  v3QuoterV2: [
    {
      type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
      inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
      outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' }, { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' }],
    },
  ],
  smartRouter: [
    {
      type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
      inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
      outputs: [{ name: 'amountOut', type: 'uint256' }],
    },
    { type: 'function', name: 'unwrapWETH9', stateMutability: 'payable', inputs: [{ name: 'amountMinimum', type: 'uint256' }, { name: 'recipient', type: 'address' }], outputs: [] },
    { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'data', type: 'bytes[]' }], outputs: [{ type: 'bytes[]' }] },
  ],
  fourMeme: [
    // Topics verified against mainnet receipts on 2026-11-17.
    { type: 'event', name: 'TokenCreate', inputs: [{ name: 'creator', type: 'address', indexed: false }, { name: 'token', type: 'address', indexed: false }, { name: 'requestId', type: 'uint256', indexed: false }, { name: 'name', type: 'string', indexed: false }, { name: 'symbol', type: 'string', indexed: false }, { name: 'totalSupply', type: 'uint256', indexed: false }, { name: 'launchTime', type: 'uint256', indexed: false }, { name: 'launchFee', type: 'uint256', indexed: false }] },
    { type: 'event', name: 'TokenPurchase', inputs: [{ name: 'token', type: 'address', indexed: false }, { name: 'account', type: 'address', indexed: false }, { name: 'price', type: 'uint256', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'cost', type: 'uint256', indexed: false }, { name: 'fee', type: 'uint256', indexed: false }, { name: 'offers', type: 'uint256', indexed: false }, { name: 'funds', type: 'uint256', indexed: false }] },
    { type: 'event', name: 'TokenSale', inputs: [{ name: 'token', type: 'address', indexed: false }, { name: 'account', type: 'address', indexed: false }, { name: 'price', type: 'uint256', indexed: false }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'cost', type: 'uint256', indexed: false }, { name: 'fee', type: 'uint256', indexed: false }, { name: 'offers', type: 'uint256', indexed: false }, { name: 'funds', type: 'uint256', indexed: false }] },
  ],
  fourHelper3: [
    { type: 'function', name: 'getTokenInfo', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ name: 'version', type: 'uint256' }, { name: 'tokenManager', type: 'address' }, { name: 'quote', type: 'address' }, { name: 'lastPrice', type: 'uint256' }, { name: 'tradingFeeRate', type: 'uint256' }, { name: 'minTradingFee', type: 'uint256' }, { name: 'launchTime', type: 'uint256' }, { name: 'offers', type: 'uint256' }, { name: 'maxOffers', type: 'uint256' }, { name: 'funds', type: 'uint256' }, { name: 'maxFunds', type: 'uint256' }, { name: 'liquidityAdded', type: 'bool' }] },
  ],
} as const;

// SmartRouter sentinel recipient meaning "keep in router" (used before unwrapWETH9).
export const ROUTER_ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';

// Established, centrally issued assets on BSC (Binance-Peg majors, CAKE). For these the
// scorer skips holder-concentration, LP-lock and "mintable by issuer" checks; every other
// check (honeypot sim, taxes, blacklist, pause, hidden owner...) still applies.
// Issuer/custody risk is accepted explicitly by including a token here.
export const BLUE_CHIPS: Record<string, string> = {
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': 'BTCB',
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8': 'ETH',
  '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82': 'CAKE',
  '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe': 'XRP',
  '0xba2ae424d960c26247dd6c32edc70b295c744c43': 'DOGE',
  '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47': 'ADA',
  '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd': 'LINK',
  '0x7083609fce4d1d8dc0c979aab8c869ea2c873402': 'DOT',
};
