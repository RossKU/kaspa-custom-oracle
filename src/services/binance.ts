import type { PriceData } from '../types/binance';
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';
import {
  createPriceHistory,
  addSnapshot,
  calculateVolumeStatsFromTrades,
  type PriceHistory,
} from '../types/lending-oracle';

const BINANCE_WS_BASE = 'wss://fstream.binance.com/ws';
const TRADE_WINDOW_MS = 60000; // 60秒の取引履歴を保持
const SNAPSHOT_INTERVAL_MS = 100; // 100ms間隔でスナップショット

export class BinancePriceMonitor {
  private ws: WebSocket | null = null;
  private bookTickerWs: WebSocket | null = null;
  private aggTradeWs: WebSocket | null = null; // 取引ストリーム用
  private onDataCallback: ((data: PriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private currentData: Partial<PriceData> = {};
  private trades: MarketTrade[] = []; // 取引履歴

  // Phase 1: Lending Oracle data collection
  private priceHistory: PriceHistory = createPriceHistory();
  private snapshotTimer: number | null = null;
  private lastSnapshotTime: number = 0;

  connect(
    onData: (data: PriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    // 24時間統計データ（価格、変動率、高値、安値、出来高）
    this.ws = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@ticker`);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        this.currentData = {
          ...this.currentData,
          symbol: data.s,
          price: parseFloat(data.c),
          priceChange: parseFloat(data.p),
          priceChangePercent: parseFloat(data.P),
          high24h: parseFloat(data.h),
          low24h: parseFloat(data.l),
          volume24h: data.v,
          lastUpdate: Date.now(),
        };

        this.emitData();
      } catch (error) {
        this.onErrorCallback?.('Failed to parse price data');
      }
    };

    this.ws.onerror = () => {
      this.onErrorCallback?.('WebSocket connection error');
    };

    this.ws.onclose = () => {
      // 自動再接続
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };

    // Bid/Ask価格（板情報）
    this.bookTickerWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@bookTicker`);

    this.bookTickerWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        this.currentData = {
          ...this.currentData,
          bestBid: parseFloat(data.b),
          bestAsk: parseFloat(data.a),
        };

        this.emitData();
      } catch (error) {
        // Silent error
      }
    };

    this.bookTickerWs.onerror = () => {
      // Silent error
    };

    this.bookTickerWs.onclose = () => {
      // 自動再接続
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.bookTickerWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@bookTicker`);
        }
      }, 5000);
    };

    // Aggregate Trade Stream（取引データ）
    this.aggTradeWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@aggTrade`);

    this.aggTradeWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Aggregate trade data: { e, E, s, a, p, q, f, l, T, m }
        const trade: MarketTrade = {
          price: parseFloat(data.p),
          volume: parseFloat(data.q),
          timestamp: data.T, // Trade time
          isBuyerMaker: data.m,
          tradeId: data.a
        };

        this.trades.push(trade);

        // 古いデータをクリーンアップ
        cleanupOldTrades(this.trades, TRADE_WINDOW_MS);

        this.emitData();
      } catch (error) {
        // Silent error
      }
    };

    this.aggTradeWs.onerror = () => {
      // Silent error
    };

    this.aggTradeWs.onclose = () => {
      // 自動再接続
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.aggTradeWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@aggTrade`);
        }
      }, 5000);
    };

    // Phase 1: Start snapshot timer (100ms interval)
    this.startSnapshotTimer();
  }

  private startSnapshotTimer() {
    // Cancel existing timer
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
    }

    this.snapshotTimer = window.setInterval(() => {
      this.recordSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }

  private recordSnapshot() {
    const now = Date.now();

    // Skip if no price data yet or too soon since last snapshot
    if (!this.currentData.price || now - this.lastSnapshotTime < SNAPSHOT_INTERVAL_MS - 10) {
      return;
    }

    // Record snapshot with high-precision timestamps
    addSnapshot(this.priceHistory, {
      price: this.currentData.price,
      clientTimestamp: now,
      serverTimestamp: this.currentData.lastUpdate || now,
      volume: this.trades.length > 0 ? this.trades[this.trades.length - 1].volume : undefined,
    });

    this.lastSnapshotTime = now;
  }

  private emitData() {
    // 全てのデータが揃ったら送信
    if (
      this.currentData.symbol &&
      this.currentData.price !== undefined &&
      this.currentData.bestBid !== undefined &&
      this.currentData.bestAsk !== undefined
    ) {
      // Phase 1: Calculate volume stats from 60-second window trades
      const volumeStats = calculateVolumeStatsFromTrades(this.trades);

      this.onDataCallback?.({
        ...this.currentData,
        trades: [...this.trades], // コピーを渡す
        // Phase 1: Include lending oracle data
        priceHistory: this.priceHistory,
        volumeStats,
      } as PriceData);
    }
  }

  disconnect() {
    // Stop snapshot timer
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    this.ws?.close();
    this.bookTickerWs?.close();
    this.aggTradeWs?.close();
    this.ws = null;
    this.bookTickerWs = null;
    this.aggTradeWs = null;
    this.trades = [];

    // Phase 1: Reset lending oracle data
    this.priceHistory = createPriceHistory();
    this.lastSnapshotTime = 0;

    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
