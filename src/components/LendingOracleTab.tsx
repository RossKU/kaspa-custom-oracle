import type { PriceData } from '../types/binance';
import type { MexcPriceData } from '../services/mexc';
import type { BybitPriceData } from '../services/bybit';
import type { GateioPriceData } from '../services/gateio';
import type { KucoinPriceData } from '../services/kucoin';
import type { BingXPriceData } from '../services/bingx';

interface LendingOracleTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
}

export function LendingOracleTab({
  binanceData,
  mexcData,
  bybitData,
  gateioData,
  kucoinData,
  bingxData,
}: LendingOracleTabProps) {
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
                      <span className="stat-label">Price History:</span>
                      <span className="stat-value">
                        {ex.data.trades?.length || 0} snapshots
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
      </div>
    </section>
  );
}
