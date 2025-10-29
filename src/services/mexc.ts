// MEXC Futures WebSocket
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';
import {
  createPriceHistory,
  createVolumeStats,
  addSnapshot,
  updateVolumeStats,
  type PriceHistory,
  type VolumeStats,
} from '../types/lending-oracle';

const MEXC_WS_URL = 'wss://contract.mexc.com/edge';
const TRADE_WINDOW_MS = 60000; // 60秒の取引履歴を保持
const SNAPSHOT_INTERVAL_MS = 100; // 100ms間隔でスナップショット

interface MexcTickerData {
  ask1: number;
  bid1: number;
  lastPrice: number;
  symbol: string;
}

interface MexcDealData {
  p: number;   // price
  v: number;   // volume
  T: number;   // trade type
  O: number;
  M: number;
  t: number;   // timestamp
}

export interface MexcPriceData {
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

export class MexcPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: MexcPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private trades: MarketTrade[] = [];
  private priceHistory: PriceHistory = createPriceHistory();
  private volumeStats: VolumeStats = createVolumeStats();
  private snapshotTimer: number | null = null;
  private lastSnapshotTime: number = 0;
  private currentPrice: number = 0;
  private lastUpdate: number = 0;

  connect(
    onData: (data: MexcPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;


    this.ws = new WebSocket(MEXC_WS_URL);

    this.ws.onopen = () => {

      // Subscribe to KAS_USDT ticker and deals
      this.subscribeTicker();
      this.subscribeDeal();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.channel === 'push.ticker' && data.data) {
          this.handleTickerData(data.data);
        } else if (data.channel === 'push.deal' && data.data) {
          this.handleDealData(data.data);
        }
      } catch {
        this.onErrorCallback?.('Failed to parse MEXC data');
      }
    };

    this.ws.onerror = () => {
      this.onErrorCallback?.('MEXC WebSocket error');
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
        this.lastSnapshotTime = Date.now();
      }
    }, SNAPSHOT_INTERVAL_MS);
  }

  private subscribeTicker() {
    const subscribeMessage = {
      method: 'sub.ticker',
      param: {
        symbol: 'KAS_USDT'
      }
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private subscribeDeal() {
    const subscribeMessage = {
      method: 'sub.deal',
      param: {
        symbol: 'KAS_USDT'
      }
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = { method: 'ping' };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: MexcTickerData) {
    this.currentPrice = data.lastPrice;
    this.lastUpdate = Date.now();

    const priceData: MexcPriceData = {
      exchange: 'MEXC',
      type: 'F', // Futures
      price: data.lastPrice,
      bid: data.bid1,
      ask: data.ask1,
      lastUpdate: this.lastUpdate,
      trades: [...this.trades],
      priceHistory: this.priceHistory,
      volumeStats: this.volumeStats,
    };

    this.onDataCallback?.(priceData);
  }

  private handleDealData(deals: MexcDealData[]) {
    deals.forEach(deal => {
      const trade: MarketTrade = {
        price: deal.p,
        volume: deal.v,
        timestamp: deal.t
      };

      this.trades.push(trade);

      // Phase 1: Update volume statistics
      updateVolumeStats(this.volumeStats, deal.v, Date.now());
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
    this.volumeStats = createVolumeStats();
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
