// MEXC Futures WebSocket
const MEXC_WS_URL = 'wss://contract.mexc.com/edge';

interface MexcTickerData {
  ask1: number;
  bid1: number;
  lastPrice: number;
  symbol: string;
}

export interface MexcPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
}

export class MexcPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: MexcPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;

  connect(
    onData: (data: MexcPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    console.log('[MEXC] Connecting to', MEXC_WS_URL);

    this.ws = new WebSocket(MEXC_WS_URL);

    this.ws.onopen = () => {
      console.log('[MEXC] ✅ Connected!');

      // Subscribe to KAS_USDT ticker
      this.subscribeTicker();

      // Start ping interval (every 30 seconds)
      this.pingInterval = window.setInterval(() => {
        this.sendPing();
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[MEXC] Received:', data);

        if (data.channel === 'push.ticker' && data.data) {
          this.handleTickerData(data.data);
        }
      } catch (error) {
        console.error('[MEXC] Parse error:', error);
        this.onErrorCallback?.('Failed to parse MEXC data');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[MEXC] ❌ Error:', error);
      this.onErrorCallback?.('MEXC WebSocket error');
    };

    this.ws.onclose = () => {
      console.log('[MEXC] Connection closed');
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Auto-reconnect after 5 seconds
      setTimeout(() => {
        if (this.onDataCallback && this.onErrorCallback) {
          console.log('[MEXC] Reconnecting...');
          this.connect(this.onDataCallback, this.onErrorCallback);
        }
      }, 5000);
    };
  }

  private subscribeTicker() {
    const subscribeMessage = {
      method: 'sub.ticker',
      param: {
        symbol: 'KAS_USDT'
      }
    };

    console.log('[MEXC] Subscribing to ticker:', subscribeMessage);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = { method: 'ping' };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: MexcTickerData) {
    const priceData: MexcPriceData = {
      exchange: 'MEXC',
      type: 'F', // Futures
      price: data.lastPrice,
      bid: data.bid1,
      ask: data.ask1
    };

    console.log('[MEXC] Parsed price data:', priceData);
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
