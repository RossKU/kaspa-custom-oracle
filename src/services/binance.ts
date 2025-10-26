import type { PriceData } from '../types/binance';
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';

const BINANCE_WS_BASE = 'wss://fstream.binance.com/ws';
const TRADE_WINDOW_MS = 60000; // 60秒の取引履歴を保持

export class BinancePriceMonitor {
  private ws: WebSocket | null = null;
  private bookTickerWs: WebSocket | null = null;
  private aggTradeWs: WebSocket | null = null; // 取引ストリーム用
  private onDataCallback: ((data: PriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private currentData: Partial<PriceData> = {};
  private trades: MarketTrade[] = []; // 取引履歴

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
  }

  private emitData() {
    // 全てのデータが揃ったら送信
    if (
      this.currentData.symbol &&
      this.currentData.price !== undefined &&
      this.currentData.bestBid !== undefined &&
      this.currentData.bestAsk !== undefined
    ) {
      this.onDataCallback?.({
        ...this.currentData,
        trades: [...this.trades] // コピーを渡す
      } as PriceData);
    }
  }

  disconnect() {
    this.ws?.close();
    this.bookTickerWs?.close();
    this.aggTradeWs?.close();
    this.ws = null;
    this.bookTickerWs = null;
    this.aggTradeWs = null;
    this.trades = [];
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
