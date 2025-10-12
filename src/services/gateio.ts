// Gate.io Futures WebSocket V4
const GATEIO_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';

interface GateioBookTickerData {
  t: number;
  u: number;
  s: string;
  b: string;  // best bid price
  B: number;  // best bid size
  a: string;  // best ask price
  A: number;  // best ask size
}

export interface GateioPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
}

export class GateioPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: GateioPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;

  connect(
    onData: (data: GateioPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    console.log('[Gate.io] Connecting to', GATEIO_WS_URL);

    this.ws = new WebSocket(GATEIO_WS_URL);

    this.ws.onopen = () => {
      console.log('[Gate.io] ✅ Connected!');

      // Subscribe to KAS_USDT book_ticker (bid/ask)
      this.subscribeBookTicker();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[Gate.io] Received:', message);

        // Handle book_ticker data
        if (message.channel === 'futures.book_ticker' && message.event === 'update' && message.result) {
          this.handleBookTickerData(message.result);
        }
      } catch (error) {
        console.error('[Gate.io] Parse error:', error);
        this.onErrorCallback?.('Failed to parse Gate.io data');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[Gate.io] ❌ Error:', error);
      this.onErrorCallback?.('Gate.io WebSocket error');
    };

    this.ws.onclose = () => {
      console.log('[Gate.io] Connection closed');
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          console.log('[Gate.io] Reconnecting...');
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };
  }

  private subscribeBookTicker() {
    const subscribeMessage = {
      time: Math.floor(Date.now() / 1000),
      channel: 'futures.book_ticker',
      event: 'subscribe',
      payload: ['KAS_USDT']
    };

    console.log('[Gate.io] Subscribing to book_ticker:', subscribeMessage);
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

    const priceData: GateioPriceData = {
      exchange: 'Gate.io',
      type: 'F', // Futures
      price,
      bid,
      ask
    };

    console.log('[Gate.io] Parsed price data:', priceData);
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
