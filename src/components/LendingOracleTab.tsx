import { useState, useEffect, useRef } from 'react';
import type { PriceData } from '../types/binance';
import type { MexcPriceData } from '../services/mexc';
import type { BybitPriceData } from '../services/bybit';
import type { GateioPriceData } from '../services/gateio';
import type { KucoinPriceData } from '../services/kucoin';
import type { BingXPriceData } from '../services/bingx';
import type { CorrelationMatrix } from '../types/correlation';

interface DebugLogEntry {
  timestamp: number;
  exchange: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface LendingOracleTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
  correlationMatrix: CorrelationMatrix | null;
}

export function LendingOracleTab({
  binanceData,
  mexcData,
  bybitData,
  gateioData,
  kucoinData,
  bingxData,
  correlationMatrix,
}: LendingOracleTabProps) {
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevDataRef = useRef<{
    binance?: number;
    mexc?: number;
    bybit?: number;
    gateio?: number;
    kucoin?: number;
    bingx?: number;
  }>({});

  // Count active exchanges
  const exchanges = [
    { name: 'Binance', data: binanceData },
    { name: 'MEXC', data: mexcData },
    { name: 'Bybit', data: bybitData },
    { name: 'Gate.io', data: gateioData },
    { name: 'Kucoin', data: kucoinData },
    { name: 'BingX', data: bingxData },
  ];

  const activeExchanges = exchanges.filter(ex => ex.data !== null);

  const addLog = (exchange: string, level: DebugLogEntry['level'], message: string) => {
    setDebugLogs(prev => {
      const newLogs = [...prev, {
        timestamp: Date.now(),
        exchange,
        level,
        message,
      }];
      // Keep only last 100 logs
      return newLogs.slice(-100);
    });
  };

  const exportLogs = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `lending-oracle-logs-${timestamp}.txt`;

    const logText = [
      '='.repeat(80),
      'Lending Oracle - Phase 1 Debug Logs',
      `Exported: ${new Date().toLocaleString()}`,
      `Total Logs: ${debugLogs.length}`,
      '='.repeat(80),
      '',
      ...debugLogs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const level = log.level.toUpperCase().padEnd(7);
        const exchange = log.exchange.padEnd(10);
        return `[${time}] [${level}] [${exchange}] ${log.message}`;
      }),
      '',
      '='.repeat(80),
      'End of logs',
      '='.repeat(80),
    ].join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [debugLogs, autoScroll]);

  // Monitor Binance data changes
  useEffect(() => {
    if (!binanceData) return;

    const snapshotCount = binanceData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = binanceData.volumeStats?.sampleCount || 0;
    const avgVolume = binanceData.volumeStats?.mean || 0;

    if (prevDataRef.current.binance === undefined) {
      addLog('Binance', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.binance) {
      addLog('Binance', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.binance = snapshotCount;
  }, [binanceData]);

  // Monitor MEXC data changes
  useEffect(() => {
    if (!mexcData) return;

    const snapshotCount = mexcData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = mexcData.volumeStats?.sampleCount || 0;
    const avgVolume = mexcData.volumeStats?.mean || 0;

    if (prevDataRef.current.mexc === undefined) {
      addLog('MEXC', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.mexc) {
      addLog('MEXC', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.mexc = snapshotCount;
  }, [mexcData]);

  // Monitor Bybit data changes
  useEffect(() => {
    if (!bybitData) return;

    const snapshotCount = bybitData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = bybitData.volumeStats?.sampleCount || 0;
    const avgVolume = bybitData.volumeStats?.mean || 0;

    if (prevDataRef.current.bybit === undefined) {
      addLog('Bybit', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.bybit) {
      addLog('Bybit', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.bybit = snapshotCount;
  }, [bybitData]);

  // Monitor Gate.io data changes
  useEffect(() => {
    if (!gateioData) return;

    const snapshotCount = gateioData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = gateioData.volumeStats?.sampleCount || 0;
    const avgVolume = gateioData.volumeStats?.mean || 0;

    if (prevDataRef.current.gateio === undefined) {
      addLog('Gate.io', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.gateio) {
      addLog('Gate.io', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.gateio = snapshotCount;
  }, [gateioData]);

  // Monitor Kucoin data changes
  useEffect(() => {
    if (!kucoinData) return;

    const snapshotCount = kucoinData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = kucoinData.volumeStats?.sampleCount || 0;
    const avgVolume = kucoinData.volumeStats?.mean || 0;

    if (prevDataRef.current.kucoin === undefined) {
      addLog('Kucoin', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.kucoin) {
      addLog('Kucoin', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.kucoin = snapshotCount;
  }, [kucoinData]);

  // Monitor BingX data changes
  useEffect(() => {
    if (!bingxData) return;

    const snapshotCount = bingxData.priceHistory?.snapshots?.length || 0;
    const tradesIn60s = bingxData.volumeStats?.sampleCount || 0;
    const avgVolume = bingxData.volumeStats?.mean || 0;

    if (prevDataRef.current.bingx === undefined) {
      addLog('BingX', 'success', `Connected - Phase 1 collection started`);
    } else if (snapshotCount > 0 && snapshotCount % 100 === 0 && snapshotCount !== prevDataRef.current.bingx) {
      addLog('BingX', 'info', `Snapshots: ${snapshotCount} | 60s window: ${tradesIn60s} trades, avg volume: ${avgVolume.toFixed(2)} KAS`);
    }

    prevDataRef.current.bingx = snapshotCount;
  }, [bingxData]);

  return (
    <section className="tab-content">
      <div className="lending-oracle-container">
        <div className="lending-oracle-header">
          <h2>🏦 Lending Oracle</h2>
          <p className="lending-oracle-subtitle">
            Deterministic, low-noise, fair price feed for lending protocols
          </p>
        </div>

        <div className="oracle-price-card lending-oracle-card">
          <div className="oracle-header">
            <h3>📊 Oracle Price (Phase 1: Data Collection Active)</h3>
          </div>

          <div className="oracle-price-display">
            <div className="oracle-price-value">
              <span className="price-symbol">$</span>
              <span className="price-amount">---.-------</span>
              <span className="price-currency">USDT</span>
            </div>
            <p className="oracle-status-text">Collecting historical data for correlation analysis...</p>
          </div>

          <div className="oracle-details">
            <div className="oracle-detail-item">
              <span className="label">Phase:</span>
              <span className="value">1 - Data Collection Infrastructure</span>
            </div>

            <div className="oracle-detail-item">
              <span className="label">Active Sources:</span>
              <span className="value">{activeExchanges.length} / 6 exchanges</span>
            </div>

            <div className="oracle-detail-item full-width">
              <span className="label">Implementation Plan:</span>
              <span className="value explanation">
                Phase 1: High-precision timestamp recording, price history buffering, volume statistics ✅<br/>
                Phase 2: Correlation engine (pending)<br/>
                Phase 3: Calibration system (pending)<br/>
                Phase 4: Offset application (pending)<br/>
                Phase 5: Real-time anomaly detection (pending)<br/>
                Phase 6: Weighted smoothing (pending)<br/>
                Phase 7: Delayed confirmation (2-5s) (pending)
              </span>
            </div>
          </div>
        </div>

        <div className="lending-oracle-info">
          <h3>📋 Phase 1: Data Collection Status</h3>
          <div className="exchange-collection-grid">
            {exchanges.map(ex => (
              <div
                key={ex.name}
                className={`exchange-collection-card ${ex.data ? 'active' : 'inactive'}`}
              >
                <div className="exchange-collection-header">
                  <span className="exchange-name">{ex.name}</span>
                  <span className={`status-badge ${ex.data ? 'connected' : 'disconnected'}`}>
                    {ex.data ? '●' : '○'}
                  </span>
                </div>
                {ex.data && (
                  <div className="exchange-collection-stats">
                    <div className="stat-item">
                      <span className="stat-label">Snapshots:</span>
                      <span className="stat-value">
                        {ex.data.priceHistory?.snapshots?.length || 0}
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">60s Trades:</span>
                      <span className="stat-value">
                        {ex.data.volumeStats?.sampleCount || 0} trades
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Avg Volume:</span>
                      <span className="stat-value">
                        {ex.data.volumeStats?.mean?.toFixed(2) || '0'} KAS
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Latest Price:</span>
                      <span className="stat-value">
                        ${typeof ex.data.price === 'number' ? ex.data.price.toFixed(7) : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lending-oracle-features">
          <h3>🎯 Lending Oracle Features</h3>
          <div className="features-grid">
            <div className="feature-card">
              <h4>⏱️ Tick Correlation Maximization</h4>
              <p>Data-driven offset optimization to align price ticks across exchanges with different latencies</p>
            </div>
            <div className="feature-card">
              <h4>🛡️ Manipulation Detection</h4>
              <p>Real-time anomaly detection using correlation deviation, volume z-score, and price outlier analysis</p>
            </div>
            <div className="feature-card">
              <h4>⚖️ Weighted Smoothing</h4>
              <p>Health score-based weighted median to automatically suppress manipulated exchange data</p>
            </div>
            <div className="feature-card">
              <h4>🔒 Delayed Confirmation</h4>
              <p>2-5 second delay for deterministic, immutable price confirmation resistant to flash loan attacks</p>
            </div>
          </div>
        </div>

        <div className="lending-oracle-debug">
          <div className="debug-header">
            <h3>🐛 Phase 1 Debug Log</h3>
            <div className="debug-controls">
              <label className="debug-control">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                />
                <span>Auto-scroll</span>
              </label>
              <button
                className="debug-clear-btn"
                onClick={() => setDebugLogs([])}
              >
                Clear Logs
              </button>
              <button
                className="debug-export-btn"
                onClick={exportLogs}
                disabled={debugLogs.length === 0}
              >
                Export .txt
              </button>
            </div>
          </div>

          <div className="debug-log-container" ref={logContainerRef}>
            {debugLogs.length === 0 ? (
              <div className="debug-log-empty">
                Waiting for data collection events...
              </div>
            ) : (
              debugLogs.map((log, index) => (
                <div key={index} className={`debug-log-entry debug-log-${log.level}`}>
                  <span className="debug-log-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="debug-log-exchange">[{log.exchange}]</span>
                  <span className="debug-log-message">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Phase 2A: Correlation Matrix */}
        {correlationMatrix && correlationMatrix.results.length > 0 && (
          <div className="correlation-section">
            <h3>📊 Phase 2A: Correlation Matrix</h3>

            {/* Summary */}
            <div className="correlation-summary">
              <div className="summary-item">
                <span className="summary-label">Average Correlation:</span>
                <span className="summary-value">{correlationMatrix.averageCorrelation.toFixed(3)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Healthy Exchanges:</span>
                <span className="summary-value">{correlationMatrix.healthyExchanges.length}/6</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Pairs Calculated:</span>
                <span className="summary-value">{correlationMatrix.results.length}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Updated:</span>
                <span className="summary-value">{new Date(correlationMatrix.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* Pairwise Results */}
            <div className="correlation-pairs">
              {correlationMatrix.results.map((result, index) => (
                <div key={index} className="pair-card">
                  <div className="pair-header">
                    <span className="pair-name">{result.exchangeA} ↔ {result.exchangeB}</span>
                  </div>
                  <div className="pair-stats">
                    <div className="pair-stat">
                      <span className="stat-label">Correlation:</span>
                      <span className={`stat-value ${result.correlation > 0.85 ? 'high' : result.correlation > 0.7 ? 'medium' : 'low'}`}>
                        {result.correlation.toFixed(3)}
                      </span>
                    </div>
                    <div className="pair-stat">
                      <span className="stat-label">Offset:</span>
                      <span className="stat-value">
                        {result.optimalOffsetMs > 0 ? '+' : ''}{result.optimalOffsetMs}ms
                      </span>
                    </div>
                    <div className="pair-stat">
                      <span className="stat-label">Weight:</span>
                      <span className="stat-value">{result.weight.toFixed(3)}</span>
                    </div>
                    <div className="pair-stat">
                      <span className="stat-label">Samples:</span>
                      <span className="stat-value">{result.sampleSize}</span>
                    </div>
                  </div>
                  {/* Correlation bar */}
                  <div className="correlation-bar-container">
                    <div
                      className="correlation-bar"
                      style={{
                        width: `${Math.abs(result.correlation) * 100}%`,
                        background:
                          result.correlation > 0.85
                            ? '#28a745'
                            : result.correlation > 0.7
                            ? '#ffc107'
                            : '#dc3545',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
