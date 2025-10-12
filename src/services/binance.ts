import type { PriceData } from '../types/binance';

const BINANCE_WS_BASE = 'wss://fstream.binance.com/ws';

export class BinancePriceMonitor {
  private ws: WebSocket | null = null;
  private bookTickerWs: WebSocket | null = null;
  private onDataCallback: ((data: PriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private currentData: Partial<PriceData> = {};

  connect(
    onData: (data: PriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    // 24時間統計データ（価格、変動率、高値、安値、出来高）
    this.ws = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@ticker`);

    this.ws.onopen = () => {
      console.log('Connected to Binance WebSocket (ticker)');
    };

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
        console.error('Error parsing ticker data:', error);
        this.onErrorCallback?.('Failed to parse price data');
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket ticker error:', error);
      this.onErrorCallback?.('WebSocket connection error');
    };

    this.ws.onclose = () => {
      console.log('WebSocket ticker closed');
      // 自動再接続
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };

    // Bid/Ask価格（板情報）
    this.bookTickerWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@bookTicker`);

    this.bookTickerWs.onopen = () => {
      console.log('Connected to Binance WebSocket (bookTicker)');
    };

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
        console.error('Error parsing book ticker data:', error);
      }
    };

    this.bookTickerWs.onerror = (error) => {
      console.error('WebSocket bookTicker error:', error);
    };

    this.bookTickerWs.onclose = () => {
      console.log('WebSocket bookTicker closed');
      // 自動再接続
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          this.bookTickerWs = new WebSocket(`${BINANCE_WS_BASE}/kasusdt@bookTicker`);
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
      this.onDataCallback?.(this.currentData as PriceData);
    }
  }

  disconnect() {
    this.ws?.close();
    this.bookTickerWs?.close();
    this.ws = null;
    this.bookTickerWs = null;
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
