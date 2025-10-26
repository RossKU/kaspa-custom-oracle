import { useMemo } from 'react';
import type { PriceData } from '../types/binance';
import type { MexcPriceData } from '../services/mexc';
import type { BybitPriceData } from '../services/bybit';
import type { GateioPriceData } from '../services/gateio';
import type { KucoinPriceData } from '../services/kucoin';
import type { BingXPriceData } from '../services/bingx';
import { calculateOraclePrice, getTimeAgo, getConfidenceIcon } from '../services/oracle-calculator';

interface PriceTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
  isConnecting: boolean;
  error: string | null;
}

export function PriceTab({
  binanceData,
  mexcData,
  bybitData,
  gateioData,
  kucoinData,
  bingxData,
  isConnecting,
  error
}: PriceTabProps) {
  // Calculate Oracle price using Chainlink Median method
  const oracleResult = useMemo(
    () => calculateOraclePrice(
      binanceData,
      mexcData,
      bybitData,
      gateioData,
      kucoinData,
      bingxData
    ),
    [binanceData, mexcData, bybitData, gateioData, kucoinData, bingxData]
  );

  return (
    <section className="tab-content">
      {isConnecting && <p className="loading-message">Connecting to exchanges...</p>}
      {error && <p className="error-message">{error}</p>}

      {(binanceData || mexcData || bybitData || gateioData || kucoinData || bingxData) && (
        <table className="price-table">
          <thead>
            <tr>
              <th>Exchange</th>
              <th>Type</th>
              <th>Price</th>
              <th>Bid</th>
              <th>Ask</th>
            </tr>
          </thead>
          <tbody>
            {binanceData && (
              <tr>
                <td>Binance</td>
                <td className="type-futures">F</td>
                <td className="price">${binanceData.price.toFixed(7)}</td>
                <td className="bid">${binanceData.bestBid.toFixed(7)}</td>
                <td className="ask">${binanceData.bestAsk.toFixed(7)}</td>
              </tr>
            )}
            {mexcData && (
              <tr>
                <td>MEXC</td>
                <td className="type-futures">F</td>
                <td className="price">${mexcData.price.toFixed(7)}</td>
                <td className="bid">${mexcData.bid.toFixed(7)}</td>
                <td className="ask">${mexcData.ask.toFixed(7)}</td>
              </tr>
            )}
            {bybitData && (
              <tr>
                <td>Bybit</td>
                <td className="type-futures">F</td>
                <td className="price">${bybitData.price.toFixed(7)}</td>
                <td className="bid">${bybitData.bid.toFixed(7)}</td>
                <td className="ask">${bybitData.ask.toFixed(7)}</td>
              </tr>
            )}
            {gateioData && (
              <tr>
                <td>Gate.io</td>
                <td className="type-futures">F</td>
                <td className="price">${gateioData.price.toFixed(7)}</td>
                <td className="bid">${gateioData.bid.toFixed(7)}</td>
                <td className="ask">${gateioData.ask.toFixed(7)}</td>
              </tr>
            )}
            {kucoinData && (
              <tr>
                <td>Kucoin</td>
                <td className="type-futures">F</td>
                <td className="price">${kucoinData.price.toFixed(7)}</td>
                <td className="bid">${kucoinData.bid.toFixed(7)}</td>
                <td className="ask">${kucoinData.ask.toFixed(7)}</td>
              </tr>
            )}
            {bingxData && (
              <tr>
                <td>BingX</td>
                <td className="type-futures">F</td>
                <td className="price">${bingxData.price.toFixed(7)}</td>
                <td className="bid">${bingxData.bid.toFixed(7)}</td>
                <td className="ask">${bingxData.ask.toFixed(7)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Oracle Price Card */}
      {oracleResult && (
        <div className="oracle-price-card">
          <div className="oracle-header">
            <span className="oracle-icon">🎯</span>
            <h3 className="oracle-title">ORACLE PRICE</h3>
            <span className="oracle-subtitle">(Chainlink Method)</span>
          </div>

          <div className="oracle-price-display">
            ${oracleResult.price.toFixed(7)} <span className="currency">USDT</span>
          </div>

          <div className="oracle-details">
            <div className="oracle-detail-item">
              <span className="label">Method:</span>
              <span className="value">Median of {oracleResult.validSources} Exchanges</span>
            </div>

            <div className="oracle-detail-item">
              <span className="label">Confidence:</span>
              <span className={`confidence-badge confidence-${oracleResult.confidence.toLowerCase()}`}>
                {getConfidenceIcon(oracleResult.confidence)} {oracleResult.confidence}
              </span>
            </div>

            <div className="oracle-detail-item">
              <span className="label">Range:</span>
              <span className="value">
                ${oracleResult.lowestPrice.toFixed(7)} - ${oracleResult.highestPrice.toFixed(7)}
                <span className="spread"> ({oracleResult.spreadPercent.toFixed(2)}%)</span>
              </span>
            </div>

            <div className="oracle-detail-item">
              <span className="label">Updated:</span>
              <span className="value">{getTimeAgo(oracleResult.timestamp)}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
