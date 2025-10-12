// Kucoin Futures WebSocket with Token Authentication
const TOKEN_API = 'https://api-futures.kucoin.com/api/v1/bullet-public';

interface KucoinTokenResponse {
  code: string;
  data: {
    token: string;
    instanceServers: Array<{
      endpoint: string;
      encrypt: boolean;
      protocol: string;
      pingInterval: number;
      pingTimeout: number;
    }>;
  };
}

interface KucoinTickerData {
  symbol: string;
  bestBidPrice: string;
  bestAskPrice: string;
  price: string;
  bestBidSize: number;
  bestAskSize: number;
  ts: number;
}

export interface KucoinPriceData {
  exchange: string;
  type: string;
  price: number;
  bid: number;
  ask: number;
}

export class KucoinPriceMonitor {
  private ws: WebSocket | null = null;
  private onDataCallback: ((data: KucoinPriceData) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private pingInterval: number | null = null;
  private token: string | null = null;
  private endpoint: string | null = null;

  async connect(
    onData: (data: KucoinPriceData) => void,
    onError: (error: string) => void
  ) {
    this.onDataCallback = onData;
    this.onErrorCallback = onError;

    try {
      // Step 1: Get WebSocket token
      await this.fetchToken();

      if (!this.token || !this.endpoint) {
        throw new Error('Failed to get token or endpoint');
      }

      // Step 2: Connect WebSocket with token
      const connectId = Date.now();
      this.ws = new WebSocket(`${this.endpoint}?token=${this.token}&connectId=${connectId}`);

      this.ws.onopen = () => {
        console.log('[Kucoin] ✅ Connected!');

        // Subscribe to KASUSDTM ticker
        this.subscribeTicker();

        // Start ping interval (server specifies interval, default 30s)
        this.pingInterval = window.setInterval(() => {
          this.sendPing();
        }, 30000);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[Kucoin] Received:', message);

          // Handle welcome message
          if (message.type === 'welcome') {
            console.log('[Kucoin] Welcome message received');
          }

          // Handle pong
          if (message.type === 'pong') {
            console.log('[Kucoin] Pong received');
          }

          // Handle ticker data
          if (message.type === 'message' && message.topic === '/market/ticker:KASUSDTM') {
            this.handleTickerData(message.data);
          }
        } catch (error) {
          console.error('[Kucoin] Parse error:', error);
          this.onErrorCallback?.('Failed to parse ticker data');
        }
      };

      this.ws.onerror = (error) => {
        console.error('[Kucoin] WebSocket error:', error);
        this.onErrorCallback?.('WebSocket connection error');
      };

      this.ws.onclose = () => {
        console.log('[Kucoin] WebSocket closed');
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
    } catch (error) {
      console.error('[Kucoin] Connection error:', error);
      this.onErrorCallback?.(`Failed to connect: ${error}`);
    }
  }

  private async fetchToken() {
    try {
      const response = await fetch(TOKEN_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data: KucoinTokenResponse = await response.json();

      if (data.code === '200000' && data.data) {
        this.token = data.data.token;
        // Use first available server
        this.endpoint = data.data.instanceServers[0].endpoint;
        console.log('[Kucoin] Token obtained:', this.token.substring(0, 20) + '...');
        console.log('[Kucoin] Endpoint:', this.endpoint);
      } else {
        throw new Error('Invalid token response');
      }
    } catch (error) {
      console.error('[Kucoin] Token fetch error:', error);
      throw error;
    }
  }

  private subscribeTicker() {
    const subscribeMessage = {
      id: Date.now(),
      type: 'subscribe',
      topic: '/market/ticker:KASUSDTM',
      privateChannel: false,
      response: true
    };

    console.log('[Kucoin] Subscribing to ticker:', subscribeMessage);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      id: Date.now(),
      type: 'ping'
    };

    console.log('[Kucoin] Sending ping');
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: KucoinTickerData) {
    const price = parseFloat(data.price);
    const bid = parseFloat(data.bestBidPrice);
    const ask = parseFloat(data.bestAskPrice);

    const priceData: KucoinPriceData = {
      exchange: 'Kucoin',
      type: 'F', // Futures
      price,
      bid,
      ask
    };

    console.log('[Kucoin] Parsed price data:', priceData);
    this.onDataCallback?.(priceData);
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.ws?.close();
  }
}
