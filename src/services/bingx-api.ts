// BingX REST API
// Documentation: https://bingx-api.github.io/docs/
// GitHub: https://github.com/BingX-API/BingX-Standard-Contract-doc

import { logger } from '../utils/logger';

interface BingXConfig {
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

export class BingXAPI {
  private config: BingXConfig;
  private baseUrl: string;

  constructor(config: BingXConfig) {
    this.config = config;
    // BingX does not have a public testnet/demo trading environment
    // Always use production endpoint (users should test with small amounts)
    this.baseUrl = 'https://open-api.bingx.com';

    if (config.testnet) {
      logger.warn('BingX API', 'BingX does not offer a testnet. Using production endpoint.', {
        recommendation: 'Test with small amounts'
      });
    }
  }

  /**
   * Generate HMAC SHA256 signature for BingX API
   */
  private async generateSignature(params: string): Promise<string> {
    // BingX signature format: HMAC_SHA256(parameters, secretKey)
    // Parameters include timestamp and all query params

    logger.debug('BingX API', 'Signature Generation - Key Info', {
      apiKeyLength: this.config.apiKey.length,
      apiKeyFirst8: this.config.apiKey.substring(0, 8),
      apiKeyLast4: this.config.apiKey.substring(this.config.apiKey.length - 4),
      secretKeyLength: this.config.apiSecret.length,
      secretKeyFirst4: this.config.apiSecret.substring(0, 4),
      secretKeyLast4: this.config.apiSecret.substring(this.config.apiSecret.length - 4)
    });

    logger.debug('BingX API', 'Signature Generation - Payload', {
      params,
      paramsLength: params.length
    });

    // Use Web Crypto API for HMAC SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.config.apiSecret);
    const messageData = encoder.encode(params);

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

    logger.debug('BingX API', 'Generated Signature - Full', {
      signatureLength: hashHex.length,
      signatureFirst16: hashHex.substring(0, 16),
      signatureLast16: hashHex.substring(hashHex.length - 16),
      fullSignature: hashHex
    });

    return hashHex;
  }

  /**
   * Make authenticated request to BingX API
   */
  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    logger.info('BingX API', `Request ${method} ${endpoint}`, { params });

    // Add timestamp and recvWindow to params
    const allParams: Record<string, any> = {
      ...params,
      timestamp,
      recvWindow
    };

    // Create parameter string (alphabetically sorted for consistency)
    const sortedKeys = Object.keys(allParams).sort();
    const paramString = sortedKeys
      .map(key => `${key}=${allParams[key]}`)
      .join('&');

    // Generate signature
    const signature = await this.generateSignature(paramString);

    // Add signature to params
    const finalParamString = `${paramString}&signature=${signature}`;

    let url = `${this.baseUrl}${endpoint}`;
    let body = '';

    if (method === 'GET') {
      url += `?${finalParamString}`;
    } else {
      body = finalParamString;
    }

    const headers: Record<string, string> = {
      'X-BX-APIKEY': this.config.apiKey,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    logger.debug('BingX API', 'Request Headers - Summary', {
      url: url.split('?')[0], // Don't log full URL with params
      method,
      apiKeyPrefix: this.config.apiKey.substring(0, 8) + '...',
      timestamp,
      signaturePrefix: signature.substring(0, 16) + '...',
      recvWindow
    });

    logger.debug('BingX API', 'Request Headers - Full', {
      'X-BX-APIKEY': this.config.apiKey,
      timestamp,
      signature,
      recvWindow,
      paramString: paramString.length > 200 ? paramString.substring(0, 200) + '...' : paramString
    });

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined
    });

    logger.debug('BingX API', 'Response Status', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('BingX API', 'Request Failed', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`BingX API error: ${response.status} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    logger.debug('BingX API', 'Response Data', {
      code: jsonResponse.code,
      msg: jsonResponse.msg
    });

    logger.debug('BingX API', 'Full Response Body', {
      fullResponse: JSON.stringify(jsonResponse, null, 2)
    });

    return jsonResponse;
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      logger.info('BingX API', 'Testing connection...', {
        baseUrl: this.baseUrl,
        testnet: this.config.testnet
      });

      // Use balance endpoint to test connection
      const response = await this.request('GET', '/openApi/contract/v1/balance', {});

      const success = response.code === 0;
      if (success) {
        logger.info('BingX API', 'Connection test successful', { code: response.code });
      } else {
        logger.error('BingX API', 'Connection test failed', {
          code: response.code,
          msg: response.msg
        });
      }

      return success;
    } catch (error) {
      logger.error('BingX API', 'Connection test exception', {
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
      logger.info('BingX API', 'Fetching account balance...');

      const response = await this.request('GET', '/openApi/contract/v1/balance', {});

      if (response.code !== 0) {
        logger.error('BingX API', 'Failed to fetch balance', {
          code: response.code,
          msg: response.msg
        });
        throw new Error(response.msg || 'Failed to fetch balance');
      }

      const data = response.data?.balance || {};

      // BingX returns balance in asset-specific format
      // Extract USDT and KAS if available
      const balance = {
        USDT: parseFloat(data.availableMargin || '0'),
        KAS: 0 // BingX contract balance doesn't show KAS separately - would need spot endpoint
      };

      logger.info('BingX API', 'Balance fetched successfully', balance);

      return balance;
    } catch (error) {
      logger.error('BingX API', 'Get balance exception', {
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
        symbol: params.symbol,
        side: params.side.toUpperCase(),
        type: params.orderType.toUpperCase(),
        quantity: params.qty,
        positionSide: 'LONG' // Default to LONG position
      };

      if (params.orderType === 'Limit' && params.price) {
        orderParams.price = params.price;
      }

      const response = await this.request('POST', '/openApi/contract/v1/order', orderParams);

      if (response.code !== 0) {
        throw new Error(response.msg || 'Failed to place order');
      }

      return {
        orderId: response.data.orderId || '',
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        price: params.price || 'Market',
        qty: params.qty,
        status: 'Created'
      };
    } catch (error) {
      logger.error('BingX API', 'Failed to place order', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get current position
   */
  async getPosition(symbol: string): Promise<any> {
    try {
      const response = await this.request('GET', '/openApi/contract/v1/allPosition', {
        symbol
      });

      if (response.code !== 0) {
        throw new Error(response.msg || 'Failed to get position');
      }

      const positions = response.data || [];
      return positions.find((p: any) => p.symbol === symbol) || null;
    } catch (error) {
      logger.error('BingX API', 'Failed to get position', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export default BingXAPI;
