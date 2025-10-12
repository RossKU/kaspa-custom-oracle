// Gap Detector Service
// Analyzes price differences between exchanges for arbitrage opportunities

import type {
  ExchangeFees,
  ExchangePrice,
  GapOpportunity,
  GapDetectionConfig,
  GapAnalysis
} from '../types/gap';
import { logger } from '../utils/logger';

// Exchange fee structures (using Taker fees for Market orders)
const EXCHANGE_FEES: Record<string, ExchangeFees> = {
  'Bybit': { maker: 0.01, taker: 0.06 },
  'BingX': { maker: 0.02, taker: 0.04 },
  'Binance': { maker: 0.02, taker: 0.04 },
  'MEXC': { maker: 0.00, taker: 0.10 },  // 0% maker, 0.1% taker
  'Gate.io': { maker: 0.15, taker: 0.15 },
  'Kucoin': { maker: 0.10, taker: 0.10 }
};

export class GapDetector {
  private config: GapDetectionConfig;

  constructor(config?: Partial<GapDetectionConfig>) {
    this.config = {
      minGapPercent: 0.1, // Default: 0.1% minimum
      maxPriceStaleness: 5000, // 5 seconds
      excludeExchanges: [],
      ...config
    };
  }

  /**
   * Get trading fee for an exchange (Taker fee for Market orders)
   */
  private getFee(exchange: string): number {
    const fees = EXCHANGE_FEES[exchange];
    if (!fees) {
      logger.warn('Gap Detector', `Unknown exchange fee structure: ${exchange}, using default 0.1%`);
      return 0.1; // Default conservative fee
    }
    return fees.taker; // Use Taker fee for Market orders
  }

  /**
   * Check if price data is fresh enough
   */
  private isFresh(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= this.config.maxPriceStaleness;
  }

  /**
   * Calculate gap between two exchanges
   */
  private calculateGap(
    buyExchange: ExchangePrice,
    sellExchange: ExchangePrice
  ): GapOpportunity | null {
    // Buy at Ask, Sell at Bid
    const buyPrice = buyExchange.ask;
    const sellPrice = sellExchange.bid;

    // Check if this makes sense (sell price should be higher)
    if (sellPrice <= buyPrice) {
      return null; // No opportunity
    }

    // Calculate raw gap
    const rawGap = sellPrice - buyPrice;
    const rawGapPercent = (rawGap / buyPrice) * 100;

    // Get fees
    const buyFee = this.getFee(buyExchange.exchange);
    const sellFee = this.getFee(sellExchange.exchange);
    const totalFees = buyFee + sellFee;

    // Calculate net gap (after fees)
    const netGapPercent = rawGapPercent - totalFees;

    // Determine confidence based on data freshness
    const isBuyFresh = this.isFresh(buyExchange.timestamp);
    const isSellFresh = this.isFresh(sellExchange.timestamp);
    let confidence: 'high' | 'medium' | 'low' = 'high';

    if (!isBuyFresh || !isSellFresh) {
      confidence = 'low';
    } else {
      const avgAge = (Date.now() - buyExchange.timestamp + Date.now() - sellExchange.timestamp) / 2;
      if (avgAge > 2000) {
        confidence = 'medium';
      }
    }

    return {
      buyExchange: buyExchange.exchange,
      buyPrice,
      sellExchange: sellExchange.exchange,
      sellPrice,
      rawGap,
      rawGapPercent,
      buyFee,
      sellFee,
      totalFees,
      netGapPercent,
      estimatedProfit: 0, // Will be calculated with quantity
      timestamp: Date.now(),
      isProfitable: netGapPercent > 0,
      confidence
    };
  }

  /**
   * Find all gap opportunities from a list of exchange prices
   */
  detectGaps(prices: ExchangePrice[]): GapAnalysis {
    const opportunities: GapOpportunity[] = [];

    // Filter out excluded exchanges
    const validPrices = prices.filter(
      p => !this.config.excludeExchanges?.includes(p.exchange)
    );

    // Compare all pairs
    for (let i = 0; i < validPrices.length; i++) {
      for (let j = 0; j < validPrices.length; j++) {
        if (i === j) continue;

        const gap = this.calculateGap(validPrices[i], validPrices[j]);

        if (gap && gap.netGapPercent >= this.config.minGapPercent) {
          opportunities.push(gap);
        }
      }
    }

    // Sort by net gap percent (descending)
    opportunities.sort((a, b) => b.netGapPercent - a.netGapPercent);

    // Find best opportunity
    const bestOpportunity = opportunities.length > 0 ? opportunities[0] : null;

    // Calculate average gap
    const averageGap = opportunities.length > 0
      ? opportunities.reduce((sum, opp) => sum + opp.netGapPercent, 0) / opportunities.length
      : 0;

    // Find highest and lowest prices
    const sortedByPrice = [...validPrices].sort((a, b) => b.price - a.price);
    const highest = sortedByPrice[0];
    const lowest = sortedByPrice[sortedByPrice.length - 1];

    const analysis: GapAnalysis = {
      opportunities,
      bestOpportunity,
      averageGap,
      priceSpread: {
        highest,
        lowest
      },
      lastUpdate: Date.now()
    };

    if (bestOpportunity) {
      logger.info('Gap Detector', 'Best gap opportunity found', {
        buy: bestOpportunity.buyExchange,
        sell: bestOpportunity.sellExchange,
        netGap: bestOpportunity.netGapPercent.toFixed(2) + '%',
        confidence: bestOpportunity.confidence
      });
    }

    return analysis;
  }

  /**
   * Calculate estimated profit for a given quantity
   */
  estimateProfit(gap: GapOpportunity, quantity: number): number {
    const buyCost = gap.buyPrice * quantity;
    const buyFeeAmount = buyCost * (gap.buyFee / 100);
    const totalBuyCost = buyCost + buyFeeAmount;

    const sellProceeds = gap.sellPrice * quantity;
    const sellFeeAmount = sellProceeds * (gap.sellFee / 100);
    const totalSellProceeds = sellProceeds - sellFeeAmount;

    return totalSellProceeds - totalBuyCost;
  }

  /**
   * Update gap opportunity with estimated profit for quantity
   */
  withEstimatedProfit(gap: GapOpportunity, quantity: number): GapOpportunity {
    return {
      ...gap,
      estimatedProfit: this.estimateProfit(gap, quantity)
    };
  }
}

export default GapDetector;
