/**
 * Order Book Utilities
 * Calculate effective prices based on order quantity and market depth
 */

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

/**
 * Calculate effective ask price (buying price) for a given quantity
 * This simulates executing a market buy order and returns the effective price
 *
 * @param asks Sell orders (asks), sorted ascending by price
 * @param quantity Amount to buy (in base currency, e.g., KAS)
 * @param useWorstCase If true, returns worst-case price; if false, returns weighted average
 * @returns Effective price, or null if insufficient liquidity
 */
export function calculateEffectiveAsk(
  asks: OrderBookEntry[],
  quantity: number,
  useWorstCase: boolean = true
): number | null {
  if (!asks || asks.length === 0 || quantity <= 0) {
    return null;
  }

  let remainingQty = quantity;
  let totalCost = 0;
  let worstPrice = 0;
  let levelsConsumed = 0;

  for (const ask of asks) {
    if (remainingQty <= 0) break;

    const qtyAtThisLevel = Math.min(remainingQty, ask.quantity);
    totalCost += qtyAtThisLevel * ask.price;
    worstPrice = ask.price; // Track the worst (highest) price
    remainingQty -= qtyAtThisLevel;
    levelsConsumed++;
  }

  // If we couldn't fill the entire order, return null (insufficient liquidity)
  if (remainingQty > 0) {
    if (quantity >= 10000) {
      console.log('[calculateEffectiveAsk] Insufficient liquidity', {
        quantity,
        remainingQty,
        levelsConsumed,
        asksCount: asks.length
      });
    }
    return null;
  }

  const result = useWorstCase ? worstPrice : totalCost / quantity;

  // Debug log for large quantities
  if (quantity >= 10000) {
    console.log('[calculateEffectiveAsk] Calculation complete', {
      quantity,
      levelsConsumed,
      firstAsk: asks[0],
      lastConsumed: asks[levelsConsumed - 1],
      worstPrice,
      weightedAvg: totalCost / quantity,
      useWorstCase,
      result
    });
  }

  return result;
}

/**
 * Calculate effective bid price (selling price) for a given quantity
 * This simulates executing a market sell order and returns the effective price
 *
 * @param bids Buy orders (bids), sorted descending by price
 * @param quantity Amount to sell (in base currency, e.g., KAS)
 * @param useWorstCase If true, returns worst-case price; if false, returns weighted average
 * @returns Effective price, or null if insufficient liquidity
 */
export function calculateEffectiveBid(
  bids: OrderBookEntry[],
  quantity: number,
  useWorstCase: boolean = true
): number | null {
  if (!bids || bids.length === 0 || quantity <= 0) {
    return null;
  }

  let remainingQty = quantity;
  let totalRevenue = 0;
  let worstPrice = 0;

  for (const bid of bids) {
    if (remainingQty <= 0) break;

    const qtyAtThisLevel = Math.min(remainingQty, bid.quantity);
    totalRevenue += qtyAtThisLevel * bid.price;
    worstPrice = bid.price; // Track the worst (lowest) price
    remainingQty -= qtyAtThisLevel;
  }

  // If we couldn't fill the entire order, return null (insufficient liquidity)
  if (remainingQty > 0) {
    return null;
  }

  // Return worst-case price (most conservative) or weighted average
  return useWorstCase ? worstPrice : totalRevenue / quantity;
}

/**
 * Calculate effective bid and ask prices for a given quantity
 *
 * @param orderBook Order book with bids and asks
 * @param quantity Amount to trade (in base currency)
 * @param useWorstCase Use worst-case pricing (more conservative for arbitrage)
 * @returns Effective bid and ask prices, or nulls if insufficient liquidity
 */
export function calculateEffectivePrices(
  orderBook: { bids: OrderBookEntry[]; asks: OrderBookEntry[] },
  quantity: number,
  useWorstCase: boolean = true
): {
  bestBid: number | null;
  effectiveBid: number | null;
  bestAsk: number | null;
  effectiveAsk: number | null;
} {
  const bestBid = orderBook.bids[0]?.price || null;
  const effectiveBid = calculateEffectiveBid(orderBook.bids, quantity, useWorstCase);
  const bestAsk = orderBook.asks[0]?.price || null;
  const effectiveAsk = calculateEffectiveAsk(orderBook.asks, quantity, useWorstCase);

  // Debug log for large quantities to trace calculation
  if (quantity >= 10000) {
    console.log('[Order Book Calculation]', {
      quantity,
      asks: {
        count: orderBook.asks.length,
        first3: orderBook.asks.slice(0, 3),
        last3: orderBook.asks.slice(-3),
        bestAsk,
        effectiveAsk,
        offset: effectiveAsk && bestAsk ? effectiveAsk - bestAsk : null
      }
    });
  }

  return {
    bestBid,
    effectiveBid,
    bestAsk,
    effectiveAsk
  };
}
