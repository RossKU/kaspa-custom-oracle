export interface BinanceTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface BinanceOrderBook {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: [string, string][];
  asks: [string, string][];
}

import type { MarketTrade } from './oracle';
import type { PriceHistory, VolumeStats } from './lending-oracle';

export interface PriceData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: string;
  lastUpdate: number;
  bestBid: number;
  bestAsk: number;
  trades: MarketTrade[]; // VWAP計算用の取引履歴

  // Phase 1: Lending Oracle data collection
  priceHistory?: PriceHistory; // 価格履歴（100ms間隔）
  volumeStats?: VolumeStats; // 出来高統計
}
