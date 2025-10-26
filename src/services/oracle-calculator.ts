// Oracle Price Calculator
// Implements Chainlink-style Median aggregation for KAS/USDT price
// Uses VWAP (Volume Weighted Average Price) from each exchange

import type { OracleResult, OracleConfig } from '../types/oracle';
import { calculateVWAP } from '../types/oracle';
import type { PriceData } from '../types/binance';
import type { MexcPriceData } from './mexc';
import type { BybitPriceData } from './bybit';
import type { GateioPriceData } from './gateio';
import type { KucoinPriceData } from './kucoin';
import type { BingXPriceData } from './bingx';
import { logger } from '../utils/logger';

/**
 * デフォルト設定
 */
const DEFAULT_CONFIG: Required<OracleConfig> = {
  maxStalenessMs: 5000,              // 5秒以内のデータのみ使用
  minSources: 3,                      // 最低3つのデータソースが必要
  highConfidenceMinSources: 6,        // HIGH: 全6取引所
  highConfidenceMaxSpread: 0.5,       // HIGH: スプレッド0.5%以下
  mediumConfidenceMinSources: 4,      // MEDIUM: 4取引所以上
  mediumConfidenceMaxSpread: 1.0      // MEDIUM: スプレッド1.0%以下
};

/**
 * Oracle価格を計算（Chainlink Median方式）
 *
 * @param binanceData Binance価格データ
 * @param mexcData MEXC価格データ
 * @param bybitData Bybit価格データ
 * @param gateioData Gate.io価格データ
 * @param kucoinData Kucoin価格データ
 * @param bingxData BingX価格データ
 * @param config Oracle計算設定（オプション）
 * @returns OracleResult or null（データ不足の場合）
 */
export function calculateOraclePrice(
  binanceData: PriceData | null,
  mexcData: MexcPriceData | null,
  bybitData: BybitPriceData | null,
  gateioData: GateioPriceData | null,
  kucoinData: KucoinPriceData | null,
  bingxData: BingXPriceData | null,
  config?: Partial<OracleConfig>
): OracleResult | null {
  // 設定のマージ
  const cfg: Required<OracleConfig> = { ...DEFAULT_CONFIG, ...config };

  // Step 1: 有効なVWAP価格データを収集
  const now = Date.now();
  const prices: number[] = [];
  const exchanges: string[] = [];

  // Binance - VWAP計算、失敗時はlastPriceにフォールバック
  if (binanceData && binanceData.lastUpdate && (now - binanceData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(binanceData.trades);
    prices.push(vwap !== null ? vwap : binanceData.price);
    exchanges.push('Binance');
  }

  // MEXC - VWAP計算、失敗時はlastPriceにフォールバック
  if (mexcData && mexcData.lastUpdate && (now - mexcData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(mexcData.trades);
    prices.push(vwap !== null ? vwap : mexcData.price);
    exchanges.push('MEXC');
  }

  // Bybit - VWAP計算、失敗時はlastPriceにフォールバック
  if (bybitData && bybitData.lastUpdate && (now - bybitData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(bybitData.trades);
    prices.push(vwap !== null ? vwap : bybitData.price);
    exchanges.push('Bybit');
  }

  // Gate.io - VWAP計算、失敗時はmidPriceにフォールバック
  if (gateioData && gateioData.lastUpdate && (now - gateioData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(gateioData.trades);
    prices.push(vwap !== null ? vwap : gateioData.price);
    exchanges.push('Gate.io');
  }

  // Kucoin - VWAP計算、失敗時はmidPriceにフォールバック
  if (kucoinData && kucoinData.lastUpdate && (now - kucoinData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(kucoinData.trades);
    prices.push(vwap !== null ? vwap : kucoinData.price);
    exchanges.push('Kucoin');
  }

  // BingX - VWAP計算、失敗時はlastPriceにフォールバック
  if (bingxData && bingxData.lastUpdate && (now - bingxData.lastUpdate) <= cfg.maxStalenessMs) {
    const vwap = calculateVWAP(bingxData.trades);
    prices.push(vwap !== null ? vwap : bingxData.price);
    exchanges.push('BingX');
  }

  // Step 2: 最低データソース数チェック
  if (prices.length < cfg.minSources) {
    logger.warn('Oracle Calculator', 'Insufficient data sources', {
      validSources: prices.length,
      minRequired: cfg.minSources
    });
    return null;
  }

  // Step 3: ソート（昇順）
  const sortedPrices = [...prices].sort((a, b) => a - b);

  // Step 4: Median計算
  let median: number;
  const length = sortedPrices.length;

  if (length % 2 === 0) {
    // 偶数個の場合: 中央2つの平均
    const mid = length / 2;
    median = (sortedPrices[mid - 1] + sortedPrices[mid]) / 2;
  } else {
    // 奇数個の場合: 中央値
    median = sortedPrices[Math.floor(length / 2)];
  }

  // Step 5: 統計情報計算
  const lowestPrice = sortedPrices[0];
  const highestPrice = sortedPrices[length - 1];
  const spreadPercent = ((highestPrice - lowestPrice) / lowestPrice) * 100;

  // Step 6: 信頼度判定
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  if (prices.length >= cfg.highConfidenceMinSources && spreadPercent <= cfg.highConfidenceMaxSpread) {
    confidence = 'HIGH';
  } else if (prices.length >= cfg.mediumConfidenceMinSources && spreadPercent <= cfg.mediumConfidenceMaxSpread) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  // Step 7: ログ出力
  logger.info('Oracle Calculator', 'Oracle price calculated', {
    price: median.toFixed(7),
    confidence,
    validSources: prices.length,
    exchanges: exchanges.join(', '),
    lowestPrice: lowestPrice.toFixed(7),
    highestPrice: highestPrice.toFixed(7),
    spreadPercent: spreadPercent.toFixed(3) + '%'
  });

  return {
    price: median,
    confidence,
    validSources: prices.length,
    lowestPrice,
    highestPrice,
    spreadPercent,
    timestamp: now
  };
}

/**
 * タイムスタンプから相対時間文字列を生成
 *
 * @param timestamp タイムスタンプ（ms）
 * @returns 相対時間文字列（例: "2s ago", "1m ago"）
 */
export function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

