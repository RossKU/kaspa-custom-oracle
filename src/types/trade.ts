// Trade Execution Types

export interface TradeParams {
  // Exchanges
  buyExchange: string;
  sellExchange: string;

  // Prices (for verification)
  expectedBuyPrice: number;
  expectedSellPrice: number;

  // Quantity
  quantity: number; // Amount in KAS

  // Order type
  orderType: 'Market' | 'Limit';

  // Slippage protection
  maxSlippagePercent?: number; // Max acceptable price movement

  // Confirmation
  userConfirmed: boolean;
}

export interface TradeEstimate {
  // Costs
  buyAmount: number; // Total USDT needed to buy
  buyFee: number; // Fee in USDT
  totalBuyCost: number; // buyAmount + buyFee

  // Proceeds
  sellAmount: number; // Total USDT received from sell
  sellFee: number; // Fee in USDT
  totalSellProceeds: number; // sellAmount - sellFee

  // Net
  netProfit: number; // totalSellProceeds - totalBuyCost
  netProfitPercent: number; // (netProfit / totalBuyCost) * 100

  // Breakdown
  rawGap: number;
  rawGapPercent: number;
  totalFeesPercent: number;
}

export interface TradeResult {
  success: boolean;

  // Buy order
  buyOrder?: {
    orderId: string;
    exchange: string;
    side: 'Buy';
    symbol: string;
    quantity: number;
    price: number;
    status: string;
    timestamp: number;
  };

  // Sell order
  sellOrder?: {
    orderId: string;
    exchange: string;
    side: 'Sell';
    symbol: string;
    quantity: number;
    price: number;
    status: string;
    timestamp: number;
  };

  // Actual results
  actualProfit?: number;
  actualProfitPercent?: number;

  // Error info
  error?: {
    message: string;
    phase: 'pre-check' | 'buy-order' | 'sell-order' | 'post-execution';
    details?: any;
  };
}

export interface TradeAuthState {
  isAuthenticated: boolean;
  lastAuthTime: number | null;
  sessionTimeout: number; // in milliseconds (e.g., 3600000 for 1 hour)
}

// Password for Trade Tab access
// Change this in production or implement proper authentication
export const TRADE_PASSWORD = 'KAS2025Arb';

// Session timeout (1 hour)
export const SESSION_TIMEOUT = 3600000;
