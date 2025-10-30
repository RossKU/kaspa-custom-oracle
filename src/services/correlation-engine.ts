/**
 * Phase 2A: Correlation Engine
 * Pairwise correlation calculation for exchange synchronization
 */

import type { PriceHistory, VolumeStats } from '../types/lending-oracle';
import type {
  CorrelationMatrix,
  CorrelationResult,
  CalibrationConfig,
  PriceReturns,
} from '../types/correlation';
import { DEFAULT_CALIBRATION_CONFIG } from '../types/correlation';
import {
  calculatePriceReturns,
  findOptimalOffset,
  calculatePairWeight,
} from '../utils/correlation';

/**
 * 取引所データ（健全性チェック用）
 */
interface ExchangeData {
  priceHistory: PriceHistory;
  volumeStats?: VolumeStats;
  lastUpdate: number;
}

/**
 * 相関計算エンジン
 */
export class CorrelationEngine {
  private config: CalibrationConfig;
  private lastMatrix: CorrelationMatrix | null = null;

  constructor(config?: Partial<CalibrationConfig>) {
    this.config = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  }

  /**
   * 健全性チェック（シンプル版）
   * 最終更新時刻のみをチェック
   */
  private isExchangeHealthy(lastUpdate: number): boolean {
    const timeSinceUpdate = Date.now() - lastUpdate;
    return timeSinceUpdate < this.config.healthCheckTimeoutMs;
  }

  /**
   * 全取引所ペアの相関行列を計算
   */
  calculateCorrelationMatrix(
    exchanges: Map<string, ExchangeData>
  ): CorrelationMatrix {
    const startTime = Date.now();

    // Step 1: 健全な取引所をフィルタ & 価格変化率を計算
    const healthyExchanges: string[] = [];
    const exchangeReturns = new Map<string, PriceReturns>();
    const exchangeLiquidity = new Map<string, number>();
    const exchangeSnapshots = new Map<string, number>();

    exchanges.forEach((data, name) => {
      // 健全性チェック
      if (!this.isExchangeHealthy(data.lastUpdate)) {
        const timeSinceUpdate = ((Date.now() - data.lastUpdate) / 1000).toFixed(1);
        console.warn(
          `[Phase 2A] ⚠️ ${name}: Not healthy (last update: ${timeSinceUpdate}s ago)`
        );
        return;
      }

      // 価格変化率を計算
      const returns = calculatePriceReturns(data.priceHistory.snapshots, name);

      if (!returns || returns.sampleCount < this.config.minSampleSize) {
        console.warn(
          `[Phase 2A] ⚠️ ${name}: Insufficient samples (${returns?.sampleCount || 0} < ${this.config.minSampleSize})`
        );
        return;
      }

      // 健全な取引所として登録
      healthyExchanges.push(name);
      exchangeReturns.set(name, returns);

      // 流動性とスナップショット数を記録
      const liquidity = data.volumeStats?.sampleCount || 0;
      exchangeLiquidity.set(name, liquidity);
      exchangeSnapshots.set(name, data.priceHistory.snapshots.length);
    });

    console.log(
      `[Phase 2A] Healthy exchanges: ${healthyExchanges.length}/${exchanges.size} - [${healthyExchanges.join(', ')}]`
    );

    // Step 2: 最低2取引所必要
    if (healthyExchanges.length < 2) {
      console.warn('[Phase 2A] ⚠️ Insufficient healthy exchanges (need at least 2)');
      return {
        results: [],
        healthyExchanges: [],
        averageCorrelation: 0,
        timestamp: Date.now(),
      };
    }

    // Step 3: 重み計算用の最大値を取得
    const maxLiquidity = Math.max(...Array.from(exchangeLiquidity.values()));
    const maxSnapshots = Math.max(...Array.from(exchangeSnapshots.values()));

    // Step 4: 全ペアを生成して相関計算
    const results: CorrelationResult[] = [];

    for (let i = 0; i < healthyExchanges.length; i++) {
      for (let j = i + 1; j < healthyExchanges.length; j++) {
        const exchangeA = healthyExchanges[i];
        const exchangeB = healthyExchanges[j];
        const returnsA = exchangeReturns.get(exchangeA)!;
        const returnsB = exchangeReturns.get(exchangeB)!;

        console.log(`[Phase 2A] Calculating correlation: ${exchangeA} ↔ ${exchangeB}...`);

        const result = this.calculatePairCorrelation(
          exchangeA,
          returnsA,
          exchangeB,
          returnsB,
          exchangeLiquidity.get(exchangeA)!,
          exchangeLiquidity.get(exchangeB)!,
          exchangeSnapshots.get(exchangeA)!,
          exchangeSnapshots.get(exchangeB)!,
          maxLiquidity,
          maxSnapshots
        );

        results.push(result);

        console.log(
          `[Phase 2A]   → r=${result.correlation.toFixed(3)}, offset=${result.optimalOffsetMs > 0 ? '+' : ''}${result.optimalOffsetMs}ms, weight=${result.weight.toFixed(3)}`
        );
      }
    }

    // Step 5: 平均相関を計算
    const validCorrelations = results
      .map((r) => r.correlation)
      .filter((c) => !isNaN(c) && c > 0);

    const averageCorrelation =
      validCorrelations.length > 0
        ? validCorrelations.reduce((sum, c) => sum + c, 0) / validCorrelations.length
        : 0;

    const matrix: CorrelationMatrix = {
      results,
      healthyExchanges,
      averageCorrelation,
      timestamp: Date.now(),
    };

    this.lastMatrix = matrix;

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[Phase 2A] ✅ Calculated ${results.length} pairs in ${elapsedMs}ms, avg correlation: ${averageCorrelation.toFixed(3)}`
    );

    return matrix;
  }

  /**
   * ペアの相関を計算
   */
  private calculatePairCorrelation(
    exchangeA: string,
    returnsA: PriceReturns,
    exchangeB: string,
    returnsB: PriceReturns,
    liquidityA: number,
    liquidityB: number,
    snapshotsA: number,
    snapshotsB: number,
    maxLiquidity: number,
    maxSnapshots: number
  ): CorrelationResult {
    // 最適オフセットを検索
    const optimal = findOptimalOffset(returnsA, returnsB, this.config);

    // ペアの重みを計算
    const weight = calculatePairWeight(
      optimal.correlation,
      liquidityA,
      liquidityB,
      snapshotsA,
      snapshotsB,
      maxLiquidity,
      maxSnapshots
    );

    return {
      exchangeA,
      exchangeB,
      correlation: optimal.correlation,
      optimalOffsetMs: optimal.offsetMs,
      sampleSize: optimal.sampleSize,
      overlapDurationMs: optimal.overlapMs,
      weight,
      calculatedAt: Date.now(),
    };
  }

  /**
   * 最後に計算した相関行列を取得
   */
  getLastMatrix(): CorrelationMatrix | null {
    return this.lastMatrix;
  }

  /**
   * 設定を取得
   */
  getConfig(): CalibrationConfig {
    return { ...this.config };
  }
}
