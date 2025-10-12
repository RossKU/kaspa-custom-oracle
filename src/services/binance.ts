import axios from 'axios';
import type { BinanceTicker24hr, BinanceOrderBook, PriceData } from '../types/binance';

const BINANCE_FUTURES_API = 'https://fapi.binance.com/fapi/v1';

export const fetchKasPrice = async (): Promise<PriceData> => {
  try {
    // 24時間統計データ取得
    const tickerResponse = await axios.get<BinanceTicker24hr>(
      `${BINANCE_FUTURES_API}/ticker/24hr?symbol=KASUSDT`
    );
    const ticker = tickerResponse.data;

    // 板情報取得（Bid/Ask）
    const depthResponse = await axios.get<BinanceOrderBook>(
      `${BINANCE_FUTURES_API}/depth?symbol=KASUSDT&limit=1`
    );
    const depth = depthResponse.data;

    const priceData: PriceData = {
      symbol: ticker.symbol,
      price: parseFloat(ticker.lastPrice),
      priceChange: parseFloat(ticker.priceChange),
      priceChangePercent: parseFloat(ticker.priceChangePercent),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume24h: ticker.volume,
      lastUpdate: Date.now(),
      bestBid: depth.bids.length > 0 ? parseFloat(depth.bids[0][0]) : 0,
      bestAsk: depth.asks.length > 0 ? parseFloat(depth.asks[0][0]) : 0,
    };

    return priceData;
  } catch (error) {
    console.error('Error fetching KAS price:', error);
    throw error;
  }
};
