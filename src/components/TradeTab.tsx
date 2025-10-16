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
import { KeepAwake } from '../utils/keepAwake';

interface TradeTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
  onMonitoringChange?: (isMonitoring: boolean, exchangeA: string, exchangeB: string) => void;
}

// Polling mode for adaptive API request management
type PollingMode = 'IDLE' | 'MONITORING' | 'TRADING';

// Gap history for offset correction (30-minute moving average)
type GapHistory = {
  timestamp: number;
  gapA: number;
  gapB: number;
  offset: number;  // (gapA - gapB) / 2
};

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
  const [maxPosition, setMaxPosition] = useState('500'); // Maximum position limit
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
    inThreshold: 0.2,      // IN threshold (%) - for opening positions
    outThreshold: 0.2,     // OUT threshold (%) - for closing positions
    duration: 900,         // Continuous time (ms)
    enabled: false         // Auto-execution ON/OFF
  });

  const [triggerB, setTriggerB] = useState({
    inThreshold: 0.2,      // IN threshold (%) - for opening positions
    outThreshold: 0.2,     // OUT threshold (%) - for closing positions
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

  // Trading mutex and cooldown (prevents race conditions and rapid re-execution)
  const [isTrading, setIsTrading] = useState(false);
  const lastTradeTimeRef = useRef<number>(0);
  const [cooldownPeriod, setCooldownPeriod] = useState(30); // Default: 30 seconds (configurable)

  // Position imbalance detection (liquidation risk)
  // Counter for consecutive detections of one-sided positions (片建て状態)
  const imbalanceCounterRef = useRef<number>(0);

  // Liquidation timeout configuration (ms)
  const [liquidationTimeout, setLiquidationTimeout] = useState(10000); // Default: 10 seconds
  const imbalanceDetectedTimeRef = useRef<number | null>(null);

  // Gap offset correction (30-minute moving average)
  const [gapHistory, setGapHistory] = useState<GapHistory[]>([]);
  const [offsetMovingAvg, setOffsetMovingAvg] = useState<number>(0);
  const [useOffsetCorrection, setUseOffsetCorrection] = useState(true); // Default: ON
  const lastSampleTimeRef = useRef<number>(0);
  const HISTORY_WINDOW = 30 * 60 * 1000; // 30 minutes (milliseconds)
  const HISTORY_SAMPLE_INTERVAL = 3000;   // 3 second sampling (reduced load)

  // Position fetch completion flag (prevents race condition on browser reload)
  const [positionsFetched, setPositionsFetched] = useState(false);

  // Debug logs state for in-tab monitoring
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Polling mode state for adaptive CORS proxy load management
  // IDLE: Position polling only (startup)
  // MONITORING: Order book polling only (Gap calculation)
  // TRADING: Position polling only (after trade execution)
  const [pollingMode, setPollingMode] = useState<PollingMode>('IDLE');

  // Keep-Awake state
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(false);
  const keepAwakeRef = useRef<KeepAwake | null>(null);

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
    const bingxPositionSide = bingxPos?.positionSide;  // 'LONG' or 'SHORT'
    const bingxAmt = parseFloat(bingxPos?.positionAmt || bingxPos?.availableAmt || '0');

    // Check Bybit positions
    const bybitPos = bybitPositions.find((p: any) => p.symbol === 'KASUSDT');

    // Use positionSide if available (more reliable), fallback to amount sign
    const isBingxShort = bingxPositionSide
      ? bingxPositionSide === 'SHORT'
      : bingxAmt < 0;

    const isBingxLong = bingxPositionSide
      ? bingxPositionSide === 'LONG'
      : bingxAmt > 0;

    // Determine position state
    // A_POSITION = Bybit LONG or BingX SHORT
    if (bybitPos?.side === 'Buy' || isBingxShort) {
      return 'A_POSITION';
    }

    // B_POSITION = Bybit SHORT or BingX LONG
    if (bybitPos?.side === 'Sell' || isBingxLong) {
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

  // Get adjusted gap with offset correction (30-minute moving average)
  // isGapA: true for gapA (subtract offset), false for gapB (add offset)
  const getAdjustedGap = (rawGap: string, isGapA: boolean): number => {
    const raw = parseFloat(rawGap);
    if (isNaN(raw)) return 0;

    // Apply offset correction
    // gapA: subtract offset to move towards center
    // gapB: add offset to move towards center
    if (isGapA) {
      return raw - offsetMovingAvg;  // gapA - offset
    } else {
      return raw + offsetMovingAvg;  // gapB + offset
    }
  };

  // Calculate gaps for both directions with proper Bid/Ask
  const exchangeAData = getExchangeData(exchangeA);
  const exchangeBData = getExchangeData(exchangeB);
  const gapABuyBSell = calculateArbitrageGap(exchangeAData, exchangeBData); // A買いB売り (A ask → B bid)
  const gapBBuyASell = calculateArbitrageGap(exchangeBData, exchangeAData); // B買いA売り (B ask → A bid)

  // Display gaps (with optional offset correction)
  const displayGapA = useOffsetCorrection && gapHistory.length > 0
    ? getAdjustedGap(gapABuyBSell, true).toFixed(3)   // true = isGapA
    : gapABuyBSell;
  const displayGapB = useOffsetCorrection && gapHistory.length > 0
    ? getAdjustedGap(gapBBuyASell, false).toFixed(3)  // false = isGapB
    : gapBBuyASell;

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

  // Initialize KeepAwake
  useEffect(() => {
    keepAwakeRef.current = new KeepAwake();

    return () => {
      // Cleanup on unmount
      if (keepAwakeRef.current) {
        keepAwakeRef.current.stop();
      }
    };
  }, []);

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

  // Calculate moving average of gap offset (30-minute window)
  useEffect(() => {
    if (gapHistory.length === 0) {
      setOffsetMovingAvg(0);
      return;
    }

    // Calculate average of all offsets in the 30-minute window
    const sum = gapHistory.reduce((acc, h) => acc + h.offset, 0);
    const avg = sum / gapHistory.length;

    setOffsetMovingAvg(avg);

    logger.debug('Trade Tab', 'Offset moving average updated', {
      samples: gapHistory.length,
      windowMinutes: (HISTORY_WINDOW / 60000).toFixed(1),
      offsetMovingAvg: avg.toFixed(4)
    });
  }, [gapHistory, HISTORY_WINDOW]);

  // Notify App.tsx of monitoring state changes (for WebSocket management)
  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const isMonitoring = monitorStatusA.isMonitoring || monitorStatusB.isMonitoring;

    if (props.onMonitoringChange) {
      props.onMonitoringChange(isMonitoring, exchangeA, exchangeB);
      logger.info('Trade Tab', 'Notifying App of monitoring state change', {
        isMonitoring,
        exchangeA,
        exchangeB
      });
    }
  }, [monitorStatusA.isMonitoring, monitorStatusB.isMonitoring, exchangeA, exchangeB, authState.isAuthenticated, props.onMonitoringChange]);

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

      // Gap history sampling for offset correction (1 second interval)
      if (now - lastSampleTimeRef.current >= HISTORY_SAMPLE_INTERVAL) {
        if (!isNaN(gapA) && !isNaN(gapB)) {
          const offset = (gapA - gapB) / 2;  // Correct formula: (gapA - gapB) / 2
          const midpoint = (gapA + gapB) / 2;  // For reference only

          // Detailed debug log for gap calculation verification (1 sample/second - safe)
          logger.debug('Trade Tab', 'Gap history sample added', {
            timestamp: now,
            exchangeA: exchangeA,
            exchangeB: exchangeB,
            // Exchange A data (e.g., Bybit)
            exchangeA_bid: exchangeAData?.bid.toFixed(6) || 'N/A',
            exchangeA_ask: exchangeAData?.ask.toFixed(6) || 'N/A',
            // Exchange B data (e.g., BingX)
            exchangeB_bid: exchangeBData?.bid.toFixed(6) || 'N/A',
            exchangeB_ask: exchangeBData?.ask.toFixed(6) || 'N/A',
            // Gap A: Buy at A (ask), Sell at B (bid)
            gapA_direction: `Buy ${exchangeA} Sell ${exchangeB}`,
            gapA_formula: exchangeAData && exchangeBData
              ? `(${exchangeBData.bid.toFixed(6)} - ${exchangeAData.ask.toFixed(6)}) / ${exchangeAData.ask.toFixed(6)} * 100`
              : 'N/A',
            gapA_raw: gapA.toFixed(4),
            // Gap B: Buy at B (ask), Sell at A (bid)
            gapB_direction: `Buy ${exchangeB} Sell ${exchangeA}`,
            gapB_formula: exchangeAData && exchangeBData
              ? `(${exchangeAData.bid.toFixed(6)} - ${exchangeBData.ask.toFixed(6)}) / ${exchangeBData.ask.toFixed(6)} * 100`
              : 'N/A',
            gapB_raw: gapB.toFixed(4),
            // Offset calculation (CORRECT)
            offset: offset.toFixed(4),
            offset_formula: `(${gapA.toFixed(4)} - ${gapB.toFixed(4)}) / 2 = ${offset.toFixed(4)}`,
            // Midpoint (for reference)
            midpoint: midpoint.toFixed(4),
            midpoint_formula: `(${gapA.toFixed(4)} + ${gapB.toFixed(4)}) / 2 = ${midpoint.toFixed(4)}`
          });

          setGapHistory(prev => {
            // Add new sample
            const newHistory = [...prev, {
              timestamp: now,
              gapA: gapA,
              gapB: gapB,
              offset: offset  // Changed from midpoint to offset
            }];

            // Remove samples older than 30 minutes
            const cutoff = now - HISTORY_WINDOW;
            return newHistory.filter(h => h.timestamp >= cutoff);
          });

          lastSampleTimeRef.current = now;
        }
      }

      // A direction monitoring (A買いB売り)
      if (monitorStatusA.isMonitoring && posState !== 'A_POSITION') {
        // Use OUT threshold when closing position, IN threshold when opening
        const isClosing = (posState === 'B_POSITION');
        const threshold = isClosing ? triggerA.outThreshold : triggerA.inThreshold;
        const gapA_adjusted = getAdjustedGap(gapABuyBSell, true);  // true = isGapA

        // Use adjusted gap if correction is enabled, otherwise use raw gap
        const gapForJudgmentA = useOffsetCorrection && gapHistory.length > 0
          ? gapA_adjusted
          : gapA;

        logger.debug('Trade Tab', 'Monitor A tick', {
          gapA_raw: gapA,
          gapA_adjusted: gapA_adjusted.toFixed(3),
          gapForJudgment: gapForJudgmentA.toFixed(3),
          useOffsetCorrection: useOffsetCorrection,
          offsetMovingAvg: offsetMovingAvg.toFixed(4),
          samples: gapHistory.length,
          threshold: threshold,
          thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)',
          positionState: posState,
          startTime: timerRefA.current,
          isAboveThreshold: gapForJudgmentA >= threshold
        });

        if (gapForJudgmentA >= threshold) {
          // Above threshold - start or continue monitoring
          if (timerRefA.current === null) {
            timerRefA.current = now;
            logger.info('Trade Tab', 'Monitor A: Gap above threshold, starting timer', {
              gapA_raw: gapA,
              gapA_adjusted: gapA_adjusted.toFixed(3),
              threshold: threshold,
              thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)'
            });
            setMonitorStatusA({ startTime: now, isMonitoring: true });
          } else {
            const elapsed = now - timerRefA.current;
            logger.debug('Trade Tab', 'Monitor A: Tracking duration', {
              elapsed,
              required: triggerA.duration,
              gapA_raw: gapA,
              gapA_adjusted: gapA_adjusted.toFixed(3)
            });

            if (elapsed >= triggerA.duration) {
              logger.info('Trade Tab', 'Monitor A: Threshold held for required duration!', {
                elapsed,
                duration: triggerA.duration,
                gapA_raw: gapA,
                gapA_adjusted: gapA_adjusted.toFixed(3),
                threshold: threshold,
                thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)',
                autoEnabled: triggerA.enabled
              });

              if (triggerA.enabled) {
                // Check cooldown period and trading mutex
                const cooldownMs = cooldownPeriod * 1000; // Convert seconds to milliseconds
                const timeSinceLastTrade = now - lastTradeTimeRef.current;
                if (isTrading) {
                  logger.warn('Trade Tab', 'Monitor A: Trade already in progress, skipping', {
                    isTrading,
                    timeSinceLastTrade
                  });
                  return;
                }
                if (timeSinceLastTrade < cooldownMs) {
                  logger.warn('Trade Tab', 'Monitor A: Cooldown active, skipping', {
                    timeSinceLastTrade,
                    cooldownPeriod: cooldownPeriod,
                    cooldownRemaining: cooldownMs - timeSinceLastTrade
                  });
                  return;
                }

                logger.info('Trade Tab', 'Monitor A: AUTO-EXECUTION triggered', {
                  gapA,
                  duration: elapsed,
                  timeSinceLastTrade
                });
                timerRefA.current = null;
                setMonitorStatusA({ startTime: null, isMonitoring: true }); // Keep monitoring active
                setIsTrading(true); // Set mutex
                lastTradeTimeRef.current = now; // Update last trade time

                // Execute trade and clear mutex after completion
                handleManualTradeA()
                  .catch((error) => {
                    logger.error('Trade Tab', 'Auto-execution failed (Monitor A)', { error });
                  })
                  .finally(() => {
                    // Clear mutex after trade completes (success or error) + 2s buffer
                    setTimeout(() => {
                      setIsTrading(false);
                      logger.info('Trade Tab', 'Trading mutex cleared (Monitor A)');
                    }, 2000);
                  });
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
              threshold: threshold
            });
            timerRefA.current = null;
            setMonitorStatusA({ startTime: null, isMonitoring: true });
          }
        }
      }

      // B direction monitoring (B買いA売り)
      if (monitorStatusB.isMonitoring && posState !== 'B_POSITION') {
        // Use OUT threshold when closing position, IN threshold when opening
        const isClosing = (posState === 'A_POSITION');
        const threshold = isClosing ? triggerB.outThreshold : triggerB.inThreshold;
        const gapB_adjusted = getAdjustedGap(gapBBuyASell, false);  // false = isGapB

        // Use adjusted gap if correction is enabled, otherwise use raw gap
        const gapForJudgmentB = useOffsetCorrection && gapHistory.length > 0
          ? gapB_adjusted
          : gapB;

        logger.debug('Trade Tab', 'Monitor B tick', {
          gapB_raw: gapB,
          gapB_adjusted: gapB_adjusted.toFixed(3),
          gapForJudgment: gapForJudgmentB.toFixed(3),
          useOffsetCorrection: useOffsetCorrection,
          offsetMovingAvg: offsetMovingAvg.toFixed(4),
          samples: gapHistory.length,
          threshold: threshold,
          thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)',
          positionState: posState,
          startTime: timerRefB.current,
          isAboveThreshold: gapForJudgmentB >= threshold
        });

        if (gapForJudgmentB >= threshold) {
          if (timerRefB.current === null) {
            timerRefB.current = now;
            logger.info('Trade Tab', 'Monitor B: Gap above threshold, starting timer', {
              gapB_raw: gapB,
              gapB_adjusted: gapB_adjusted.toFixed(3),
              threshold: threshold,
              thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)'
            });
            setMonitorStatusB({ startTime: now, isMonitoring: true });
          } else {
            const elapsed = now - timerRefB.current;
            logger.debug('Trade Tab', 'Monitor B: Tracking duration', {
              elapsed,
              required: triggerB.duration,
              gapB_raw: gapB,
              gapB_adjusted: gapB_adjusted.toFixed(3)
            });

            if (elapsed >= triggerB.duration) {
              logger.info('Trade Tab', 'Monitor B: Threshold held for required duration!', {
                elapsed,
                duration: triggerB.duration,
                gapB_raw: gapB,
                gapB_adjusted: gapB_adjusted.toFixed(3),
                threshold: threshold,
                thresholdType: isClosing ? 'OUT (closing)' : 'IN (opening)',
                autoEnabled: triggerB.enabled
              });

              if (triggerB.enabled) {
                // Check cooldown period and trading mutex
                const cooldownMs = cooldownPeriod * 1000; // Convert seconds to milliseconds
                const timeSinceLastTrade = now - lastTradeTimeRef.current;
                if (isTrading) {
                  logger.warn('Trade Tab', 'Monitor B: Trade already in progress, skipping', {
                    isTrading,
                    timeSinceLastTrade
                  });
                  return;
                }
                if (timeSinceLastTrade < cooldownMs) {
                  logger.warn('Trade Tab', 'Monitor B: Cooldown active, skipping', {
                    timeSinceLastTrade,
                    cooldownPeriod: cooldownPeriod,
                    cooldownRemaining: cooldownMs - timeSinceLastTrade
                  });
                  return;
                }

                logger.info('Trade Tab', 'Monitor B: AUTO-EXECUTION triggered', {
                  gapB,
                  duration: elapsed,
                  timeSinceLastTrade
                });
                timerRefB.current = null;
                setMonitorStatusB({ startTime: null, isMonitoring: true }); // Keep monitoring active
                setIsTrading(true); // Set mutex
                lastTradeTimeRef.current = now; // Update last trade time

                // Execute trade and clear mutex after completion
                handleManualTradeB()
                  .catch((error) => {
                    logger.error('Trade Tab', 'Auto-execution failed (Monitor B)', { error });
                  })
                  .finally(() => {
                    // Clear mutex after trade completes (success or error) + 2s buffer
                    setTimeout(() => {
                      setIsTrading(false);
                      logger.info('Trade Tab', 'Trading mutex cleared (Monitor B)');
                    }, 2000);
                  });
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
              threshold: threshold
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

  // Fetch BingX and Bybit positions periodically (always runs)
  // Continuous 5-second polling for liquidation risk detection
  useEffect(() => {
    if (!bingxApi || !authState.isAuthenticated) {
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
        setPositionsFetched(true); // Mark initial fetch as complete

        // Position imbalance detection (liquidation risk)
        // Check if we have one-sided position (片建て) which indicates possible liquidation
        const bingxPosition = openBingX.find((p: any) => p.symbol === 'KAS-USDT');
        const bingxPositionSide = bingxPosition?.positionSide;  // 'LONG' or 'SHORT'
        const bingxAmt = parseFloat(bingxPosition?.positionAmt || bingxPosition?.availableAmt || '0');
        const bybitPosition = openBybit.find((p: any) => p.symbol === 'KASUSDT');

        // Use positionSide if available (more reliable), fallback to amount sign
        const isBingxShort = bingxPositionSide
          ? bingxPositionSide === 'SHORT'
          : bingxAmt < 0;

        const isBingxLong = bingxPositionSide
          ? bingxPositionSide === 'LONG'
          : bingxAmt > 0;

        // Determine if we have imbalanced position
        // A_POSITION (valid): Bybit LONG + BingX SHORT
        // B_POSITION (valid): Bybit SHORT + BingX LONG
        const isValidAPosition = bybitPosition?.side === 'Buy' && isBingxShort;
        const isValidBPosition = bybitPosition?.side === 'Sell' && isBingxLong;
        const hasBothPositions = isValidAPosition || isValidBPosition;

        const hasAnyPosition = (bybitPosition !== undefined) || (bingxAmt !== 0);

        // Additional safety: if both exchanges have same position count, it's likely valid
        // (e.g., both have 1 position = normal A_POSITION or B_POSITION)
        const positionCountMatch = openBingX.length === openBybit.length && openBingX.length > 0;

        // Only detect imbalance if:
        // 1. We have positions but they're not matched properly
        // 2. Position counts don't match (one exchange has more/less positions)
        const hasImbalance = hasAnyPosition && !hasBothPositions && !positionCountMatch;

        if (hasImbalance) {
          // One-sided position detected (片建て状態)
          // Record the first detection time
          if (imbalanceDetectedTimeRef.current === null) {
            imbalanceDetectedTimeRef.current = Date.now();
            imbalanceCounterRef.current = 1; // Keep counter for backward compatibility
            logger.warn('Trade Tab', '⚠️ Position imbalance detected', {
              bybitPosition: bybitPosition?.side || 'NONE',
              bingxPositionSide: bingxPositionSide || 'NONE',
              bingxAmount: bingxAmt,
              positionCountMatch,
              liquidationTimeout: liquidationTimeout
            });
          }

          // Calculate elapsed time since first detection
          const elapsedTime = Date.now() - imbalanceDetectedTimeRef.current;

          if (elapsedTime >= liquidationTimeout) {
            // Liquidation timeout exceeded - trigger emergency close
            logger.error('Trade Tab', '🚨 LIQUIDATION DETECTED (timeout exceeded)', {
              bybitPosition: bybitPosition?.side || 'NONE',
              bingxPositionSide: bingxPositionSide || 'NONE',
              bingxAmount: bingxAmt,
              positionCountMatch,
              elapsedTime: elapsedTime,
              liquidationTimeout: liquidationTimeout,
              action: 'Triggering emergency close'
            });

            // Execute emergency close
            handleEmergencyCloseAll();

            // Reset detection time after emergency close
            imbalanceDetectedTimeRef.current = null;
            imbalanceCounterRef.current = 0;
          }
        } else {
          // Balanced or no positions - reset timers
          if (imbalanceDetectedTimeRef.current !== null) {
            logger.info('Trade Tab', '✅ Position balance restored', {
              previousElapsedTime: Date.now() - imbalanceDetectedTimeRef.current,
              liquidationTimeout: liquidationTimeout
            });
            imbalanceDetectedTimeRef.current = null;
            imbalanceCounterRef.current = 0;
          }
        }
      } catch (error) {
        logger.error('Trade Tab', 'Failed to fetch positions', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 6500); // Refresh every 6.5 seconds (reduced to avoid 403 errors)

    return () => {
      clearInterval(interval);
    };
  }, [bingxApi, bybitApi, authState.isAuthenticated]);

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

    // Poll every 6.5 seconds (reduced to avoid 403 errors)
    const interval = setInterval(fetchOrderBooksAndCalculateOffset, 6500);

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

  // Emergency position close (both exchanges, no confirmation)
  // Triggered by liquidation detection (10+ seconds of position imbalance)
  const handleEmergencyCloseAll = async () => {
    if (!bingxApi || !bybitApi) return;

    logger.error('Trade Tab', '🚨 EMERGENCY CLOSE TRIGGERED', {
      reason: 'Position imbalance detected (likely liquidation)',
      imbalanceCount: imbalanceCounterRef.current
    });

    setIsLoading(true);
    setBybitIsLoading(true);
    setTradeMessage('🚨 EMERGENCY: Closing all positions on both exchanges...');
    setBybitTradeMessage('🚨 EMERGENCY: Closing all positions on both exchanges...');

    try {
      // Close all positions on both exchanges simultaneously
      const [bingxResult, bybitResult] = await Promise.all([
        bingxApi.closeAllPositions(),
        bybitApi.closeAllPositions()
      ]);

      const successMsg = `🚨 EMERGENCY CLOSE COMPLETED\nBingX: ${bingxResult.message}\nBybit: ${bybitResult.message}`;
      setTradeMessage(successMsg);
      setBybitTradeMessage(successMsg);

      // Stop GAP monitoring after emergency close
      setMonitorStatusA({ startTime: null, isMonitoring: false });
      setMonitorStatusB({ startTime: null, isMonitoring: false });
      timerRefA.current = null;
      timerRefB.current = null;

      logger.error('Trade Tab', '✅ Emergency close completed', {
        bingxResult,
        bybitResult
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failMsg = `🚨 EMERGENCY CLOSE FAILED: ${errorMsg}`;
      setTradeMessage(failMsg);
      setBybitTradeMessage(failMsg);
      logger.error('Trade Tab', '❌ Emergency close failed', { error: errorMsg });
    } finally {
      setIsLoading(false);
      setBybitIsLoading(false);
      imbalanceCounterRef.current = 0; // Reset counter
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

  const handleKeepAwakeToggle = async () => {
    if (!keepAwakeRef.current) return;

    try {
      if (keepAwakeEnabled) {
        await keepAwakeRef.current.stop();
        setKeepAwakeEnabled(false);
        logger.info('Trade Tab', 'Keep-Awake disabled');
      } else {
        await keepAwakeRef.current.start();
        setKeepAwakeEnabled(true);
        logger.info('Trade Tab', 'Keep-Awake enabled');
      }
    } catch (error) {
      logger.error('Trade Tab', 'Keep-Awake toggle failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      alert('Keep-Awake mode not supported in this browser/device');
    }
  };

  // Login screen
  if (!authState.isAuthenticated) {
    return (
      <section className="tab-content trade-tab">
        <h2>⚡ Trade Execution</h2>

        <div className="auth-container">
          <h3>
            🔒 Authentication Required
          </h3>

          <p>
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
      <div className="trade-settings-panel">
        {/* Input Fields Section */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 80px auto', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>発注量:</label>
            <input
              type="number"
              value={tradeQuantity}
              onChange={(e) => {
                const inputValue = e.target.value;
                const numValue = parseFloat(inputValue);
                const maxValue = parseFloat(maxPosition);

                // Cap at maxPosition if exceeded
                if (!isNaN(numValue) && !isNaN(maxValue) && numValue > maxValue) {
                  setTradeQuantity(maxPosition);
                } else {
                  setTradeQuantity(inputValue);
                }
              }}
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

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>最大ポジション:</label>
            <input
              type="number"
              value={maxPosition}
              onChange={(e) => {
                const newMax = e.target.value;
                setMaxPosition(newMax);

                // If current tradeQuantity exceeds new max, cap it
                const numTrade = parseFloat(tradeQuantity);
                const numMax = parseFloat(newMax);
                if (!isNaN(numTrade) && !isNaN(numMax) && numTrade > numMax) {
                  setTradeQuantity(newMax);
                }
              }}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            />
            <span>KAS</span>
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
            <input
              type="number"
              value={cooldownPeriod}
              onChange={(e) => setCooldownPeriod(parseInt(e.target.value) || 30)}
              min="1"
              max="300"
              style={{ padding: '4px', border: '1px solid #ccc' }}
            />
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

        {/* Gap Offset Correction */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={useOffsetCorrection}
              onChange={(e) => setUseOffsetCorrection(e.target.checked)}
            />
            <span>GAP補正を使用（30分移動平均）</span>
          </label>
          {useOffsetCorrection && gapHistory.length > 0 && (
            <div style={{ fontSize: '11px', color: '#666', marginLeft: '20px', marginTop: '4px' }}>
              オフセット: {offsetMovingAvg.toFixed(4)}% | サンプル数: {gapHistory.length}
            </div>
          )}
        </div>

        {/* Keep-Awake Toggle */}
        <div style={{ marginTop: '15px' }}>
          <button
            onClick={handleKeepAwakeToggle}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              cursor: 'pointer',
              backgroundColor: keepAwakeEnabled ? '#28a745' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              transition: 'background-color 0.3s'
            }}
          >
            {keepAwakeEnabled ? '🔋 Keep-Awake: ON' : '💤 Keep-Awake: OFF'}
          </button>
          <div style={{
            fontSize: '11px',
            color: '#666',
            marginTop: '5px'
          }}>
            Prevents browser throttling when tab is in background (Desktop only)
          </div>
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
            <select
              value={liquidationTimeout}
              onChange={(e) => setLiquidationTimeout(parseInt(e.target.value))}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            >
              <option value="1000">1000</option>
              <option value="3000">3000</option>
              <option value="5000">5000</option>
              <option value="10000">10000</option>
            </select>
            <span>ms</span>
          </div>
        </div>

        {/* Execution Conditions - MT5 SL Style */}
        <div className="divider" style={{ paddingTop: '15px', marginTop: '15px' }}>
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
              <input
                type="number"
                value={triggerA.outThreshold}
                onChange={(e) => setTriggerA({ ...triggerA, outThreshold: parseFloat(e.target.value) || 0 })}
                step="0.01"
                style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }}
              />
              <span>% OUT</span>
              <input
                type="text"
                value={displayGapA}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  color: parseFloat(displayGapA) < 0 ? '#dc3545' : parseFloat(displayGapA) > 0 ? '#28a745' : '#666',
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
                background: (!positionsFetched) ? '#e9ecef' : // Loading中はグレー
                           (triggerA.enabled && monitorStatusA.isMonitoring && positionState !== 'A_POSITION')
                             ? '#dc3545' : '#e9ecef',
                color: (!positionsFetched) ? '#666' :
                       (triggerA.enabled && monitorStatusA.isMonitoring && positionState !== 'A_POSITION')
                         ? 'white' : '#666',
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
              <input
                type="number"
                value={triggerB.outThreshold}
                onChange={(e) => setTriggerB({ ...triggerB, outThreshold: parseFloat(e.target.value) || 0 })}
                step="0.01"
                style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }}
              />
              <span>% OUT</span>
              <input
                type="text"
                value={displayGapB}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  color: parseFloat(displayGapB) < 0 ? '#dc3545' : parseFloat(displayGapB) > 0 ? '#28a745' : '#666',
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
                background: (!positionsFetched) ? '#e9ecef' : // Loading中はグレー
                           (triggerB.enabled && monitorStatusB.isMonitoring && positionState !== 'B_POSITION')
                             ? '#dc3545' : '#e9ecef',
                color: (!positionsFetched) ? '#666' :
                       (triggerB.enabled && monitorStatusB.isMonitoring && positionState !== 'B_POSITION')
                         ? 'white' : '#666',
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
      <div className="manual-trading-panel bingx">
        <h3>
          📊 Manual Trading - BingX KAS-USDT
        </h3>

        {/* API Status */}
        {!bingxApi && (
          <div className="trade-alert warning">
            ⚠️ BingX API not configured. Go to <strong>API Tab</strong> and set up your API keys first.
          </div>
        )}

        {/* Trade Message */}
        {tradeMessage && (
          <div className={`trade-alert ${tradeMessage.includes('✅') ? 'success' : tradeMessage.includes('❌') ? 'error' : 'info'}`}>
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
                const unrealizedProfit = parseFloat(position.unrealizedProfit || position.unrealisedProfit || position.unRealizedProfit || '0');

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
        <div className="trade-alert error" style={{ marginTop: '15px', fontSize: '13px' }}>
          <strong>⚠️ Risk Warning:</strong> Trading perpetual futures involves significant risk.
          You may lose your entire investment. BingX does not offer testnet - this is REAL trading.
          Start with small amounts to test functionality.
        </div>
      </div>

      {/* Bybit Manual Trading Section */}
      <div className="manual-trading-panel bybit">
        <h3>
          📊 Manual Trading - Bybit KASUSDT
        </h3>

        {/* API Status */}
        {!bybitApi && (
          <div className="trade-alert warning">
            ⚠️ Bybit API not configured. Go to <strong>API Tab</strong> and set up your API keys first.
          </div>
        )}

        {/* Trade Message */}
        {bybitTradeMessage && (
          <div className={`trade-alert ${bybitTradeMessage.includes('✅') ? 'success' : bybitTradeMessage.includes('❌') ? 'error' : 'info'}`} style={{ whiteSpace: 'pre-wrap' }}>
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

        {/* Demo Trading Notice */}
        <div className="trade-alert info" style={{ marginTop: '15px', fontSize: '13px' }}>
          <strong>ℹ️ Demo Trading Notice:</strong> This is Bybit Demo Trading with virtual funds (50,000 USDT).
          Perfect for testing strategies without real money risk. Demo data may differ from production.
        </div>
      </div>

      {/* Session Info */}
      <p style={{ marginTop: '15px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
        Session active. Auto-logout in {Math.round((SESSION_TIMEOUT - (Date.now() - authState.lastAuthTime!)) / 60000)} minutes.
      </p>

      {/* Debug Logs Section */}
      <div className="manual-trading-panel" style={{
        border: '2px solid #6c757d'
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
