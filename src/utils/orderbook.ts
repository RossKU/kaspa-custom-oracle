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

  for (const ask of asks) {
    if (remainingQty <= 0) break;

    const qtyAtThisLevel = Math.min(remainingQty, ask.quantity);
    totalCost += qtyAtThisLevel * ask.price;
    worstPrice = ask.price; // Track the worst (highest) price
    remainingQty -= qtyAtThisLevel;
  }

  // If we couldn't fill the entire order, return null (insufficient liquidity)
  if (remainingQty > 0) {
    return null;
  }

  // Return worst-case price (most conservative) or weighted average
  return useWorstCase ? worstPrice : totalCost / quantity;
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
  return {
    bestBid: orderBook.bids[0]?.price || null,
    effectiveBid: calculateEffectiveBid(orderBook.bids, quantity, useWorstCase),
    bestAsk: orderBook.asks[0]?.price || null,
    effectiveAsk: calculateEffectiveAsk(orderBook.asks, quantity, useWorstCase)
  };
}
