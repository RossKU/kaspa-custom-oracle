// Bybit REST API V5
// Documentation: https://bybit-exchange.github.io/docs/v5/intro

import { logger } from '../utils/logger';

interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

interface BalanceResponse {
  USDT: number;
  KAS: number;
}

interface OrderResponse {
  orderId: string;
  symbol: string;
  side: 'Buy' | 'Sell';
  orderType: string;
  price: string;
  qty: string;
  status: string;
}

export class BybitAPI {
  private config: BybitConfig;
  private baseUrl: string;

  constructor(config: BybitConfig) {
    this.config = config;
    // Bybit has 3 environments - each requires matching API key:
    // 1. Production (api.bybit.com) - requires Production API key
    // 2. Demo Trading (api-demo.bybit.com) - requires Demo Trading API key from bybit.com
    // 3. Testnet (api-testnet.bybit.com) - requires Testnet API key from testnet.bybit.com
    // Currently using Demo Trading endpoint for testing
    this.baseUrl = config.testnet
      ? 'https://api-demo.bybit.com'
      : 'https://api.bybit.com';
  }

  /**
   * Generate HMAC SHA256 signature for Bybit API
   */
  private async generateSignature(params: string, timestamp: string, recvWindow: string): Promise<string> {
    // Bybit V5 signature format: timestamp + apiKey + recvWindow + params
    const signaturePayload = timestamp + this.config.apiKey + recvWindow + params;

    logger.debug('Bybit API', 'Signature Generation - Key Info', {
      apiKeyLength: this.config.apiKey.length,
      apiKeyFirst8: this.config.apiKey.substring(0, 8),
      apiKeyLast4: this.config.apiKey.substring(this.config.apiKey.length - 4),
      secretKeyLength: this.config.apiSecret.length,
      secretKeyFirst4: this.config.apiSecret.substring(0, 4),
      secretKeyLast4: this.config.apiSecret.substring(this.config.apiSecret.length - 4)
    });

    logger.debug('Bybit API', 'Signature Generation - Payload', {
      timestamp,
      timestampLength: timestamp.length,
      recvWindow,
      params,
      paramsLength: params.length,
      signaturePayload,
      signaturePayloadLength: signaturePayload.length
    });

    // Use Web Crypto API for HMAC SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.config.apiSecret);
    const messageData = encoder.encode(signaturePayload);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const hashArray = Array.from(new Uint8Array(signature));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    logger.debug('Bybit API', 'Generated Signature - Full', {
      signatureLength: hashHex.length,
      signatureFirst16: hashHex.substring(0, 16),
      signatureLast16: hashHex.substring(hashHex.length - 16),
      fullSignature: hashHex
    });

    return hashHex;
  }

  /**
   * Make authenticated request to Bybit API
   */
  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    logger.info('Bybit API', `Request ${method} ${endpoint}`, { params });

    let url = `${this.baseUrl}${endpoint}`;
    let body = '';
    let queryString = '';

    if (method === 'GET') {
      const searchParams = new URLSearchParams(params);
      queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    } else {
      body = JSON.stringify(params);
      queryString = body;
    }

    const signature = await this.generateSignature(queryString, timestamp, recvWindow);

    const headers: Record<string, string> = {
      'X-BAPI-API-KEY': this.config.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    logger.debug('Bybit API', 'Request Headers - Summary', {
      url,
      method,
      apiKeyPrefix: this.config.apiKey.substring(0, 8) + '...',
      timestamp,
      signaturePrefix: signature.substring(0, 16) + '...',
      recvWindow
    });

    logger.debug('Bybit API', 'Request Headers - Full', {
      'X-BAPI-API-KEY': this.config.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow,
      queryString,
      body: body || '(empty)'
    });

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined
    });

    logger.debug('Bybit API', 'Response Status', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Bybit API', 'Request Failed', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`Bybit API error: ${response.status} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    logger.debug('Bybit API', 'Response Data', {
      retCode: jsonResponse.retCode,
      retMsg: jsonResponse.retMsg
    });

    logger.debug('Bybit API', 'Full Response Body', {
      fullResponse: JSON.stringify(jsonResponse, null, 2)
    });

    return jsonResponse;
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('Bybit API', 'Testing connection...', {
        baseUrl: this.baseUrl,
        testnet: this.config.testnet
      });

      // Use account info endpoint to test connection
      // Demo Trading only supports UNIFIED account type
      const response = await this.request('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED'
      });

      const success = response.retCode === 0;
      if (success) {
        logger.info('Bybit API', 'Connection test successful', { retCode: response.retCode });
      } else {
        logger.error('Bybit API', 'Connection test failed', {
          retCode: response.retCode,
          retMsg: response.retMsg
        });
      }

      return success;
    } catch (error) {
      logger.error('Bybit API', 'Connection test exception', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<BalanceResponse> {
    try {
      logger.info('Bybit API', 'Fetching account balance...');

      // Demo Trading only supports UNIFIED account type
      const response = await this.request('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED'
      });

      if (response.retCode !== 0) {
        logger.error('Bybit API', 'Failed to fetch balance', {
          retCode: response.retCode,
          retMsg: response.retMsg
        });
        throw new Error(response.retMsg || 'Failed to fetch balance');
      }

      const coins = response.result.list[0]?.coin || [];
      const usdtCoin = coins.find((c: any) => c.coin === 'USDT');
      const kasCoin = coins.find((c: any) => c.coin === 'KAS');

      const balance = {
        USDT: parseFloat(usdtCoin?.walletBalance || '0'),
        KAS: parseFloat(kasCoin?.walletBalance || '0')
      };

      logger.info('Bybit API', 'Balance fetched successfully', balance);

      return balance;
    } catch (error) {
      logger.error('Bybit API', 'Get balance exception', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Place order (Market or Limit)
   */
  async placeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    orderType: 'Market' | 'Limit';
    qty: string;
    price?: string;
  }): Promise<OrderResponse> {
    try {
      const orderParams: Record<string, any> = {
        category: 'linear', // USDT Perpetual
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        qty: params.qty,
      };

      if (params.orderType === 'Limit' && params.price) {
        orderParams.price = params.price;
      }

      const response = await this.request('POST', '/v5/order/create', orderParams);

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to place order');
      }

      return {
        orderId: response.result.orderId,
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        price: params.price || 'Market',
        qty: params.qty,
        status: 'Created'
      };
    } catch (error) {
      console.error('Failed to place order:', error);
      throw error;
    }
  }

  /**
   * Get current position
   */
  async getPosition(symbol: string): Promise<any> {
    try {
      const response = await this.request('GET', '/v5/position/list', {
        category: 'linear',
        symbol
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to get position');
      }

      return response.result.list[0] || null;
    } catch (error) {
      console.error('Failed to get position:', error);
      throw error;
    }
  }
}

export default BybitAPI;
