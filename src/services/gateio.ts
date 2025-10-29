// Gate.io Futures WebSocket V4
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';
import {
  createPriceHistory,
  addSnapshot,
  calculateVolumeStatsFromTrades,
  type PriceHistory,
  type VolumeStats,
} from '../types/lending-oracle';

const GATEIO_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const TRADE_WINDOW_MS = 60000;
const SNAPSHOT_INTERVAL_MS = 100;

interface GateioBookTickerData {
  t: number;
  u: number;
  s: string;
  b: string;  // best bid price
  B: number;  // best bid size
  a: string;  // best ask price
  A: number;  // best ask size
}

interface GateioTradeData {
  size: number;
  id: number;
  create_time: number;
  create_time_ms: number;
  price: string;
  contract: string;
}

export interface GateioPriceData {
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

export class GateioPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: GateioPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private trades: MarketTrade[] = [];

  // Phase 1: Lending Oracle data collection
  private priceHistory: PriceHistory = createPriceHistory();
  private snapshotTimer: number | null = null;
  private currentPrice: number = 0;
  private lastUpdate: number = 0;

  connect(
    onData: (data: GateioPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;


    this.ws = new WebSocket(GATEIO_WS_URL);

    this.ws.onopen = () => {

      // Subscribe to KAS_USDT book_ticker and trades
      this.subscribeBookTicker();
      this.subscribeTrades();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle book_ticker data
        if (message.channel === 'futures.book_ticker' && message.event === 'update' && message.result) {
          this.handleBookTickerData(message.result);
        }

        // Handle trades data
        if (message.channel === 'futures.trades' && message.event === 'update' && message.result) {
          this.handleTradeData(message.result);
        }
      } catch {
        this.onErrorCallback?.('Failed to parse Gate.io data');
      }
    };

    this.ws.onerror = () => {
      this.onErrorCallback?.('Gate.io WebSocket error');
    };

    this.ws.onclose = () => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };

    // Phase 1: Start snapshot timer
    this.startSnapshotTimer();
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

  private subscribeBookTicker() {
    const subscribeMessage = {
      time: Math.floor(Date.now() / 1000),
      channel: 'futures.book_ticker',
      event: 'subscribe',
      payload: ['KAS_USDT']
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private subscribeTrades() {
    const subscribeMessage = {
      time: Math.floor(Date.now() / 1000),
      channel: 'futures.trades',
      event: 'subscribe',
      payload: ['KAS_USDT']
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      time: Math.floor(Date.now() / 1000),
      channel: 'futures.ping'
    };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleBookTickerData(data: GateioBookTickerData) {
    const bid = parseFloat(data.b);
    const ask = parseFloat(data.a);

    // Calculate mid price from bid and ask
    const price = (bid + ask) / 2;

    // Phase 1: Update price for snapshots
    this.currentPrice = price;
    this.lastUpdate = Date.now();

    // Phase 1: Calculate volume stats from 60-second window trades
    const volumeStats = calculateVolumeStatsFromTrades(this.trades);

    const priceData: GateioPriceData = {
      exchange: 'Gate.io',
      type: 'F', // Futures
      price,
      bid,
      ask,
      lastUpdate: this.lastUpdate,
      trades: [...this.trades],
      priceHistory: this.priceHistory,
      volumeStats,
    };

    this.onDataCallback?.(priceData);
  }

  private handleTradeData(trades: GateioTradeData[]) {
    trades.forEach(trade => {
      const marketTrade: MarketTrade = {
        price: parseFloat(trade.price),
        volume: Math.abs(trade.size),
        timestamp: trade.create_time_ms,
        tradeId: trade.id
      };

      this.trades.push(marketTrade);
    });

    // 古いデータをクリーンアップ
    cleanupOldTrades(this.trades, TRADE_WINDOW_MS);

  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.trades = [];
    this.priceHistory = createPriceHistory();
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
