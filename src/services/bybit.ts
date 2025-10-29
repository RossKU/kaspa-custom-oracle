// Bybit Futures WebSocket V5
import type { MarketTrade } from '../types/oracle';
import { cleanupOldTrades } from '../types/oracle';

const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/linear';
const TRADE_WINDOW_MS = 60000; // 60秒の取引履歴を保持

interface BybitTickerData {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
}

interface BybitTradeData {
  T: number;     // Timestamp
  s: string;     // Symbol
  S: string;     // Side
  v: string;     // Volume
  p: string;     // Price
  i: string;     // Trade ID
}

export interface BybitPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
  lastUpdate: number;
  trades: MarketTrade[];
  priceHistory?: any; // Phase 1: Will be implemented
  volumeStats?: any; // Phase 1: Will be implemented
}

export class BybitPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: BybitPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPriceData: BybitPriceData | null = null;
  private trades: MarketTrade[] = [];

  connect(
    onData: (data: BybitPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;


    this.ws = new WebSocket(BYBIT_WS_URL);

    this.ws.onopen = () => {

      // Subscribe to KASUSDT ticker and trades
      this.subscribeTicker();
      this.subscribeTrades();

      // Start ping interval (every 20 seconds as recommended)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 20000);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle pong response
        if (message.op === 'pong') {
          return;
        }

        // Handle ticker data
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
          this.handleTickerData(message.data);
        }

        // Handle trade data
        if (message.topic && message.topic.startsWith('publicTrade.') && message.data) {
          this.handleTradeData(message.data);
        }
      } catch {
        this.onErrorCallback?.('Failed to parse Bybit data');
      }
    };

    this.ws.onerror = () => {
      this.onErrorCallback?.('Bybit WebSocket error');
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
  }

  private subscribeTicker() {
    const subscribeMessage = {
      op: 'subscribe',
      args: ['tickers.KASUSDT']
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private subscribeTrades() {
    const subscribeMessage = {
      op: 'subscribe',
      args: ['publicTrade.KASUSDT']
    };

    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = { op: 'ping' };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: BybitTickerData) {
    // Use previous values if current data is undefined (delta updates)
    const price = data.lastPrice ? parseFloat(data.lastPrice) : (this.lastPriceData?.price ?? 0);
    const bid = data.bid1Price ? parseFloat(data.bid1Price) : (this.lastPriceData?.bid ?? 0);
    const ask = data.ask1Price ? parseFloat(data.ask1Price) : (this.lastPriceData?.ask ?? 0);

    const priceData: BybitPriceData = {
      exchange: 'Bybit',
      type: 'F', // Futures
      price,
      bid,
      ask,
      lastUpdate: Date.now(),
      trades: [...this.trades]
    };

    // Store for next delta update
    this.lastPriceData = priceData;

    this.onDataCallback?.(priceData);
  }

  private handleTradeData(trades: BybitTradeData[]) {
    trades.forEach(trade => {
      const marketTrade: MarketTrade = {
        price: parseFloat(trade.p),
        volume: parseFloat(trade.v),
        timestamp: trade.T,
        isBuyerMaker: trade.S === 'Sell',
        tradeId: trade.i
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
    this.ws?.close();
    this.ws = null;
    this.lastPriceData = null;
    this.trades = [];
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
