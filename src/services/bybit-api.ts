// Bybit REST API V5
// Documentation: https://bybit-exchange.github.io/docs/v5/intro

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
    this.baseUrl = config.testnet
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';
  }

  /**
   * Generate HMAC SHA256 signature for Bybit API
   */
  private async generateSignature(params: string): Promise<string> {
    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    // Bybit V5 signature format: timestamp + apiKey + recvWindow + params
    const signaturePayload = timestamp + this.config.apiKey + recvWindow + params;

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

    const signature = await this.generateSignature(queryString);

    const headers: Record<string, string> = {
      'X-BAPI-API-KEY': this.config.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow,
    };

    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bybit API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Use account info endpoint to test connection
      const response = await this.request('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED'
      });

      return response.retCode === 0;
    } catch (error) {
      console.error('Bybit connection test failed:', error);
      return false;
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<BalanceResponse> {
    try {
      const response = await this.request('GET', '/v5/account/wallet-balance', {
        accountType: 'UNIFIED'
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to fetch balance');
      }

      const coins = response.result.list[0]?.coin || [];
      const usdtCoin = coins.find((c: any) => c.coin === 'USDT');
      const kasCoin = coins.find((c: any) => c.coin === 'KAS');

      return {
        USDT: parseFloat(usdtCoin?.walletBalance || '0'),
        KAS: parseFloat(kasCoin?.walletBalance || '0')
      };
    } catch (error) {
      console.error('Failed to get balance:', error);
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
