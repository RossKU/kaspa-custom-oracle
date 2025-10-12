// Gap Detection Types
// "Gap" = Price difference between exchanges (avoiding confusion with bid-ask spread)

export interface ExchangeFees {
  maker: number; // Percentage (e.g., 0.02 for 0.02%)
  taker: number; // Percentage (e.g., 0.04 for 0.04%)
}

export interface ExchangePrice {
  exchange: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
  type: string; // 'S' for Spot, 'F' for Futures
}

export interface GapOpportunity {
  // Buy side
  buyExchange: string;
  buyPrice: number; // Ask price (what you pay)

  // Sell side
  sellExchange: string;
  sellPrice: number; // Bid price (what you receive)

  // Gap metrics
  rawGap: number; // sellPrice - buyPrice
  rawGapPercent: number; // (rawGap / buyPrice) * 100

  // Fee calculation
  buyFee: number; // Percentage
  sellFee: number; // Percentage
  totalFees: number; // buyFee + sellFee

  // Net profit
  netGapPercent: number; // rawGapPercent - totalFees
  estimatedProfit: number; // For given quantity

  // Additional info
  timestamp: number;
  isProfitable: boolean; // netGapPercent > 0
  confidence: 'high' | 'medium' | 'low'; // Based on data freshness
}

export interface GapDetectionConfig {
  minGapPercent: number; // Minimum gap to consider (e.g., 0.1 for 0.1%)
  maxPriceStaleness: number; // Max age of price data in ms
  excludeExchanges?: string[]; // Exchanges to exclude from gap detection
}

export interface GapAnalysis {
  opportunities: GapOpportunity[];
  bestOpportunity: GapOpportunity | null;
  averageGap: number;
  priceSpread: {
    highest: ExchangePrice;
    lowest: ExchangePrice;
  };
  lastUpdate: number;
}
