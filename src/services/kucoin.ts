// Kucoin Futures WebSocket with Token Authentication
import { logger } from '../utils/logger';

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
        logger.info('Kucoin', '✅ Connected to WebSocket');

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
          logger.debug('Kucoin', 'Received message', message);

          // Handle welcome message
          if (message.type === 'welcome') {
            logger.info('Kucoin', '✅ Welcome message received');
          }

          // Handle pong
          if (message.type === 'pong') {
            logger.debug('Kucoin', 'Pong received');
          }

          // Handle ack message (subscription confirmation)
          if (message.type === 'ack') {
            logger.info('Kucoin', '✅ Subscription acknowledged', message);
          }

          // Handle ticker data
          if (message.type === 'message' && message.topic === '/market/ticker:KASUSDTM') {
            logger.debug('Kucoin', '📊 Ticker data received', message.data);
            this.handleTickerData(message.data);
          }
        } catch (error) {
          logger.error('Kucoin', '❌ Parse error', { error, rawData: event.data });
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
      logger.info('Kucoin', 'Fetching token from API...', { url: TOKEN_API });

      const response = await fetch(TOKEN_API, {
        method: 'POST'
        // Remove Content-Type header to avoid CORS preflight
      });

      logger.debug('Kucoin', `Token response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Kucoin', 'HTTP error response', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const data: KucoinTokenResponse = await response.json();
      logger.debug('Kucoin', 'Token response received', { code: data.code });

      if (data.code === '200000' && data.data) {
        this.token = data.data.token;
        // Use first available server
        this.endpoint = data.data.instanceServers[0].endpoint;
        logger.info('Kucoin', '✅ Token obtained successfully', {
          tokenPreview: this.token.substring(0, 20) + '...',
          endpoint: this.endpoint
        });
      } else {
        throw new Error(`Invalid token response: ${data.code}`);
      }
    } catch (error) {
      // Detailed error logging
      const errorDetails: Record<string, any> = {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        type: typeof error
      };

      if (error instanceof TypeError) {
        errorDetails.isCORS = true;
        errorDetails.hint = 'CORS policy blocking request - browser cannot access Kucoin API directly';
      }

      logger.error('Kucoin', '❌ Token fetch failed', errorDetails);
      this.onErrorCallback?.(`Token fetch failed: ${errorDetails.message}`);
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

    logger.info('Kucoin', 'Subscribing to ticker', subscribeMessage);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      id: Date.now(),
      type: 'ping'
    };

    logger.debug('Kucoin', 'Sending ping');
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

    logger.info('Kucoin', '📊 Price data updated', priceData);
    this.onDataCallback?.(priceData);
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.ws?.close();
  }
}
