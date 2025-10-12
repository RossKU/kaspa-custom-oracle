// BingX Perpetual Futures WebSocket with GZIP decompression
import pako from 'pako';

const BINGX_WS_URL = 'wss://open-api-swap.bingx.com/swap-market';

interface BingXTickerData {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  c: string; // Close price (last price)
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Volume
  A?: string; // Ask price
  B?: string; // Bid price
  a?: string; // Best ask price
  b?: string; // Best bid price
}

export interface BingXPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
}

export class BingXPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: BingXPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPriceData: BingXPriceData | null = null;

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
      console.log('[BingX] ✅ Connected!');

      // Subscribe to KAS-USDT ticker
      this.subscribeTicker();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);
    };

    this.ws.onmessage = async (event) => {
      try {
        // Decompress GZIP data
        const compressed = new Uint8Array(event.data);
        const decompressed = pako.inflate(compressed, { to: 'string' });
        const message = JSON.parse(decompressed);

        console.log('[BingX] Received:', message);

        // Handle Pong
        if (message.pong) {
          console.log('[BingX] Pong received:', message.pong);
          return;
        }

        // Handle ticker data
        if (message.e === '24hrTicker' || message.dataType === 'KAS-USDT@ticker') {
          this.handleTickerData(message);
        }
      } catch (error) {
        console.error('[BingX] Decompress/Parse error:', error);
        this.onErrorCallback?.('Failed to parse ticker data');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[BingX] WebSocket error:', error);
      this.onErrorCallback?.('WebSocket connection error');
    };

    this.ws.onclose = () => {
      console.log('[BingX] WebSocket closed');
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

    console.log('[BingX] Subscribing to ticker:', subscribeMessage);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      ping: Date.now()
    };

    console.log('[BingX] Sending ping');
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: BingXTickerData) {
    // BingX ticker may not always include bid/ask in every update
    // Use last known values if not present
    const price = data.c ? parseFloat(data.c) : (this.lastPriceData?.price ?? 0);
    const bid = data.b || data.B ? parseFloat(data.b || data.B || '0') : (this.lastPriceData?.bid ?? price);
    const ask = data.a || data.A ? parseFloat(data.a || data.A || '0') : (this.lastPriceData?.ask ?? price);

    const priceData: BingXPriceData = {
      exchange: 'BingX',
      type: 'F', // Futures
      price,
      bid,
      ask
    };

    // Store for next update
    this.lastPriceData = priceData;

    console.log('[BingX] Parsed price data:', priceData);
    this.onDataCallback?.(priceData);
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.ws?.close();
  }
}
