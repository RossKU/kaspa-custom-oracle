// BingX Perpetual Futures WebSocket with GZIP decompression
import pako from 'pako';
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';
import {
  createPriceHistory,
  addSnapshot,
  calculateVolumeStatsFromTrades,
  type PriceHistory,
  type VolumeStats,
} from '../types/lending-oracle';

const BINGX_WS_URL = 'wss://open-api-swap.bingx.com/swap-market';
const TRADE_WINDOW_MS = 60000;
const SNAPSHOT_INTERVAL_MS = 100;

interface BingXTickerData {
  dataType?: string;
  data?: {
    s?: string;        // symbol
    c?: string;        // lastPrice (close)
    o?: string;        // openPrice
    h?: string;        // highPrice
    l?: string;        // lowPrice
    v?: string;        // volume
    A?: string;        // askPrice
    B?: string;        // bidPrice
    a?: string;        // askQty
    b?: string;        // bidQty
  };
  // Direct fields (24hrTicker event)
  e?: string;          // event type
  E?: number;          // event time
  s?: string;          // symbol
  c?: string;          // lastPrice
  o?: string;          // openPrice
  h?: string;          // highPrice
  l?: string;          // lowPrice
  v?: string;          // volume
  A?: string;          // askPrice
  B?: string;          // bidPrice
  a?: string;          // askQty
  b?: string;          // bidQty
}

interface BingXTradeDetail {
  time?: string;
  makerSide?: string;
  price?: number;
  volume?: number;
}

export interface BingXPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
  lastUpdate: number;
  trades: MarketTrade[];
  priceHistory?: PriceHistory;
  volumeStats?: VolumeStats;
}

export class BingXPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: BingXPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPriceData: BingXPriceData | null = null;
  private trades: MarketTrade[] = [];

  // Phase 1: Lending Oracle data collection
  private priceHistory: PriceHistory = createPriceHistory();
  private snapshotTimer: number | null = null;
  private currentPrice: number = 0;
  private lastUpdate: number = 0;

  connect(
    onData: (data: BingXPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    this.ws = new WebSocket(BINGX_WS_URL);

    // Important: Set binary type to handle GZIP compressed data
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // Subscribe to KAS-USDT ticker and trades
      this.subscribeTicker();
      this.subscribeTrades();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);

      // Phase 1: Start snapshot timer
      this.startSnapshotTimer();
    };

    this.ws.onmessage = async (event) => {
      try {
        // Decompress GZIP data
        const compressed = new Uint8Array(event.data);
        const decompressed = pako.inflate(compressed, { to: 'string' });
        const message = JSON.parse(decompressed);

        // Handle Pong
        if (message.pong) {
          return;
        }

        // Handle ticker data - be flexible with message format
        if (message.e === '24hrTicker' || message.dataType === 'KAS-USDT@ticker' || message.data) {
          this.handleTickerData(message);
        }

        // Handle trade detail data
        if (message.dataType === 'market.tradeDetail.KAS-USDT' && message.data?.trades) {
          this.handleTradeData(message.data.trades);
        }
      } catch (error) {
        this.onErrorCallback?.('Failed to parse ticker data');
      }
    };

    this.ws.onerror = () => {
      this.onErrorCallback?.('WebSocket connection error');
    };

    this.ws.onclose = () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
      }

      // Auto reconnect after 5 seconds
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };
  }

  private subscribeTicker() {
    const subscribeMessage = {
      id: `ticker_${Date.now()}`,
      reqType: 'sub',
      dataType: 'KAS-USDT@ticker'
    };
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private subscribeTrades() {
    const subscribeMessage = {
      id: `trade_${Date.now()}`,
      reqType: 'sub',
      dataType: 'market.trade.detail.KAS-USDT'
    };
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      ping: Date.now()
    };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private startSnapshotTimer() {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
    }
    this.snapshotTimer = window.setInterval(() => {
      if (this.currentPrice > 0) {
        addSnapshot(this.priceHistory, {
          price: this.currentPrice,
          clientTimestamp: Date.now(),
          serverTimestamp: this.lastUpdate,
        });
      }
    }, SNAPSHOT_INTERVAL_MS);
  }

  private handleTickerData(msg: BingXTickerData) {
    // BingX can send data in two formats:
    // 1. Nested: { dataType: "...", data: { c: "...", B: "...", A: "..." } }
    // 2. Flat: { e: "24hrTicker", c: "...", B: "...", A: "..." }
    const data = msg.data || msg;

    // Extract price fields (c = close/last, B = bidPrice, A = askPrice)
    const price = data.c ? parseFloat(data.c) : (this.lastPriceData?.price ?? 0);
    const bid = data.B ? parseFloat(data.B) : (this.lastPriceData?.bid ?? price);
    const ask = data.A ? parseFloat(data.A) : (this.lastPriceData?.ask ?? price);

    // Only update if we have valid data
    if (price === 0 && bid === 0 && ask === 0) {
      return;
    }

    // Phase 1: Update price for snapshots
    this.currentPrice = price;
    this.lastUpdate = Date.now();

    // Phase 1: Calculate volume stats from 60-second window trades
    const volumeStats = calculateVolumeStatsFromTrades(this.trades);

    const priceData: BingXPriceData = {
      exchange: 'BingX',
      type: 'F', // Futures
      price,
      bid,
      ask,
      lastUpdate: this.lastUpdate,
      trades: [...this.trades],
      priceHistory: this.priceHistory,
      volumeStats,
    };

    // Store for next update
    this.lastPriceData = priceData;
    this.onDataCallback?.(priceData);
  }

  private handleTradeData(trades: BingXTradeDetail[]) {
    trades.forEach(trade => {
      if (trade.price && trade.volume && trade.time) {
        const marketTrade: MarketTrade = {
          price: trade.price,
          volume: trade.volume,
          timestamp: new Date(trade.time).getTime(),
          isBuyerMaker: trade.makerSide === 'Bid'
        };

        this.trades.push(marketTrade);
      }
    });

    // 古いデータをクリーンアップ
    cleanupOldTrades(this.trades, TRADE_WINDOW_MS);

  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.ws?.close();
    this.trades = [];
    this.priceHistory = createPriceHistory();
  }
}
