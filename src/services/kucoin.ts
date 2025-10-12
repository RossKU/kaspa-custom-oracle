// Kucoin Futures WebSocket with Token Authentication
import { logger } from '../utils/logger';

const TOKEN_API = 'https://api-futures.kucoin.com/api/v1/bullet-public';
// CORS proxy (temporary solution for testing)
const CORS_PROXY = 'https://corsproxy.io/?';

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
  bestBidPrice: number;
  bestAskPrice: number;
  bestBidSize: number;
  bestAskSize: number;
  ts: number;
  // Note: tickerV2 does not include lastPrice, we calculate mid-price
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

          // Handle welcome message
          if (message.type === 'welcome') {
            logger.info('Kucoin', '✅ Welcome message received');
          }

          // Handle ack message (subscription confirmation)
          if (message.type === 'ack') {
            logger.info('Kucoin', '✅ Subscription acknowledged');
          }

          // Handle ticker data
          if (message.type === 'message' && message.topic === '/contractMarket/tickerV2:KASUSDTM') {
            this.handleTickerData(message.data);
          }
        } catch (error) {
          logger.error('Kucoin', '❌ Parse error', { error: error instanceof Error ? error.message : String(error) });
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
      const proxiedUrl = CORS_PROXY + encodeURIComponent(TOKEN_API);
      logger.info('Kucoin', 'Fetching token from API via CORS proxy...', {
        originalUrl: TOKEN_API,
        proxiedUrl
      });

      const response = await fetch(proxiedUrl, {
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
      topic: '/contractMarket/tickerV2:KASUSDTM',
      response: true
    };

    logger.info('Kucoin', 'Subscribing to futures ticker', subscribeMessage);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private sendPing() {
    const pingMessage = {
      id: Date.now(),
      type: 'ping'
    };
    this.ws?.send(JSON.stringify(pingMessage));
  }

  private handleTickerData(data: KucoinTickerData) {
    const bid = typeof data.bestBidPrice === 'number' ? data.bestBidPrice : parseFloat(String(data.bestBidPrice));
    const ask = typeof data.bestAskPrice === 'number' ? data.bestAskPrice : parseFloat(String(data.bestAskPrice));

    // tickerV2 doesn't include lastPrice, so calculate mid-price
    const price = (bid + ask) / 2;

    const priceData: KucoinPriceData = {
      exchange: 'Kucoin',
      type: 'F', // Futures
      price,
      bid,
      ask
    };

    this.onDataCallback?.(priceData);
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.ws?.close();
  }
}
