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

interface OrderBookEntry {
  price: number;
  quantity: number;
}

interface OrderBookResponse {
  bids: OrderBookEntry[];  // Buy orders, sorted descending by price
  asks: OrderBookEntry[];  // Sell orders, sorted ascending by price
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
   * Make public (unsigned) request to Bybit API
   * Used for market data endpoints that don't require authentication
   */
  private async publicRequest(
    method: 'GET',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    logger.info('Bybit API', `Public Request ${method} ${endpoint}`, { params });

    let url = `${this.baseUrl}${endpoint}`;
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Bybit API', 'Public Request Failed', {
        status: response.status,
        errorText
      });
      throw new Error(`Bybit API error: ${response.status} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    logger.debug('Bybit API', 'Public Response', {
      retCode: jsonResponse.retCode,
      retMsg: jsonResponse.retMsg
    });

    return jsonResponse;
  }

  /**
   * Get Order Book (Market Depth)
   * @param symbol Trading pair (e.g., 'KASUSDT')
   * @param limit Depth limit (1-200 for spot, 1-500 for linear, default: 25)
   * @returns Order book with bids and asks
   */
  async getOrderBook(symbol: string, limit: number = 50): Promise<OrderBookResponse> {
    try {
      logger.info('Bybit API', 'Fetching order book...', { symbol, limit });

      const response = await this.publicRequest('GET', '/v5/market/orderbook', {
        category: 'linear',
        symbol,
        limit: Math.min(limit, 500).toString() // Max 500 for linear
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to fetch order book');
      }

      // Parse order book data
      // Bybit format: { b: [["price", "qty"], ...], a: [["price", "qty"], ...] }
      const rawBids = response.result.b || [];
      const rawAsks = response.result.a || [];

      const bids: OrderBookEntry[] = rawBids.map((entry: string[]) => ({
        price: parseFloat(entry[0]),
        quantity: parseFloat(entry[1])
      })).sort((a, b) => b.price - a.price); // Sort descending by price

      const asks: OrderBookEntry[] = rawAsks.map((entry: string[]) => ({
        price: parseFloat(entry[0]),
        quantity: parseFloat(entry[1])
      })).sort((a, b) => a.price - b.price); // Sort ascending by price

      logger.info('Bybit API', 'Order book fetched', {
        symbol,
        bidsCount: bids.length,
        asksCount: asks.length,
        bestBid: bids[0]?.price,
        bestAsk: asks[0]?.price
      });

      return { bids, asks };
    } catch (error) {
      logger.error('Bybit API', 'Failed to fetch order book', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
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
        positionIdx: 0, // 0 = one-way mode (default for most accounts)
      };

      if (params.orderType === 'Limit' && params.price) {
        orderParams.price = params.price;
      }

      logger.info('Bybit API', 'Attempting to place order with params', orderParams);

      const response = await this.request('POST', '/v5/order/create', orderParams);

      if (response.retCode !== 0) {
        // Log detailed error information for debugging
        logger.error('Bybit API', 'Order creation failed - Full response', {
          retCode: response.retCode,
          retMsg: response.retMsg,
          result: response.result,
          retExtInfo: response.retExtInfo
        });

        // Provide user-friendly error messages for common issues
        let errorMessage = response.retMsg || 'Failed to place order';

        if (response.retCode === 10005) {
          errorMessage = '❌ API Key Permission Error (10005)\n\n' +
            'Possible causes:\n' +
            '1. API key missing "Contract - Trade" permission\n' +
            '2. Added permission to existing key (need to create NEW key)\n' +
            '3. API key just created (wait 2-3 minutes for activation)\n\n' +
            'Solution:\n' +
            '→ Delete old API key\n' +
            '→ Create NEW API key with these permissions:\n' +
            '   ✅ Contract - Trade (必須!)\n' +
            '   ✅ Contract - Order & Position\n' +
            '   ✅ Unified Trading - Trade\n' +
            '→ Wait 2-3 minutes after creation\n' +
            '→ Update in API Tab\n\n' +
            `Original: ${response.retMsg}`;
        } else if (response.retCode === 10004) {
          errorMessage = '❌ Invalid API Signature. Please check your API Secret.';
        } else if (response.retCode === 10003) {
          errorMessage = '❌ Invalid API Key. Please verify your API Key.';
        }

        throw new Error(errorMessage);
      }

      logger.info('Bybit API', 'Order placed successfully', {
        orderId: response.result.orderId,
        symbol: params.symbol,
        side: params.side,
        qty: params.qty
      });

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
      logger.error('Bybit API', 'Failed to place order', {
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
      const response = await this.request('GET', '/v5/position/list', {
        category: 'linear',
        symbol
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to get position');
      }

      return response.result.list[0] || null;
    } catch (error) {
      logger.error('Bybit API', 'Failed to get position', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get all open positions
   */
  async getAllPositions(): Promise<any[]> {
    try {
      logger.info('Bybit API', 'Fetching all positions...');

      const response = await this.request('GET', '/v5/position/list', {
        category: 'linear',
        settleCoin: 'USDT'
      });

      if (response.retCode !== 0) {
        logger.error('Bybit API', 'Failed to fetch positions', {
          retCode: response.retCode,
          retMsg: response.retMsg
        });
        throw new Error(response.retMsg || 'Failed to fetch positions');
      }

      const positions = response.result.list || [];
      logger.info('Bybit API', 'Positions fetched successfully', {
        count: positions.length
      });

      return positions;
    } catch (error) {
      logger.error('Bybit API', 'Get all positions exception', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Close a specific position by placing opposite order
   * @param symbol Trading pair (e.g., 'KASUSDT')
   * @param side Position side ('Buy' = Long, 'Sell' = Short)
   * @param quantity Position size to close (optional, closes all if not specified)
   */
  async closePosition(symbol: string, side: 'Buy' | 'Sell', quantity?: string): Promise<OrderResponse> {
    try {
      logger.info('Bybit API', 'Closing position...', {
        symbol,
        side,
        quantity
      });

      // Get current position to determine quantity if not specified
      let closeQty: string;
      if (!quantity) {
        const position = await this.getPosition(symbol);
        if (!position) {
          throw new Error('No open position found');
        }
        closeQty = position.size;
      } else {
        closeQty = quantity;
      }

      // Place opposite order to close position
      // Long position (side=Buy) → Sell order
      // Short position (side=Sell) → Buy order
      const closeSide = side === 'Buy' ? 'Sell' : 'Buy';

      const orderParams = {
        category: 'linear',
        symbol,
        side: closeSide,
        orderType: 'Market',
        qty: closeQty,
        positionIdx: 0, // 0 = one-way mode
        reduceOnly: true  // Important: This ensures we're closing, not opening new position
      };

      logger.info('Bybit API', 'Placing close order...', orderParams);

      const response = await this.request('POST', '/v5/order/create', orderParams);

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to close position');
      }

      logger.info('Bybit API', 'Position closed successfully', {
        orderId: response.result.orderId
      });

      return {
        orderId: response.result.orderId,
        symbol,
        side: closeSide,
        orderType: 'Market',
        price: 'Market',
        qty: closeQty,
        status: 'Closed'
      };
    } catch (error) {
      logger.error('Bybit API', 'Failed to close position', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Close all open positions at once
   */
  async closeAllPositions(): Promise<{ success: boolean; message: string }> {
    try {
      logger.info('Bybit API', 'Closing all positions...');

      const positions = await this.getAllPositions();
      const openPositions = positions.filter((p: any) => parseFloat(p.size) > 0);

      if (openPositions.length === 0) {
        logger.info('Bybit API', 'No open positions to close');
        return {
          success: true,
          message: 'No open positions'
        };
      }

      logger.info('Bybit API', `Closing ${openPositions.length} positions...`);

      // Close each position
      const closePromises = openPositions.map(async (position: any) => {
        const symbol = position.symbol;
        const side = position.side; // 'Buy' or 'Sell'
        const quantity = position.size;

        return this.closePosition(symbol, side, quantity);
      });

      await Promise.all(closePromises);

      logger.info('Bybit API', 'All positions closed successfully');

      return {
        success: true,
        message: `${openPositions.length} position(s) closed successfully`
      };
    } catch (error) {
      logger.error('Bybit API', 'Failed to close all positions', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export default BybitAPI;
