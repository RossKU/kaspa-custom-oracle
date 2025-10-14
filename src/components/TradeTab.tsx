import { useState, useEffect, useRef } from 'react';
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
import { calculateEffectivePrices } from '../utils/orderbook';

interface TradeTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
}

// Polling mode for adaptive API request management
type PollingMode = 'IDLE' | 'MONITORING' | 'TRADING';

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

  // Trigger duration state (for GAP continuous threshold)
  const [triggerDurationAType, setTriggerDurationAType] = useState<'300' | '600' | '900' | 'custom'>('900');
  const [triggerDurationACustom, setTriggerDurationACustom] = useState('900');
  const [triggerDurationBType, setTriggerDurationBType] = useState<'300' | '600' | '900' | 'custom'>('900');
  const [triggerDurationBCustom, setTriggerDurationBCustom] = useState('900');

  // Slippage offset state (difference between WebSocket Best price and Order Book Effective price)
  const [bybitSlippageOffset, setBybitSlippageOffset] = useState({
    bidOffset: 0,  // Negative = slippage reduces bid price
    askOffset: 0   // Positive = slippage increases ask price
  });
  const [bingxSlippageOffset, setBingxSlippageOffset] = useState({
    bidOffset: 0,
    askOffset: 0
  });

  // Auto-trading trigger conditions
  const [triggerA, setTriggerA] = useState({
    inThreshold: 0.2,      // IN threshold (%) - entry or exit condition
    outThreshold: 0.2,     // OUT threshold (%) - currently unused
    duration: 900,         // Continuous time (ms)
    enabled: false         // Auto-execution ON/OFF
  });

  const [triggerB, setTriggerB] = useState({
    inThreshold: 0.2,
    outThreshold: 0.2,
    duration: 900,
    enabled: false
  });

  // Monitor status for trigger detection
  const [monitorStatusA, setMonitorStatusA] = useState({
    startTime: null as number | null,
    isMonitoring: false
  });

  const [monitorStatusB, setMonitorStatusB] = useState({
    startTime: null as number | null,
    isMonitoring: false
  });

  // Timer refs for immediate start time tracking (prevents restart issues from async setState)
  const timerRefA = useRef<number | null>(null);
  const timerRefB = useRef<number | null>(null);

  // Debug logs state for in-tab monitoring
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Polling mode state for adaptive CORS proxy load management
  // IDLE: Position polling only (startup)
  // MONITORING: Order book polling only (Gap calculation)
  // TRADING: Position polling only (after trade execution)
  const [pollingMode, setPollingMode] = useState<PollingMode>('IDLE');

  // Get Bid/Ask prices from exchange name
  // For Bybit and BingX: adds slippage offset calculated from Order Book depth
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
        // Add slippage offset from Order Book depth analysis
        return {
          bid: (props.bybitData.bid || 0) + bybitSlippageOffset.bidOffset,
          ask: (props.bybitData.ask || 0) + bybitSlippageOffset.askOffset
        };
      case 'Gate.io':
        if (!props.gateioData) return null;
        return { bid: props.gateioData.price || 0, ask: props.gateioData.price || 0 };
      case 'Kucoin':
        if (!props.kucoinData) return null;
        return { bid: props.kucoinData.price || 0, ask: props.kucoinData.price || 0 };
      case 'BingX':
        if (!props.bingxData) return null;
        // Add slippage offset from Order Book depth analysis
        return {
          bid: (props.bingxData.bid || 0) + bingxSlippageOffset.bidOffset,
          ask: (props.bingxData.ask || 0) + bingxSlippageOffset.askOffset
        };
      default:
        return null;
    }
  };

  // Position state detection for auto-trading
  type PositionState = 'NONE' | 'A_POSITION' | 'B_POSITION';

  const getPositionState = (): PositionState => {
    // Check BingX positions
    const bingxPos = positions.find((p: any) => p.symbol === 'KAS-USDT');
    const bingxAmt = parseFloat(bingxPos?.positionAmt || bingxPos?.availableAmt || '0');

    // Check Bybit positions
    const bybitPos = bybitPositions.find((p: any) => p.symbol === 'KASUSDT');

    // Determine position state
    // A_POSITION = Bybit LONG or BingX SHORT
    if (bybitPos?.side === 'Buy' || bingxAmt < 0) {
      return 'A_POSITION';
    }

    // B_POSITION = Bybit SHORT or BingX LONG
    if (bybitPos?.side === 'Sell' || bingxAmt > 0) {
      return 'B_POSITION';
    }

    return 'NONE';
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

  // Get current position state (for auto-trading)
  const positionState = getPositionState();

  // Sync trigger duration A with UI selection
  useEffect(() => {
    const newDuration = triggerDurationAType === 'custom'
      ? parseInt(triggerDurationACustom) || 900
      : parseInt(triggerDurationAType);

    setTriggerA(prev => ({ ...prev, duration: newDuration }));
  }, [triggerDurationAType, triggerDurationACustom]);

  // Sync trigger duration B with UI selection
  useEffect(() => {
    const newDuration = triggerDurationBType === 'custom'
      ? parseInt(triggerDurationBCustom) || 900
      : parseInt(triggerDurationBType);

    setTriggerB(prev => ({ ...prev, duration: newDuration }));
  }, [triggerDurationBType, triggerDurationBCustom]);

  // Log position state changes (debug only)
  useEffect(() => {
    if (authState.isAuthenticated) {
      logger.debug('Trade Tab', 'Position state updated', { positionState });
    }
  }, [positionState, authState.isAuthenticated]);

  // Log trigger state changes (debug only)
  useEffect(() => {
    if (authState.isAuthenticated) {
      logger.debug('Trade Tab', 'Trigger state updated', {
        triggerA,
        triggerB,
        monitorStatusA,
        monitorStatusB
      });
    }
  }, [triggerA, triggerB, monitorStatusA, monitorStatusB, authState.isAuthenticated]);

  // Adaptive polling mode management (CORS proxy load reduction)
  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const isMonitoring = monitorStatusA.isMonitoring || monitorStatusB.isMonitoring;

    if (isMonitoring && pollingMode !== 'MONITORING') {
      setPollingMode('MONITORING');
      logger.info('Trade Tab', 'Polling mode: MONITORING (Order book polling only)');
    } else if (!isMonitoring && pollingMode === 'MONITORING') {
      setPollingMode('IDLE');
      logger.info('Trade Tab', 'Polling mode: IDLE (Position polling only)');
    }
  }, [monitorStatusA.isMonitoring, monitorStatusB.isMonitoring, pollingMode, authState.isAuthenticated]);

  // Phase 4: 100ms monitoring logic for auto-trading
  useEffect(() => {
    if (!authState.isAuthenticated) return;
    if (!monitorStatusA.isMonitoring && !monitorStatusB.isMonitoring) return;

    logger.info('Trade Tab', '100ms monitoring started');

    const monitorInterval = setInterval(() => {
      const gapA = parseFloat(gapABuyBSell);
      const gapB = parseFloat(gapBBuyASell);
      const posState = getPositionState();
      const now = Date.now();

      // A direction monitoring (A買いB売り)
      if (monitorStatusA.isMonitoring && posState !== 'A_POSITION') {
        logger.debug('Trade Tab', 'Monitor A tick', {
          gapA,
          threshold: triggerA.inThreshold,
          positionState: posState,
          startTime: timerRefA.current,
          isAboveThreshold: gapA >= triggerA.inThreshold
        });

        if (gapA >= triggerA.inThreshold) {
          // Above threshold - start or continue monitoring
          if (timerRefA.current === null) {
            timerRefA.current = now;
            logger.info('Trade Tab', 'Monitor A: Gap above threshold, starting timer', {
              gapA,
              threshold: triggerA.inThreshold
            });
            setMonitorStatusA({ startTime: now, isMonitoring: true });
          } else {
            const elapsed = now - timerRefA.current;
            logger.debug('Trade Tab', 'Monitor A: Tracking duration', {
              elapsed,
              required: triggerA.duration,
              gapA
            });

            if (elapsed >= triggerA.duration) {
              logger.info('Trade Tab', 'Monitor A: Threshold held for required duration!', {
                elapsed,
                duration: triggerA.duration,
                gapA,
                autoEnabled: triggerA.enabled
              });

              if (triggerA.enabled) {
                logger.info('Trade Tab', 'Monitor A: AUTO-EXECUTION triggered', {
                  gapA,
                  duration: elapsed
                });
                timerRefA.current = null;
                setMonitorStatusA({ startTime: null, isMonitoring: false });
                handleManualTradeA();
              } else {
                logger.info('Trade Tab', 'Monitor A: Manual confirmation required', {
                  gapA,
                  duration: elapsed
                });
                timerRefA.current = null;
                setMonitorStatusA({ startTime: null, isMonitoring: false });
              }
            }
          }
        } else {
          // Below threshold - reset timer
          if (timerRefA.current !== null) {
            logger.info('Trade Tab', 'Monitor A: Gap dropped below threshold, resetting timer', {
              gapA,
              threshold: triggerA.inThreshold
            });
            timerRefA.current = null;
            setMonitorStatusA({ startTime: null, isMonitoring: true });
          }
        }
      }

      // B direction monitoring (B買いA売り)
      if (monitorStatusB.isMonitoring && posState !== 'B_POSITION') {
        logger.debug('Trade Tab', 'Monitor B tick', {
          gapB,
          threshold: triggerB.inThreshold,
          positionState: posState,
          startTime: timerRefB.current,
          isAboveThreshold: gapB >= triggerB.inThreshold
        });

        if (gapB >= triggerB.inThreshold) {
          if (timerRefB.current === null) {
            timerRefB.current = now;
            logger.info('Trade Tab', 'Monitor B: Gap above threshold, starting timer', {
              gapB,
              threshold: triggerB.inThreshold
            });
            setMonitorStatusB({ startTime: now, isMonitoring: true });
          } else {
            const elapsed = now - timerRefB.current;
            logger.debug('Trade Tab', 'Monitor B: Tracking duration', {
              elapsed,
              required: triggerB.duration,
              gapB
            });

            if (elapsed >= triggerB.duration) {
              logger.info('Trade Tab', 'Monitor B: Threshold held for required duration!', {
                elapsed,
                duration: triggerB.duration,
                gapB,
                autoEnabled: triggerB.enabled
              });

              if (triggerB.enabled) {
                logger.info('Trade Tab', 'Monitor B: AUTO-EXECUTION triggered', {
                  gapB,
                  duration: elapsed
                });
                timerRefB.current = null;
                setMonitorStatusB({ startTime: null, isMonitoring: false });
                handleManualTradeB();
              } else {
                logger.info('Trade Tab', 'Monitor B: Manual confirmation required', {
                  gapB,
                  duration: elapsed
                });
                timerRefB.current = null;
                setMonitorStatusB({ startTime: null, isMonitoring: false });
              }
            }
          }
        } else {
          if (timerRefB.current !== null) {
            logger.info('Trade Tab', 'Monitor B: Gap dropped below threshold, resetting timer', {
              gapB,
              threshold: triggerB.inThreshold
            });
            timerRefB.current = null;
            setMonitorStatusB({ startTime: null, isMonitoring: true });
          }
        }
      }
    }, 100); // 100ms polling

    return () => {
      logger.info('Trade Tab', '100ms monitoring stopped');
      clearInterval(monitorInterval);
    };
  }, [
    authState.isAuthenticated,
    monitorStatusA.isMonitoring,
    monitorStatusB.isMonitoring,
    gapABuyBSell,
    gapBBuyASell,
    triggerA,
    triggerB,
    positionState
  ]);

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
  // Only runs in IDLE and TRADING modes (adaptive polling)
  useEffect(() => {
    if (!bingxApi || !authState.isAuthenticated) {
      logger.info('Trade Tab', 'Position fetcher not starting', {
        hasBingxApi: !!bingxApi,
        isAuthenticated: authState.isAuthenticated
      });
      return;
    }

    // MONITORING mode: Skip position polling (order book polling only)
    if (pollingMode === 'MONITORING') {
      logger.info('Trade Tab', 'Position fetcher paused (MONITORING mode)');
      return;
    }

    const fetchPositions = async () => {
      try {
        const [bingxPositions, bybitPos] = await Promise.all([
          bingxApi.getAllPositions(),
          bybitApi ? bybitApi.getAllPositions() : Promise.resolve([])
        ]);

        // Filter only open positions
        const openBingX = bingxPositions.filter((p: any) => {
          const amt = parseFloat(p.positionAmt || p.availableAmt || '0');
          return amt !== 0;
        });
        const openBybit = bybitPos.filter((p: any) => parseFloat(p.size || '0') > 0);

        logger.info('Trade Tab', '✅ Positions', {
          bingx: openBingX.length,
          bybit: openBybit.length
        });

        setPositions(openBingX);
        setBybitPositions(openBybit);
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
  }, [bingxApi, bybitApi, authState.isAuthenticated, pollingMode]);

  // Fetch Order Book depth and calculate slippage offset (every 5 seconds)
  // This calculates the difference between WebSocket Best Bid/Ask and Order Book Effective prices
  // Only runs in MONITORING mode (adaptive polling)
  useEffect(() => {
    if (!bybitApi || !bingxApi || !authState.isAuthenticated) {
      return;
    }

    // IDLE/TRADING modes: Skip order book polling (position polling only)
    if (pollingMode !== 'MONITORING') {
      logger.info('Trade Tab', 'Order book fetcher paused (not in MONITORING mode)');
      return;
    }

    const fetchOrderBooksAndCalculateOffset = async () => {
      try {
        const quantity = parseFloat(tradeQuantity);
        if (isNaN(quantity) || quantity <= 0) return;

        // Fetch Order Books from both exchanges (in parallel)
        const [bybitOrderBook, bingxOrderBook] = await Promise.all([
          bybitApi.getOrderBook('KASUSDT', 50),
          bingxApi.getOrderBook('KAS-USDT', 50)
        ]);

        // Calculate effective prices based on order quantity (worst-case)
        const bybitEffective = calculateEffectivePrices(bybitOrderBook, quantity, true);
        const bingxEffective = calculateEffectivePrices(bingxOrderBook, quantity, true);

        // Calculate offsets using Order Book's own Best Bid/Ask (same timestamp)
        const bybitBidOffset = (bybitEffective.effectiveBid || 0) - (bybitEffective.bestBid || 0);
        const bybitAskOffset = (bybitEffective.effectiveAsk || 0) - (bybitEffective.bestAsk || 0);
        const bingxBidOffset = (bingxEffective.effectiveBid || 0) - (bingxEffective.bestBid || 0);
        const bingxAskOffset = (bingxEffective.effectiveAsk || 0) - (bingxEffective.bestAsk || 0);

        logger.info('Trade Tab', '✅ Slippage', {
          bybit: { bid: bybitBidOffset.toFixed(5), ask: bybitAskOffset.toFixed(5) },
          bingx: { bid: bingxBidOffset.toFixed(5), ask: bingxAskOffset.toFixed(5) }
        });

        // Update state
        setBybitSlippageOffset({
          bidOffset: bybitBidOffset,
          askOffset: bybitAskOffset
        });
        setBingxSlippageOffset({
          bidOffset: bingxBidOffset,
          askOffset: bingxAskOffset
        });
      } catch (error) {
        logger.error('Trade Tab', 'Failed to fetch order books', {
          error: error instanceof Error ? error.message : String(error)
        });
        // On error, reset offsets to 0 (fall back to WebSocket Best prices)
        setBybitSlippageOffset({ bidOffset: 0, askOffset: 0 });
        setBingxSlippageOffset({ bidOffset: 0, askOffset: 0 });
      }
    };

    // Initial fetch
    fetchOrderBooksAndCalculateOffset();

    // Poll every 5 seconds
    const interval = setInterval(fetchOrderBooksAndCalculateOffset, 5000);

    return () => clearInterval(interval);
  }, [bybitApi, bingxApi, authState.isAuthenticated, tradeQuantity, pollingMode]);

  // Subscribe to debug logs for in-tab monitoring
  useEffect(() => {
    const unsubscribe = logger.subscribe((logs) => {
      const formatted = logs.slice(-50).map(log => {
        const dataStr = log.data ? ` | ${JSON.stringify(log.data)}` : '';
        return `[${log.timestamp.split('T')[1].split('.')[0]}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${dataStr}`;
      });
      setDebugLogs(formatted);
    });

    return () => unsubscribe();
  }, []);

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

  // Manual arbitrage trade handlers
  const handleManualTradeA = async () => {
    // Trade A: "B売 A買" (BingX Sell + Bybit Buy)
    // When NONE or A_POSITION: Open/Increase A_POSITION (Bybit LONG + BingX SHORT)
    // When B_POSITION: Close B_POSITION (reverse direction)
    if (!bingxApi || !bybitApi) {
      setTradeMessage('❌ Both APIs must be configured. Check API tab.');
      return;
    }

    setIsLoading(true);
    setPollingMode('TRADING');
    logger.info('Trade Tab', 'Polling mode: TRADING (Position polling only)');

    try {
      const currentPositionState = getPositionState();
      let actionType: string;
      let bingxResult: any;
      let bybitResult: any;

      if (currentPositionState === 'B_POSITION') {
        // Close B_POSITION: Use closePosition() API
        // B_POSITION = Bybit SHORT + BingX LONG
        actionType = 'Closing B_POSITION';
        setTradeMessage('⏳ Closing B_POSITION (using closePosition API)...');

        logger.info('Trade Tab', 'Manual Trade A: Closing B_POSITION', {
          currentPositionState,
          actionType,
          bingx: { symbol: 'KAS-USDT', positionSide: 'LONG', qty: tradeQuantity },
          bybit: { symbol: 'KASUSDT', side: 'Sell', qty: tradeQuantity }
        });

        [bingxResult, bybitResult] = await Promise.all([
          bingxApi.closePosition('KAS-USDT', 'LONG', tradeQuantity),
          bybitApi.closePosition('KASUSDT', 'Sell', tradeQuantity)
        ]);
      } else {
        // Open/Increase A_POSITION: Use placeOrder() API
        // A_POSITION = Bybit LONG + BingX SHORT
        actionType = currentPositionState === 'A_POSITION' ? 'Increasing A_POSITION' : 'Opening A_POSITION';
        setTradeMessage('⏳ Executing Trade A (Bybit Buy + BingX Sell)...');

        logger.info('Trade Tab', 'Manual Trade A: B売 A買', {
          currentPositionState,
          actionType,
          bingx: { symbol: 'KAS-USDT', side: 'Sell', qty: tradeQuantity },
          bybit: { symbol: 'KASUSDT', side: 'Buy', qty: tradeQuantity }
        });

        [bingxResult, bybitResult] = await Promise.all([
          bingxApi.placeOrder({
            symbol: 'KAS-USDT',
            side: 'Sell',
            orderType: 'Market',
            qty: tradeQuantity
          }),
          bybitApi.placeOrder({
            symbol: 'KASUSDT',
            side: 'Buy',
            orderType: 'Market',
            qty: tradeQuantity
          })
        ]);
      }

      setTradeMessage(`✅ Trade A executed (${actionType})!\nBingX Order: ${bingxResult.orderId}\nBybit Order: ${bybitResult.orderId}`);
      logger.info('Trade Tab', 'Manual Trade A executed', { actionType, currentPositionState, bingxResult, bybitResult });

      // Return to IDLE mode after 5 seconds (position confirmed)
      setTimeout(() => {
        setPollingMode('IDLE');
        logger.info('Trade Tab', 'Polling mode: IDLE (Position polling only)');
      }, 5000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Manual Trade A failed', { error: errorMsg });
      // Return to IDLE immediately on error
      setPollingMode('IDLE');
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualTradeB = async () => {
    // Trade B: "A売 B買" (Bybit Sell + BingX Buy)
    // When NONE or B_POSITION: Open/Increase B_POSITION (Bybit SHORT + BingX LONG)
    // When A_POSITION: Close A_POSITION (reverse direction)
    if (!bingxApi || !bybitApi) {
      setTradeMessage('❌ Both APIs must be configured. Check API tab.');
      return;
    }

    setIsLoading(true);
    setPollingMode('TRADING');
    logger.info('Trade Tab', 'Polling mode: TRADING (Position polling only)');

    try {
      const currentPositionState = getPositionState();
      let actionType: string;
      let bingxResult: any;
      let bybitResult: any;

      if (currentPositionState === 'A_POSITION') {
        // Close A_POSITION: Use closePosition() API
        // A_POSITION = Bybit LONG + BingX SHORT
        actionType = 'Closing A_POSITION';
        setTradeMessage('⏳ Closing A_POSITION (using closePosition API)...');

        logger.info('Trade Tab', 'Manual Trade B: Closing A_POSITION', {
          currentPositionState,
          actionType,
          bybit: { symbol: 'KASUSDT', side: 'Buy', qty: tradeQuantity },
          bingx: { symbol: 'KAS-USDT', positionSide: 'SHORT', qty: tradeQuantity }
        });

        [bybitResult, bingxResult] = await Promise.all([
          bybitApi.closePosition('KASUSDT', 'Buy', tradeQuantity),
          bingxApi.closePosition('KAS-USDT', 'SHORT', tradeQuantity)
        ]);
      } else {
        // Open/Increase B_POSITION: Use placeOrder() API
        // B_POSITION = Bybit SHORT + BingX LONG
        actionType = currentPositionState === 'B_POSITION' ? 'Increasing B_POSITION' : 'Opening B_POSITION';
        setTradeMessage('⏳ Executing Trade B (Bybit Sell + BingX Buy)...');

        logger.info('Trade Tab', 'Manual Trade B: A売 B買', {
          currentPositionState,
          actionType,
          bybit: { symbol: 'KASUSDT', side: 'Sell', qty: tradeQuantity },
          bingx: { symbol: 'KAS-USDT', side: 'Buy', qty: tradeQuantity }
        });

        [bybitResult, bingxResult] = await Promise.all([
          bybitApi.placeOrder({
            symbol: 'KASUSDT',
            side: 'Sell',
            orderType: 'Market',
            qty: tradeQuantity
          }),
          bingxApi.placeOrder({
            symbol: 'KAS-USDT',
            side: 'Buy',
            orderType: 'Market',
            qty: tradeQuantity
          })
        ]);
      }

      setTradeMessage(`✅ Trade B executed (${actionType})!\nBybit Order: ${bybitResult.orderId}\nBingX Order: ${bingxResult.orderId}`);
      logger.info('Trade Tab', 'Manual Trade B executed', { actionType, currentPositionState, bybitResult, bingxResult });

      // Return to IDLE mode after 5 seconds (position confirmed)
      setTimeout(() => {
        setPollingMode('IDLE');
        logger.info('Trade Tab', 'Polling mode: IDLE (Position polling only)');
      }, 5000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTradeMessage(`❌ Failed: ${errorMsg}`);
      logger.error('Trade Tab', 'Manual Trade B failed', { error: errorMsg });
      // Return to IDLE immediately on error
      setPollingMode('IDLE');
    } finally {
      setIsLoading(false);
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
            <input
              type="number"
              value={tradeQuantity}
              onChange={(e) => setTradeQuantity(e.target.value)}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            />
            <span>KAS</span>
            <button
              onClick={() => {
                const isCurrentlyMonitoring = monitorStatusA.isMonitoring || monitorStatusB.isMonitoring;
                const newTime = isCurrentlyMonitoring ? null : Date.now();
                const newStatus = !isCurrentlyMonitoring;
                // Reset timer refs when toggling monitoring
                timerRefA.current = null;
                timerRefB.current = null;
                setMonitorStatusA({ startTime: newTime, isMonitoring: newStatus });
                setMonitorStatusB({ startTime: newTime, isMonitoring: newStatus });
              }}
              style={{
                padding: '4px 12px',
                border: '1px solid #999',
                background: (monitorStatusA.isMonitoring || monitorStatusB.isMonitoring) ? '#dc3545' : '#eee',
                color: (monitorStatusA.isMonitoring || monitorStatusB.isMonitoring) ? 'white' : '#000',
                cursor: 'pointer'
              }}
            >
              計算
            </button>
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
            <input
              type="checkbox"
              checked={triggerA.enabled && triggerB.enabled}
              onChange={(e) => {
                setTriggerA({ ...triggerA, enabled: e.target.checked });
                setTriggerB({ ...triggerB, enabled: e.target.checked });
              }}
            />
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
              <input
                type="number"
                value={triggerA.inThreshold}
                onChange={(e) => setTriggerA({ ...triggerA, inThreshold: parseFloat(e.target.value) || 0 })}
                step="0.01"
                style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }}
              />
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
              <select
                value={triggerDurationAType}
                onChange={(e) => setTriggerDurationAType(e.target.value as '300' | '600' | '900' | 'custom')}
                style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}
              >
                <option value="300">300</option>
                <option value="600">600</option>
                <option value="900">900</option>
                <option value="custom">Custom</option>
              </select>
              {triggerDurationAType === 'custom' && (
                <input
                  type="number"
                  value={triggerDurationACustom}
                  onChange={(e) => setTriggerDurationACustom(e.target.value)}
                  style={{ width: '60px', padding: '4px', border: '1px solid #ccc' }}
                  placeholder="ms"
                />
              )}
              <button
                onClick={handleManualTradeA}
                disabled={isLoading || !bingxApi || !bybitApi}
                style={{
                  fontSize: '11px',
                  background: (isLoading || !bingxApi || !bybitApi) ? '#e9ecef' : '#28a745',
                  padding: '4px 8px',
                  border: '1px solid #ccc',
                  cursor: (isLoading || !bingxApi || !bybitApi) ? 'not-allowed' : 'pointer',
                  color: (isLoading || !bingxApi || !bybitApi) ? '#666' : 'white'
                }}
              >
                B売 A買
              </button>
              <button style={{
                padding: '4px 8px',
                border: '1px solid #999',
                background: (triggerA.enabled && monitorStatusA.isMonitoring) ? '#dc3545' : '#e9ecef',
                color: (triggerA.enabled && monitorStatusA.isMonitoring) ? 'white' : '#666',
                cursor: 'default',
                fontSize: '11px'
              }}>
                自動
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              SL B買いA売り利用制時:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: '10px', fontSize: '13px' }}>
              <input
                type="number"
                value={triggerB.inThreshold}
                onChange={(e) => setTriggerB({ ...triggerB, inThreshold: parseFloat(e.target.value) || 0 })}
                step="0.01"
                style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }}
              />
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
              <select
                value={triggerDurationBType}
                onChange={(e) => setTriggerDurationBType(e.target.value as '300' | '600' | '900' | 'custom')}
                style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}
              >
                <option value="300">300</option>
                <option value="600">600</option>
                <option value="900">900</option>
                <option value="custom">Custom</option>
              </select>
              {triggerDurationBType === 'custom' && (
                <input
                  type="number"
                  value={triggerDurationBCustom}
                  onChange={(e) => setTriggerDurationBCustom(e.target.value)}
                  style={{ width: '60px', padding: '4px', border: '1px solid #ccc' }}
                  placeholder="ms"
                />
              )}
              <button
                onClick={handleManualTradeB}
                disabled={isLoading || !bingxApi || !bybitApi}
                style={{
                  fontSize: '11px',
                  background: (isLoading || !bingxApi || !bybitApi) ? '#e9ecef' : '#28a745',
                  padding: '4px 8px',
                  border: '1px solid #ccc',
                  cursor: (isLoading || !bingxApi || !bybitApi) ? 'not-allowed' : 'pointer',
                  color: (isLoading || !bingxApi || !bybitApi) ? '#666' : 'white'
                }}
              >
                A売 B買
              </button>
              <button style={{
                padding: '4px 8px',
                border: '1px solid #999',
                background: (triggerB.enabled && monitorStatusB.isMonitoring) ? '#dc3545' : '#e9ecef',
                color: (triggerB.enabled && monitorStatusB.isMonitoring) ? 'white' : '#666',
                cursor: 'default',
                fontSize: '11px'
              }}>
                自動
              </button>
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
            {positions.length > 0 && (
              <div style={{
                marginTop: '8px',
                padding: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '4px',
                color: '#856404'
              }}>
                <div style={{ fontSize: '11px', marginBottom: '4px' }}>Position Entry:</div>
                <div>${parseFloat(positions[0].avgPrice || positions[0].entryPrice || '0').toFixed(5)}</div>
                <div style={{ fontSize: '11px', marginTop: '2px' }}>
                  ({positions[0].positionSide}: {Math.abs(parseFloat(positions[0].positionAmt || positions[0].availableAmt || '0')).toFixed(0)} KAS)
                </div>
              </div>
            )}
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
                const positionSide = position.positionSide; // Use API's positionSide field directly
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
            {bybitPositions.length > 0 && (
              <div style={{
                marginTop: '8px',
                padding: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '4px',
                color: '#856404'
              }}>
                <div style={{ fontSize: '11px', marginBottom: '4px' }}>Position Entry:</div>
                <div>${parseFloat(bybitPositions[0].avgPrice || '0').toFixed(5)}</div>
                <div style={{ fontSize: '11px', marginTop: '2px' }}>
                  ({bybitPositions[0].side === 'Buy' ? 'LONG' : 'SHORT'}: {parseFloat(bybitPositions[0].size || '0').toFixed(0)} KAS)
                </div>
              </div>
            )}
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

      {/* Debug Logs Section */}
      <div style={{
        marginTop: '30px',
        border: '2px solid #6c757d',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '15px'
        }}>
          <h3 style={{ margin: 0, color: '#6c757d' }}>
            🐛 Debug Logs ({debugLogs.length})
          </h3>
          <button
            onClick={() => logger.downloadLogs()}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 'bold',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            📥 Download Logs
          </button>
        </div>
        <div style={{
          height: '300px',
          overflow: 'auto',
          border: '1px solid #ccc',
          borderRadius: '4px',
          padding: '10px',
          backgroundColor: '#f5f5f5',
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: '1.5'
        }}>
          {debugLogs.length === 0 ? (
            <div style={{ color: '#999', textAlign: 'center', paddingTop: '130px' }}>
              No logs yet...
            </div>
          ) : (
            debugLogs.map((log, idx) => (
              <div
                key={idx}
                style={{
                  padding: '2px 0',
                  borderBottom: idx < debugLogs.length - 1 ? '1px solid #eee' : 'none',
                  color: log.includes('[ERROR]') ? '#dc3545' : log.includes('[WARN]') ? '#ffc107' : log.includes('[DEBUG]') ? '#6c757d' : '#000'
                }}
              >
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
