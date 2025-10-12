// BingX REST API
// Documentation: https://bingx-api.github.io/docs/
// GitHub: https://github.com/BingX-API/BingX-Standard-Contract-doc

import { logger } from '../utils/logger';

// CORS proxy (temporary solution for browser-based testing)
// BingX API does not allow direct browser access due to CORS policy
const CORS_PROXY = 'https://corsproxy.io/?';

interface BingXConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

interface BalanceResponse {
  USDT: number;
  VST: number;  // BingX demo trading uses VST
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

export class BingXAPI {
  private config: BingXConfig;
  private baseUrl: string;

  constructor(config: BingXConfig) {
    this.config = config;
    // BingX has separate endpoints for production and demo trading
    // Demo trading (testnet) uses VST (Virtual USDT) on open-api-vst.bingx.com
    // Production uses real USDT on open-api.bingx.com
    this.baseUrl = config.testnet
      ? 'https://open-api-vst.bingx.com'  // Demo/VST endpoint
      : 'https://open-api.bingx.com';      // Production endpoint

    if (config.testnet) {
      logger.info('BingX API', 'Using demo trading endpoint (VST)', {
        baseUrl: this.baseUrl
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

    // Use CORS proxy to bypass browser restrictions
    const proxiedUrl = CORS_PROXY + encodeURIComponent(url);

    logger.debug('BingX API', 'Using CORS proxy', {
      originalUrl: url,
      proxiedUrl: proxiedUrl.substring(0, 100) + '...'
    });

    const response = await fetch(proxiedUrl, {
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
   * Make public (unsigned) request to BingX API
   * Used for market data endpoints that don't require authentication
   */
  private async publicRequest(
    method: 'GET',
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    logger.info('BingX API', `Public Request ${method} ${endpoint}`, { params });

    let url = `${this.baseUrl}${endpoint}`;
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    // Use CORS proxy for browser access
    const proxiedUrl = CORS_PROXY + encodeURIComponent(url);

    const response = await fetch(proxiedUrl, {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('BingX API', 'Public Request Failed', {
        status: response.status,
        errorText
      });
      throw new Error(`BingX API error: ${response.status} - ${errorText}`);
    }

    const jsonResponse = await response.json();
    logger.debug('BingX API', 'Public Response', {
      code: jsonResponse.code,
      msg: jsonResponse.msg
    });

    return jsonResponse;
  }

  /**
   * Get Order Book (Market Depth)
   * @param symbol Trading pair (e.g., 'KAS-USDT')
   * @param limit Depth limit (default: 20, max: 100)
   * @returns Order book with bids and asks
   */
  async getOrderBook(symbol: string, limit: number = 20): Promise<OrderBookResponse> {
    try {
      logger.info('BingX API', 'Fetching order book...', { symbol, limit });

      const response = await this.publicRequest('GET', '/openApi/swap/v2/quote/depth', {
        symbol,
        limit: Math.min(limit, 100).toString() // Max 100
      });

      if (response.code !== 0) {
        throw new Error(response.msg || 'Failed to fetch order book');
      }

      // Parse order book data
      // BingX format: { bids: [["price", "quantity"], ...], asks: [["price", "quantity"], ...] }
      const rawBids = response.data?.bids || [];
      const rawAsks = response.data?.asks || [];

      const bids: OrderBookEntry[] = rawBids.map((entry: any[]) => ({
        price: parseFloat(entry[0]),
        quantity: parseFloat(entry[1])
      }));

      const asks: OrderBookEntry[] = rawAsks.map((entry: any[]) => ({
        price: parseFloat(entry[0]),
        quantity: parseFloat(entry[1])
      }));

      logger.info('BingX API', 'Order book fetched', {
        symbol,
        bidsCount: bids.length,
        asksCount: asks.length,
        bestBid: bids[0]?.price,
        bestAsk: asks[0]?.price
      });

      return { bids, asks };
    } catch (error) {
      logger.error('BingX API', 'Failed to fetch order book', {
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
      logger.info('BingX API', 'Testing connection...', {
        baseUrl: this.baseUrl,
        testnet: this.config.testnet
      });

      // Use Perpetual Swap balance endpoint to test connection
      const response = await this.request('GET', '/openApi/swap/v2/user/balance', {});

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

      // Use Perpetual Swap balance endpoint (V2 API)
      const response = await this.request('GET', '/openApi/swap/v2/user/balance', {});

      if (response.code !== 0) {
        logger.error('BingX API', 'Failed to fetch balance', {
          code: response.code,
          msg: response.msg
        });
        throw new Error(response.msg || 'Failed to fetch balance');
      }

      // Perpetual Swap V2 API returns data.balance (object), not an array
      // Response format: { data: { balance: { asset, balance, availableMargin, ... } } }
      const balanceData = response.data?.balance;

      if (!balanceData) {
        throw new Error('No balance data in response');
      }

      // Extract balance information
      const asset = balanceData.asset; // 'VST' for demo, 'USDT' for production
      const balanceValue = parseFloat(balanceData.balance || balanceData.availableMargin || '0');

      const balance = {
        USDT: asset === 'USDT' ? balanceValue : 0,
        VST: asset === 'VST' ? balanceValue : 0,
        KAS: 0  // KAS balance not provided in this endpoint
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
   * BingX Perpetual Futures uses V2 API: /openApi/swap/v2/trade/order
   *
   * Smart position side detection:
   * - Buy order: Checks for SHORT position first (to close), otherwise opens LONG
   * - Sell order: Checks for LONG position first (to close), otherwise opens SHORT
   */
  async placeOrder(params: {
    symbol: string;
    side: 'Buy' | 'Sell';
    orderType: 'Market' | 'Limit';
    qty: string;
    price?: string;
  }): Promise<OrderResponse> {
    try {
      // Get current position to determine if we're opening or closing
      const currentPosition = await this.getPosition(params.symbol);
      const currentAmt = currentPosition ? parseFloat(currentPosition.positionAmt || currentPosition.availableAmt || '0') : 0;

      let positionSide: string;

      if (params.side === 'Buy') {
        // BUY order logic:
        // - If SHORT position exists (amt < 0) → Close SHORT
        // - If no position or LONG exists → Open LONG
        if (currentAmt < 0) {
          positionSide = 'SHORT'; // Closing SHORT position
          logger.info('BingX API', 'BUY order will close existing SHORT position', {
            currentPositionAmt: currentAmt
          });
        } else {
          positionSide = 'LONG'; // Opening new LONG or adding to LONG
          logger.info('BingX API', 'BUY order will open/add to LONG position', {
            currentPositionAmt: currentAmt
          });
        }
      } else {
        // SELL order logic:
        // - If LONG position exists (amt > 0) → Close LONG
        // - If no position or SHORT exists → Open SHORT
        if (currentAmt > 0) {
          positionSide = 'LONG'; // Closing LONG position
          logger.info('BingX API', 'SELL order will close existing LONG position', {
            currentPositionAmt: currentAmt
          });
        } else {
          positionSide = 'SHORT'; // Opening new SHORT or adding to SHORT
          logger.info('BingX API', 'SELL order will open/add to SHORT position', {
            currentPositionAmt: currentAmt
          });
        }
      }

      const orderParams: Record<string, any> = {
        symbol: params.symbol,
        side: params.side.toUpperCase(),
        type: params.orderType.toUpperCase(),
        quantity: params.qty,
        positionSide // Dynamically determined based on current position
        // Note: marginCoin is automatically determined by BingX based on account type
        // Demo accounts use VST, production accounts use USDT
        // Do NOT specify marginCoin parameter
      };

      if (params.orderType === 'Limit' && params.price) {
        orderParams.price = params.price;
      }

      logger.info('BingX API', 'Placing order with smart position side detection', orderParams);

      // Use V2 API endpoint for perpetual futures
      const response = await this.request('POST', '/openApi/swap/v2/trade/order', orderParams);

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
   * Get current position for a specific symbol
   * BingX Perpetual Futures uses V2 API: /openApi/swap/v2/user/positions
   */
  async getPosition(symbol: string): Promise<any> {
    try {
      const response = await this.request('GET', '/openApi/swap/v2/user/positions', {
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

  /**
   * Get all open positions
   * BingX Perpetual Futures uses V2 API: /openApi/swap/v2/user/positions
   */
  async getAllPositions(): Promise<any[]> {
    try {
      logger.info('BingX API', 'Fetching all positions...');

      const response = await this.request('GET', '/openApi/swap/v2/user/positions', {});

      if (response.code !== 0) {
        logger.error('BingX API', 'Failed to fetch positions', {
          code: response.code,
          msg: response.msg
        });
        throw new Error(response.msg || 'Failed to fetch positions');
      }

      const positions = response.data || [];
      logger.info('BingX API', 'Positions fetched successfully', {
        count: positions.length
      });

      return positions;
    } catch (error) {
      logger.error('BingX API', 'Get all positions exception', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Close a specific position by placing opposite order
   * @param symbol Trading pair (e.g., 'KAS-USDT')
   * @param positionSide 'LONG' or 'SHORT'
   * @param quantity Position size to close (optional, closes all if not specified)
   */
  async closePosition(symbol: string, positionSide: 'LONG' | 'SHORT', quantity?: string): Promise<OrderResponse> {
    try {
      logger.info('BingX API', 'Closing position...', {
        symbol,
        positionSide,
        quantity
      });

      // Get current position to determine quantity if not specified
      if (!quantity) {
        const position = await this.getPosition(symbol);
        if (!position) {
          throw new Error('No open position found');
        }
        quantity = Math.abs(parseFloat(position.positionAmt || position.availableAmt || '0')).toString();
      }

      // Place opposite order to close position
      // LONG position → SELL order
      // SHORT position → BUY order
      const side = positionSide === 'LONG' ? 'Sell' : 'Buy';

      const orderParams: Record<string, any> = {
        symbol,
        side: side.toUpperCase(),
        type: 'MARKET',
        quantity,
        positionSide
        // Note: marginCoin is automatically determined by BingX
      };

      logger.info('BingX API', 'Placing close order...', orderParams);

      // Use V2 API endpoint for perpetual futures
      const response = await this.request('POST', '/openApi/swap/v2/trade/order', orderParams);

      if (response.code !== 0) {
        throw new Error(response.msg || 'Failed to close position');
      }

      logger.info('BingX API', 'Position closed successfully', {
        orderId: response.data?.orderId
      });

      return {
        orderId: response.data?.orderId || '',
        symbol,
        side,
        orderType: 'Market',
        price: 'Market',
        qty: quantity,
        status: 'Closed'
      };
    } catch (error) {
      logger.error('BingX API', 'Failed to close position', {
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
      logger.info('BingX API', 'Closing all positions...');

      // Try using V2 API endpoint for one-click close
      try {
        const response = await this.request('POST', '/openApi/swap/v2/trade/closeAllPositions', {});

        if (response.code === 0) {
          logger.info('BingX API', 'All positions closed successfully (V2 API)');
          return {
            success: true,
            message: 'All positions closed successfully'
          };
        }
      } catch (v2Error) {
        logger.warn('BingX API', 'V2 close all positions failed, trying manual close', {
          error: v2Error instanceof Error ? v2Error.message : String(v2Error)
        });
      }

      // Fallback: Close positions manually
      const positions = await this.getAllPositions();
      const openPositions = positions.filter((p: any) => {
        const amt = parseFloat(p.positionAmt || p.availableAmt || '0');
        return amt !== 0;
      });

      if (openPositions.length === 0) {
        logger.info('BingX API', 'No open positions to close');
        return {
          success: true,
          message: 'No open positions'
        };
      }

      logger.info('BingX API', `Closing ${openPositions.length} positions manually...`);

      // Close each position
      const closePromises = openPositions.map(async (position: any) => {
        const symbol = position.symbol;
        const amt = parseFloat(position.positionAmt || position.availableAmt || '0');
        const positionSide = amt > 0 ? 'LONG' : 'SHORT';
        const quantity = Math.abs(amt).toString();

        return this.closePosition(symbol, positionSide, quantity);
      });

      await Promise.all(closePromises);

      logger.info('BingX API', 'All positions closed successfully (manual)');

      return {
        success: true,
        message: `${openPositions.length} position(s) closed successfully`
      };
    } catch (error) {
      logger.error('BingX API', 'Failed to close all positions', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export default BingXAPI;
