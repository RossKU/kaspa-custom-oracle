import { useState, useEffect } from 'react';
import { TRADE_PASSWORD, SESSION_TIMEOUT } from '../types/trade';
import type { TradeAuthState } from '../types/trade';
import type { PriceData } from '../types/binance';
import type { MexcPriceData } from '../services/mexc';
import type { BybitPriceData } from '../services/bybit';
import type { GateioPriceData } from '../services/gateio';
import type { KucoinPriceData } from '../services/kucoin';
import type { BingXPriceData } from '../services/bingx';
import { logger } from '../utils/logger';
import BingXAPI from '../services/bingx-api';
import BybitAPI from '../services/bybit-api';

interface TradeTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
}

export function TradeTab(props: TradeTabProps) {
  const [authState, setAuthState] = useState<TradeAuthState>({
    isAuthenticated: false,
    lastAuthTime: null,
    sessionTimeout: SESSION_TIMEOUT
  });

  const [passwordInput, setPasswordInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Exchange selection state
  const [exchangeA, setExchangeA] = useState('Bybit');
  const [exchangeB, setExchangeB] = useState('BingX');

  // Trading state
  const [positions, setPositions] = useState<any[]>([]);
  const [tradeQuantity, setTradeQuantity] = useState('100');
  const [tradeMessage, setTradeMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bingxApi, setBingxApi] = useState<BingXAPI | null>(null);

  // Bybit trading state
  const [bybitPositions, setBybitPositions] = useState<any[]>([]);
  const [bybitTradeQuantity, setBybitTradeQuantity] = useState('100');
  const [bybitTradeMessage, setBybitTradeMessage] = useState('');
  const [bybitIsLoading, setBybitIsLoading] = useState(false);
  const [bybitApi, setBybitApi] = useState<BybitAPI | null>(null);

  // Get Bid/Ask prices from exchange name
  const getExchangeData = (exchange: string): { bid: number; ask: number } | null => {
    switch (exchange) {
      case 'Binance':
        if (!props.binanceData) return null;
        return { bid: props.binanceData.price || 0, ask: props.binanceData.price || 0 };
      case 'MEXC':
        if (!props.mexcData) return null;
        return { bid: props.mexcData.price || 0, ask: props.mexcData.price || 0 };
      case 'Bybit':
        if (!props.bybitData) return null;
        return { bid: props.bybitData.bid || 0, ask: props.bybitData.ask || 0 };
      case 'Gate.io':
        if (!props.gateioData) return null;
        return { bid: props.gateioData.price || 0, ask: props.gateioData.price || 0 };
      case 'Kucoin':
        if (!props.kucoinData) return null;
        return { bid: props.kucoinData.price || 0, ask: props.kucoinData.price || 0 };
      case 'BingX':
        if (!props.bingxData) return null;
        return { bid: props.bingxData.bid || 0, ask: props.bingxData.ask || 0 };
      default:
        return null;
    }
  };

  // Calculate arbitrage gap (correct calculation for arbitrage trading)
  // "A買いB売り" = Buy at A (ask price) and Sell at B (bid price)
  // Gap = (B_bid - A_ask) / A_ask * 100
  const calculateArbitrageGap = (
    buyExchangeData: { bid: number; ask: number } | null,
    sellExchangeData: { bid: number; ask: number } | null
  ): string => {
    if (!buyExchangeData || !sellExchangeData) return '--';
    const buyPrice = buyExchangeData.ask;  // Buy at ASK price
    const sellPrice = sellExchangeData.bid; // Sell at BID price
    if (buyPrice === 0) return '--';
    const gap = ((sellPrice - buyPrice) / buyPrice) * 100;
    return gap.toFixed(3);
  };

  // Calculate gaps for both directions with proper Bid/Ask
  const exchangeAData = getExchangeData(exchangeA);
  const exchangeBData = getExchangeData(exchangeB);
  const gapABuyBSell = calculateArbitrageGap(exchangeAData, exchangeBData); // A買いB売り (A ask → B bid)
  const gapBBuyASell = calculateArbitrageGap(exchangeBData, exchangeAData); // B買いA売り (B ask → A bid)

  // Check session timeout
  useEffect(() => {
    if (authState.isAuthenticated && authState.lastAuthTime) {
      const checkTimeout = () => {
        const elapsed = Date.now() - authState.lastAuthTime!;
        if (elapsed > SESSION_TIMEOUT) {
          logger.info('Trade Tab', 'Session expired, logging out');
          setAuthState({
            isAuthenticated: false,
            lastAuthTime: null,
            sessionTimeout: SESSION_TIMEOUT
          });
        }
      };

      const interval = setInterval(checkTimeout, 60000); // Check every minute
      return () => clearInterval(interval);
    }
  }, [authState]);

  const handleLogin = () => {
    if (passwordInput === TRADE_PASSWORD) {
      logger.info('Trade Tab', 'Authentication successful');
      setAuthState({
        isAuthenticated: true,
        lastAuthTime: Date.now(),
        sessionTimeout: SESSION_TIMEOUT
      });
      setPasswordInput('');
      setErrorMessage('');
    } else {
      logger.warn('Trade Tab', 'Authentication failed');
      setErrorMessage('❌ Incorrect password');
      setPasswordInput('');
    }
  };

  const handleLogout = () => {
    logger.info('Trade Tab', 'User logged out');
    setAuthState({
      isAuthenticated: false,
      lastAuthTime: null,
      sessionTimeout: SESSION_TIMEOUT
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  // Initialize BingX API from localStorage
  useEffect(() => {
    if (authState.isAuthenticated) {
      try {
        logger.info('Trade Tab', 'Attempting to load API config from localStorage');

        // Try loading from bingx_api_config first (backward compatibility)
        let savedConfig = localStorage.getItem('bingx_api_config');
        let configSource = 'bingx_api_config';

        // If not found, try apiConfig with exchange = bingx
        if (!savedConfig) {
          const apiConfig = localStorage.getItem('apiConfig');
          logger.info('Trade Tab', 'bingx_api_config not found, trying apiConfig', {
            apiConfigExists: !!apiConfig
          });

          if (apiConfig) {
            const parsed = JSON.parse(apiConfig);
            if (parsed.exchange === 'bingx') {
              savedConfig = JSON.stringify({
                apiKey: parsed.apiKey,
                apiSecret: parsed.apiSecret,
                testnet: parsed.testnet
              });
              configSource = 'apiConfig (bingx)';
            } else {
              logger.warn('Trade Tab', 'apiConfig exists but exchange is not bingx', {
                exchange: parsed.exchange
              });
            }
          }
        }

        if (savedConfig) {
          const config = JSON.parse(savedConfig);
          logger.info('Trade Tab', 'API config loaded', {
            source: configSource,
            hasApiKey: !!config.apiKey,
            apiKeyLength: config.apiKey?.length || 0,
            hasApiSecret: !!config.apiSecret,
            apiSecretLength: config.apiSecret?.length || 0,
            testnet: config.testnet
          });

          const api = new BingXAPI({
            apiKey: config.apiKey,
            apiSecret: config.apiSecret,
            testnet: config.testnet
          });
          setBingxApi(api);
          logger.info('Trade Tab', '✅ BingX API initialized successfully');
        } else {
          logger.warn('Trade Tab', 'No BingX API configuration found in localStorage', {
            bingx_api_config: !!localStorage.getItem('bingx_api_config'),
            apiConfig: !!localStorage.getItem('apiConfig')
          });
        }
      } catch (error) {
        logger.error('Trade Tab', 'Failed to initialize BingX API', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }
  }, [authState.isAuthenticated]);

  // Initialize Bybit API from localStorage
  useEffect(() => {
    if (authState.isAuthenticated) {
      try {
        logger.info('Trade Tab', 'Attempting to load Bybit API config from localStorage');

        // Try loading from bybit_api_config first (new format)
        let savedConfig = localStorage.getItem('bybit_api_config');
        let configSource = 'bybit_api_config';

        // If not found, try apiConfig with exchange = bybit (backward compatibility)
        if (!savedConfig) {
          const apiConfig = localStorage.getItem('apiConfig');
          logger.info('Trade Tab', 'bybit_api_config not found, trying apiConfig', {
            apiConfigExists: !!apiConfig
          });

          if (apiConfig) {
            const parsed = JSON.parse(apiConfig);
            if (parsed.exchange === 'bybit') {
              savedConfig = JSON.stringify({
                apiKey: parsed.apiKey,
                apiSecret: parsed.apiSecret,
                testnet: parsed.testnet
              });
              configSource = 'apiConfig (bybit)';
            } else {
              logger.warn('Trade Tab', 'apiConfig exists but exchange is not bybit', {
                exchange: parsed.exchange
              });
            }
          }
        }

        if (savedConfig) {
          const config = JSON.parse(savedConfig);
          logger.info('Trade Tab', 'Bybit API config loaded', {
            source: configSource,
            hasApiKey: !!config.apiKey,
            apiKeyLength: config.apiKey?.length || 0,
            hasApiSecret: !!config.apiSecret,
            apiSecretLength: config.apiSecret?.length || 0,
            testnet: config.testnet
          });

          const api = new BybitAPI({
            apiKey: config.apiKey,
            apiSecret: config.apiSecret,
            testnet: config.testnet
          });
          setBybitApi(api);
          logger.info('Trade Tab', '✅ Bybit API initialized successfully');
        } else {
          logger.warn('Trade Tab', 'No Bybit API configuration found in localStorage', {
            bybit_api_config: !!localStorage.getItem('bybit_api_config'),
            apiConfig: !!localStorage.getItem('apiConfig')
          });
        }
      } catch (error) {
        logger.error('Trade Tab', 'Failed to initialize Bybit API', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
    }
  }, [authState.isAuthenticated]);

  // Fetch BingX positions periodically
  useEffect(() => {
    if (!bingxApi || !authState.isAuthenticated) {
      logger.info('Trade Tab', 'Position fetcher not starting', {
        hasBingxApi: !!bingxApi,
        isAuthenticated: authState.isAuthenticated
      });
      return;
    }

    logger.info('Trade Tab', 'Starting position fetcher (5s interval)');

    const fetchPositions = async () => {
      try {
        logger.info('Trade Tab', 'Fetching positions...');
        const allPositions = await bingxApi.getAllPositions();
        // Filter only open positions
        const openPositions = allPositions.filter((p: any) => {
          const amt = parseFloat(p.positionAmt || p.availableAmt || '0');
          return amt !== 0;
        });
        logger.info('Trade Tab', 'Positions fetched', {
          total: allPositions.length,
          open: openPositions.length
        });
        setPositions(openPositions);
      } catch (error) {
        logger.error('Trade Tab', 'Failed to fetch positions', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 5000); // Refresh every 5 seconds

    return () => {
      logger.info('Trade Tab', 'Stopping position fetcher');
      clearInterval(interval);
    };
  }, [bingxApi, authState.isAuthenticated]);

  // Fetch Bybit positions periodically
  useEffect(() => {
    if (!bybitApi || !authState.isAuthenticated) {
      return;
    }

    const fetchBybitPositions = async () => {
      try {
        const allPositions = await bybitApi.getAllPositions();
        // Filter only open positions
        const openPositions = allPositions.filter((p: any) => parseFloat(p.size) > 0);
        setBybitPositions(openPositions);
      } catch (error) {
        logger.error('Trade Tab', 'Failed to fetch Bybit positions', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    fetchBybitPositions();
    const interval = setInterval(fetchBybitPositions, 5000);
    return () => clearInterval(interval);
  }, [bybitApi, authState.isAuthenticated]);

  // Manual trading handlers
  const handleMarketBuy = async () => {
    if (!bingxApi) {
      setTradeMessage('❌ BingX API not configured. Go to API tab first.');
      return;
    }

    setIsLoading(true);
    setTradeMessage('⏳ Placing Market Buy order...');

    try {
      // Get and log balance before placing order
      logger.info('Trade Tab', 'Attempting Market Buy', {
        symbol: 'KAS-USDT',
        quantity: tradeQuantity,
        side: 'Buy',
        type: 'Market'
      });

      const balance = await bingxApi.getBalance();
      logger.info('Trade Tab', 'Current balance before order', balance);

      const result = await bingxApi.placeOrder({
        symbol: 'KAS-USDT',
        side: 'Buy',
        orderType: 'Market',
        qty: tradeQuantity
      });

      setTradeMessage(`✅ Buy order placed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Market Buy executed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Market Buy failed', {
        error: errorMsg,
        quantity: tradeQuantity
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarketSell = async () => {
    if (!bingxApi) {
      setTradeMessage('❌ BingX API not configured. Go to API tab first.');
      return;
    }

    setIsLoading(true);
    setTradeMessage('⏳ Placing Market Sell order...');

    try {
      const result = await bingxApi.placeOrder({
        symbol: 'KAS-USDT',
        side: 'Sell',
        orderType: 'Market',
        qty: tradeQuantity
      });

      setTradeMessage(`✅ Sell order placed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Market Sell executed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Market Sell failed', { error: errorMsg });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClosePosition = async (symbol: string, positionSide: 'LONG' | 'SHORT') => {
    if (!bingxApi) return;

    setIsLoading(true);
    setTradeMessage(`⏳ Closing ${positionSide} position...`);

    try {
      const result = await bingxApi.closePosition(symbol, positionSide);
      setTradeMessage(`✅ Position closed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Position closed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Close position failed', { error: errorMsg });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseAllPositions = async () => {
    if (!bingxApi) return;

    if (!confirm('⚠️ Close ALL positions? This cannot be undone!')) {
      return;
    }

    setIsLoading(true);
    setTradeMessage('⏳ Closing all positions...');

    try {
      const result = await bingxApi.closeAllPositions();
      setTradeMessage(`✅ ${result.message}`);
      logger.info('Trade Tab', 'All positions closed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Close all positions failed', { error: errorMsg });
    } finally {
      setIsLoading(false);
    }
  };

  // Bybit manual trading handlers
  const handleBybitMarketBuy = async () => {
    if (!bybitApi) {
      setBybitTradeMessage('❌ Bybit API not configured. Go to API tab first.');
      return;
    }

    setBybitIsLoading(true);
    setBybitTradeMessage('⏳ Placing Market Buy order...');

    try {
      const result = await bybitApi.placeOrder({
        symbol: 'KASUSDT',  // No hyphen
        side: 'Buy',
        orderType: 'Market',
        qty: bybitTradeQuantity
      });

      setBybitTradeMessage(`✅ Buy order placed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Bybit Market Buy executed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setBybitTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Bybit Market Buy failed', { error: errorMsg });
    } finally {
      setBybitIsLoading(false);
    }
  };

  const handleBybitMarketSell = async () => {
    if (!bybitApi) {
      setBybitTradeMessage('❌ Bybit API not configured. Go to API tab first.');
      return;
    }

    setBybitIsLoading(true);
    setBybitTradeMessage('⏳ Placing Market Sell order...');

    try {
      const result = await bybitApi.placeOrder({
        symbol: 'KASUSDT',
        side: 'Sell',
        orderType: 'Market',
        qty: bybitTradeQuantity
      });

      setBybitTradeMessage(`✅ Sell order placed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Bybit Market Sell executed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setBybitTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Bybit Market Sell failed', { error: errorMsg });
    } finally {
      setBybitIsLoading(false);
    }
  };

  const handleBybitClosePosition = async (symbol: string, side: 'Buy' | 'Sell') => {
    if (!bybitApi) return;

    setBybitIsLoading(true);
    setBybitTradeMessage(`⏳ Closing position...`);

    try {
      const result = await bybitApi.closePosition(symbol, side);
      setBybitTradeMessage(`✅ Position closed! Order ID: ${result.orderId}`);
      logger.info('Trade Tab', 'Bybit position closed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setBybitTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Bybit close position failed', { error: errorMsg });
    } finally {
      setBybitIsLoading(false);
    }
  };

  const handleBybitCloseAllPositions = async () => {
    if (!bybitApi) return;

    if (!confirm('⚠️ Close ALL Bybit positions? This cannot be undone!')) {
      return;
    }

    setBybitIsLoading(true);
    setBybitTradeMessage('⏳ Closing all positions...');

    try {
      const result = await bybitApi.closeAllPositions();
      setBybitTradeMessage(`✅ ${result.message}`);
      logger.info('Trade Tab', 'All Bybit positions closed', result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setBybitTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Bybit close all positions failed', { error: errorMsg });
    } finally {
      setBybitIsLoading(false);
    }
  };

  // Login screen
  if (!authState.isAuthenticated) {
    return (
      <section className="tab-content trade-tab">
        <h2>⚡ Trade Execution</h2>

        <div className="auth-container" style={{
          maxWidth: '400px',
          margin: '50px auto',
          padding: '30px',
          border: '2px solid #ffc107',
          borderRadius: '8px',
          backgroundColor: '#fff3cd'
        }}>
          <h3 style={{ textAlign: 'center', marginBottom: '20px' }}>
            🔒 Authentication Required
          </h3>

          <p style={{ textAlign: 'center', color: '#856404', marginBottom: '20px' }}>
            Trading features are protected. Enter password to continue.
          </p>

          <div style={{ marginBottom: '15px' }}>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter password"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
              autoFocus
            />
          </div>

          {errorMessage && (
            <div style={{
              padding: '10px',
              marginBottom: '15px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '4px',
              textAlign: 'center'
            }}>
              {errorMessage}
            </div>
          )}

          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              backgroundColor: '#ffc107',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Unlock Trade Tab
          </button>

          <div style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#d1ecf1',
            border: '1px solid #bee5eb',
            borderRadius: '4px',
            fontSize: '14px',
            color: '#0c5460'
          }}>
            <strong>ℹ️ Security Notice:</strong>
            <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
              <li>Session expires after 1 hour of inactivity</li>
              <li>Password: <code>KAS2025Arb</code></li>
              <li>Trading involves real/demo funds - use carefully</li>
            </ul>
          </div>
        </div>
      </section>
    );
  }

  // Authenticated - MT5-style Trade Settings UI
  return (
    <section className="tab-content trade-tab">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Kaspa Trade Settings</h2>
          <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#888' }}>build 2025.10.12</p>
        </div>
        <button onClick={handleLogout} className="btn btn-danger">
          Logout
        </button>
      </div>

      {/* Settings Panel - MT5 Style */}
      <div style={{
        border: '1px solid #ccc',
        borderRadius: '4px',
        padding: '20px',
        backgroundColor: '#f9f9f9',
        fontFamily: 'Arial, sans-serif'
      }}>
        {/* Input Fields Section */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 80px auto', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>発注量:</label>
            <input type="number" defaultValue="100" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>KAS</span>
            <button style={{ padding: '4px 12px', border: '1px solid #999', background: '#eee', cursor: 'pointer' }}>計算</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>最大ポジション:</label>
            <input type="number" defaultValue="500" style={{ padding: '4px', border: '1px solid #ccc' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>最小スプレッド:</label>
            <input type="number" defaultValue="0.2" step="0.1" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>%</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>取引所A:</label>
            <select
              value={exchangeA}
              onChange={(e) => setExchangeA(e.target.value)}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            >
              <option>Binance</option>
              <option>MEXC</option>
              <option>Bybit</option>
              <option>Gate.io</option>
              <option>Kucoin</option>
              <option>BingX</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>取引所B:</label>
            <select
              value={exchangeB}
              onChange={(e) => setExchangeB(e.target.value)}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            >
              <option>Binance</option>
              <option>MEXC</option>
              <option>Bybit</option>
              <option>Gate.io</option>
              <option>Kucoin</option>
              <option>BingX</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>実行間隔:</label>
            <input type="number" defaultValue="5" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>秒</span>
          </div>
        </div>

        {/* Checkboxes Section - 2x4 Grid */}
        <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>リアルタイム監視</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>音声通知</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>手数料を含む</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>自動リバランス</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>自動実行</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>確認ダイアログ</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>履歴記録</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>実行後ログアウト</span>
          </label>
        </div>

        {/* Comparison Settings */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>注文タイプ:</label>
            <select style={{ padding: '4px', border: '1px solid #ccc' }}>
              <option>Market</option>
              <option>Limit</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 60px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>タイムアウト:</label>
            <select style={{ padding: '4px', border: '1px solid #ccc' }}>
              <option>1000</option>
              <option>3000</option>
              <option selected>5000</option>
              <option>10000</option>
            </select>
            <span>ms</span>
          </div>
        </div>

        {/* Execution Conditions - MT5 SL Style */}
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '15px', marginTop: '15px' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              SL A買いB売り利用制時:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: '10px', fontSize: '13px' }}>
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% IN</span>
              <input type="number" defaultValue="0" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% OUT</span>
              <input
                type="text"
                value={gapABuyBSell}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  backgroundColor: '#f0f0f0',
                  color: parseFloat(gapABuyBSell) < 0 ? '#dc3545' : parseFloat(gapABuyBSell) > 0 ? '#28a745' : '#666',
                  fontWeight: '600'
                }}
              />
              <span style={{ fontSize: '11px', color: '#666' }}>Gap</span>
              <input type="number" defaultValue="0" style={{ width: '40px', padding: '4px', border: '1px solid #ccc' }} />
              <select style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}>
                <option>300</option>
                <option>600</option>
                <option selected>900</option>
              </select>
              <span style={{ fontSize: '11px', background: '#e9ecef', padding: '4px 8px', border: '1px solid #ccc' }}>S左M両</span>
              <button style={{ padding: '4px 8px', border: '1px solid #999', background: '#d4edda', cursor: 'pointer', fontSize: '11px' }}>自動</button>
            </div>
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              SL B買いA売り利用制時:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: '10px', fontSize: '13px' }}>
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% IN</span>
              <input type="number" defaultValue="0" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% OUT</span>
              <input
                type="text"
                value={gapBBuyASell}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  backgroundColor: '#f0f0f0',
                  color: parseFloat(gapBBuyASell) < 0 ? '#dc3545' : parseFloat(gapBBuyASell) > 0 ? '#28a745' : '#666',
                  fontWeight: '600'
                }}
              />
              <span style={{ fontSize: '11px', color: '#666' }}>Gap</span>
              <input type="number" defaultValue="0" style={{ width: '40px', padding: '4px', border: '1px solid #ccc' }} />
              <select style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}>
                <option>300</option>
                <option>600</option>
                <option selected>900</option>
              </select>
              <span style={{ fontSize: '11px', background: '#e9ecef', padding: '4px 8px', border: '1px solid #ccc' }}>M右S両</span>
              <button style={{ padding: '4px 8px', border: '1px solid #999', background: '#d4edda', cursor: 'pointer', fontSize: '11px' }}>自動</button>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Trading Section */}
      <div style={{
        marginTop: '30px',
        border: '2px solid #007bff',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#007bff' }}>
          📊 Manual Trading - BingX KAS-USDT
        </h3>

        {/* API Status */}
        {!bingxApi && (
          <div style={{
            padding: '12px',
            marginBottom: '15px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            color: '#856404'
          }}>
            ⚠️ BingX API not configured. Go to <strong>API Tab</strong> and set up your API keys first.
          </div>
        )}

        {/* Trade Message */}
        {tradeMessage && (
          <div style={{
            padding: '12px',
            marginBottom: '15px',
            backgroundColor: tradeMessage.includes('✅') ? '#d4edda' : tradeMessage.includes('❌') ? '#f8d7da' : '#d1ecf1',
            border: `1px solid ${tradeMessage.includes('✅') ? '#c3e6cb' : tradeMessage.includes('❌') ? '#f5c6cb' : '#bee5eb'}`,
            borderRadius: '4px',
            color: tradeMessage.includes('✅') ? '#155724' : tradeMessage.includes('❌') ? '#721c24' : '#0c5460'
          }}>
            {tradeMessage}
          </div>
        )}

        {/* Order Entry */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '15px',
          marginBottom: '20px'
        }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Quantity (KAS):
            </label>
            <input
              type="number"
              value={tradeQuantity}
              onChange={(e) => setTradeQuantity(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '16px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
              disabled={isLoading || !bingxApi}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Current Price:
            </label>
            <div style={{
              padding: '10px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: '#e9ecef',
              border: '1px solid #ccc',
              borderRadius: '4px',
              color: '#28a745'
            }}>
              ${props.bingxData?.price?.toFixed(5) || '--'}
            </div>
          </div>
        </div>

        {/* Trade Buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '15px',
          marginBottom: '20px'
        }}>
          <button
            onClick={handleMarketBuy}
            disabled={isLoading || !bingxApi}
            style={{
              padding: '15px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: isLoading || !bingxApi ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading || !bingxApi ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {isLoading ? '⏳ Loading...' : '🟢 Market BUY (Long)'}
          </button>

          <button
            onClick={handleMarketSell}
            disabled={isLoading || !bingxApi}
            style={{
              padding: '15px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: isLoading || !bingxApi ? '#6c757d' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading || !bingxApi ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {isLoading ? '⏳ Loading...' : '🔴 Market SELL (Short)'}
          </button>
        </div>

        {/* Positions Section */}
        <div style={{
          borderTop: '2px solid #dee2e6',
          paddingTop: '20px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <h4 style={{ margin: 0 }}>Open Positions ({positions.length})</h4>
            {positions.length > 0 && (
              <button
                onClick={handleCloseAllPositions}
                disabled={isLoading}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  backgroundColor: isLoading ? '#6c757d' : '#ffc107',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isLoading ? 'not-allowed' : 'pointer'
                }}
              >
                ⚠️ Close All Positions
              </button>
            )}
          </div>

          {positions.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              backgroundColor: '#e9ecef',
              borderRadius: '4px',
              color: '#6c757d'
            }}>
              No open positions
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gap: '10px'
            }}>
              {positions.map((position: any, index: number) => {
                const amt = parseFloat(position.positionAmt || position.availableAmt || '0');
                const positionSide = amt > 0 ? 'LONG' : 'SHORT';
                const unrealizedProfit = parseFloat(position.unrealisedProfit || position.unRealizedProfit || '0');

                return (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 80px 120px 120px 1fr auto',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '12px',
                      backgroundColor: 'white',
                      border: `2px solid ${positionSide === 'LONG' ? '#28a745' : '#dc3545'}`,
                      borderRadius: '4px'
                    }}
                  >
                    <div>
                      <strong>{position.symbol}</strong>
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      color: positionSide === 'LONG' ? '#28a745' : '#dc3545'
                    }}>
                      {positionSide}
                    </div>
                    <div>
                      Qty: {Math.abs(amt).toFixed(2)}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      color: unrealizedProfit >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      PnL: {unrealizedProfit >= 0 ? '+' : ''}{unrealizedProfit.toFixed(2)} USDT
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Entry: ${parseFloat(position.avgPrice || position.entryPrice || '0').toFixed(5)}
                    </div>
                    <button
                      onClick={() => handleClosePosition(position.symbol, positionSide)}
                      disabled={isLoading}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        backgroundColor: isLoading ? '#6c757d' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isLoading ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Close
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Risk Warning */}
        <div style={{
          marginTop: '15px',
          padding: '12px',
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          fontSize: '13px',
          color: '#721c24'
        }}>
          <strong>⚠️ Risk Warning:</strong> Trading perpetual futures involves significant risk.
          You may lose your entire investment. BingX does not offer testnet - this is REAL trading.
          Start with small amounts to test functionality.
        </div>
      </div>

      {/* Bybit Manual Trading Section */}
      <div style={{
        marginTop: '30px',
        border: '2px solid #6f42c1',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#6f42c1' }}>
          📊 Manual Trading - Bybit KASUSDT
        </h3>

        {/* API Status */}
        {!bybitApi && (
          <div style={{
            padding: '12px',
            marginBottom: '15px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '4px',
            color: '#856404'
          }}>
            ⚠️ Bybit API not configured. Go to <strong>API Tab</strong> and set up your API keys first.
          </div>
        )}

        {/* Trade Message */}
        {bybitTradeMessage && (
          <div style={{
            padding: '12px',
            marginBottom: '15px',
            backgroundColor: bybitTradeMessage.includes('✅') ? '#d4edda' : bybitTradeMessage.includes('❌') ? '#f8d7da' : '#d1ecf1',
            border: `1px solid ${bybitTradeMessage.includes('✅') ? '#c3e6cb' : bybitTradeMessage.includes('❌') ? '#f5c6cb' : '#bee5eb'}`,
            borderRadius: '4px',
            color: bybitTradeMessage.includes('✅') ? '#155724' : bybitTradeMessage.includes('❌') ? '#721c24' : '#0c5460',
            whiteSpace: 'pre-wrap'
          }}>
            {bybitTradeMessage}
          </div>
        )}

        {/* Order Entry */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '15px',
          marginBottom: '20px'
        }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Quantity (KAS):
            </label>
            <input
              type="number"
              value={bybitTradeQuantity}
              onChange={(e) => setBybitTradeQuantity(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '16px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
              disabled={bybitIsLoading || !bybitApi}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              Current Price:
            </label>
            <div style={{
              padding: '10px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: '#e9ecef',
              border: '1px solid #ccc',
              borderRadius: '4px',
              color: '#28a745'
            }}>
              ${props.bybitData?.price?.toFixed(5) || '--'}
            </div>
          </div>
        </div>

        {/* Trade Buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '15px',
          marginBottom: '20px'
        }}>
          <button
            onClick={handleBybitMarketBuy}
            disabled={bybitIsLoading || !bybitApi}
            style={{
              padding: '15px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: bybitIsLoading || !bybitApi ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: bybitIsLoading || !bybitApi ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {bybitIsLoading ? '⏳ Loading...' : '🟢 Market BUY (Long)'}
          </button>

          <button
            onClick={handleBybitMarketSell}
            disabled={bybitIsLoading || !bybitApi}
            style={{
              padding: '15px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: bybitIsLoading || !bybitApi ? '#6c757d' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: bybitIsLoading || !bybitApi ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {bybitIsLoading ? '⏳ Loading...' : '🔴 Market SELL (Short)'}
          </button>
        </div>

        {/* Positions Section */}
        <div style={{
          borderTop: '2px solid #dee2e6',
          paddingTop: '20px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '15px'
          }}>
            <h4 style={{ margin: 0 }}>Open Positions ({bybitPositions.length})</h4>
            {bybitPositions.length > 0 && (
              <button
                onClick={handleBybitCloseAllPositions}
                disabled={bybitIsLoading}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  backgroundColor: bybitIsLoading ? '#6c757d' : '#ffc107',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: bybitIsLoading ? 'not-allowed' : 'pointer'
                }}
              >
                ⚠️ Close All Positions
              </button>
            )}
          </div>

          {bybitPositions.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              backgroundColor: '#e9ecef',
              borderRadius: '4px',
              color: '#6c757d'
            }}>
              No open positions
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gap: '10px'
            }}>
              {bybitPositions.map((position: any, index: number) => {
                const size = parseFloat(position.size || '0');
                const positionSide = position.side; // 'Buy' or 'Sell'
                const unrealizedProfit = parseFloat(position.unrealisedPnl || '0');

                return (
                  <div
                    key={index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '100px 80px 120px 120px 1fr auto',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '12px',
                      backgroundColor: 'white',
                      border: `2px solid ${positionSide === 'Buy' ? '#28a745' : '#dc3545'}`,
                      borderRadius: '4px'
                    }}
                  >
                    <div>
                      <strong>{position.symbol}</strong>
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      color: positionSide === 'Buy' ? '#28a745' : '#dc3545'
                    }}>
                      {positionSide === 'Buy' ? 'LONG' : 'SHORT'}
                    </div>
                    <div>
                      Qty: {size.toFixed(2)}
                    </div>
                    <div style={{
                      fontWeight: 'bold',
                      color: unrealizedProfit >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      PnL: {unrealizedProfit >= 0 ? '+' : ''}{unrealizedProfit.toFixed(2)} USDT
                    </div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      Entry: ${parseFloat(position.avgPrice || '0').toFixed(5)}
                    </div>
                    <button
                      onClick={() => handleBybitClosePosition(position.symbol, position.side)}
                      disabled={bybitIsLoading}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        backgroundColor: bybitIsLoading ? '#6c757d' : '#6f42c1',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: bybitIsLoading ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Close
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Risk Warning */}
        <div style={{
          marginTop: '15px',
          padding: '12px',
          backgroundColor: '#d1ecf1',
          border: '1px solid #bee5eb',
          borderRadius: '4px',
          fontSize: '13px',
          color: '#0c5460'
        }}>
          <strong>ℹ️ Demo Trading Notice:</strong> This is Bybit Demo Trading with virtual funds (50,000 USDT).
          Perfect for testing strategies without real money risk. Demo data may differ from production.
        </div>
      </div>

      {/* Session Info */}
      <p style={{ marginTop: '15px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
        Session active. Auto-logout in {Math.round((SESSION_TIMEOUT - (Date.now() - authState.lastAuthTime!)) / 60000)} minutes.
      </p>
    </section>
  );
}
