// Bybit Futures WebSocket V5
const BYBIT_WS_URL = 'wss://stream.bybit.com/v5/public/linear';

interface BybitTickerData {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
}

export interface BybitPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
}

export class BybitPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: BybitPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private lastPriceData: BybitPriceData | null = null;

  connect(
    onData: (data: BybitPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    console.log('[Bybit] Connecting to', BYBIT_WS_URL);

    this.ws = new WebSocket(BYBIT_WS_URL);

    this.ws.onopen = () => {
      console.log('[Bybit] ✅ Connected!');

      // Subscribe to KASUSDT ticker
      this.subscribeTicker();

      // Start ping interval (every 20 seconds as recommended)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 20000);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Bybit] Received:', message);

        // Handle pong response
        if (message.op === 'pong') {
          return;
        }

        // Handle ticker data
        if (message.topic && message.topic.startsWith('tickers.') && message.data) {
          this.handleTickerData(message.data);
        }
      } catch (error) {
        console.error('[Bybit] Parse error:', error);
        this.onErrorCallback?.('Failed to parse Bybit data');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[Bybit] ❌ Error:', error);
      this.onErrorCallback?.('Bybit WebSocket error');
    };

    this.ws.onclose = () => {
      console.log('[Bybit] Connection closed');
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          console.log('[Bybit] Reconnecting...');
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

    console.log('[Bybit] Subscribing to ticker:', subscribeMessage);
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
      ask
    };

    // Store for next delta update
    this.lastPriceData = priceData;

    console.log('[Bybit] Parsed price data:', priceData);
    this.onDataCallback?.(priceData);
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws?.close();
    this.ws = null;
    this.onDataCallback = null;
    this.onErrorCallback = null;
  }
}
