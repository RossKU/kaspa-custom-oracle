/**
 * Phase 2A: Correlation Calculation Utilities
 * Core mathematical functions for price correlation analysis
 */

import type { PriceSnapshot } from '../types/lending-oracle';
import type { PriceReturns, CalibrationConfig } from '../types/correlation';

/**
 * 価格スナップショット → 価格変化率（returns）
 * clientTimestampベースで計算
 */
export function calculatePriceReturns(
  snapshots: PriceSnapshot[],
  exchangeName: string
): PriceReturns | null {
  if (snapshots.length < 2) return null;

  const returns: number[] = [];
  const timestamps: number[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prevPrice = snapshots[i - 1].price;
    const currPrice = snapshots[i].price;

    // 価格変化率: (p[i] - p[i-1]) / p[i-1]
    const priceReturn = (currPrice - prevPrice) / prevPrice;

    returns.push(priceReturn);
    timestamps.push(snapshots[i].clientTimestamp);
  }

  return {
    exchange: exchangeName,
    returns,
    timestamps,
    sampleCount: returns.length,
  };
}

/**
 * ピアソン相関係数を計算
 * r = Σ[(Xi - X̄)(Yi - Ȳ)] / √[Σ(Xi - X̄)² · Σ(Yi - Ȳ)²]
 *
 * @returns 相関係数（-1.0 ~ 1.0）、計算不可の場合は0
 */
export function pearsonCorrelation(
  dataA: number[],
  dataB: number[]
): number {
  // データ長チェック
  if (dataA.length !== dataB.length || dataA.length === 0) {
    return 0;
  }

  const n = dataA.length;

  // 平均値を計算
  const meanA = dataA.reduce((sum, val) => sum + val, 0) / n;
  const meanB = dataB.reduce((sum, val) => sum + val, 0) / n;

  // 共分散と分散を計算
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;

  for (let i = 0; i < n; i++) {
    const diffA = dataA[i] - meanA;
    const diffB = dataB[i] - meanB;

    covariance += diffA * diffB;
    varianceA += diffA * diffA;
    varianceB += diffB * diffB;
  }

  // 標準偏差の積
  const denominator = Math.sqrt(varianceA * varianceB);

  // ゼロ除算チェック
  if (denominator === 0) return 0;

  // 相関係数
  return covariance / denominator;
}

/**
 * 時間オフセット適用して重複範囲のデータを抽出・整列
 *
 * @param returnsA 取引所Aの価格変化率
 * @param returnsB 取引所Bの価格変化率
 * @param offsetMs Bに適用するオフセット（ms）正の値=Bを遅らせる
 * @returns 整列されたデータペアと重複期間
 */
export function alignReturnsWithOffset(
  returnsA: PriceReturns,
  returnsB: PriceReturns,
  offsetMs: number
): { alignedA: number[]; alignedB: number[]; overlapMs: number } | null {
  // Bのタイムスタンプにオフセットを適用
  const timestampsBShifted = returnsB.timestamps.map(t => t + offsetMs);

  // 重複範囲を計算
  const overlapStart = Math.max(
    returnsA.timestamps[0],
    timestampsBShifted[0]
  );
  const overlapEnd = Math.min(
    returnsA.timestamps[returnsA.timestamps.length - 1],
    timestampsBShifted[timestampsBShifted.length - 1]
  );

  const overlapMs = overlapEnd - overlapStart;

  // 重複がない場合
  if (overlapMs < 0) return null;

  // 重複範囲のデータを抽出
  const alignedA: number[] = [];
  const alignedB: number[] = [];

  let idxA = 0;
  let idxB = 0;

  const TIME_TOLERANCE_MS = 100; // 100ms以内なら同じタイミングとみなす

  while (idxA < returnsA.timestamps.length && idxB < timestampsBShifted.length) {
    const timeA = returnsA.timestamps[idxA];
    const timeB = timestampsBShifted[idxB];

    // 時刻の差
    const timeDiff = Math.abs(timeA - timeB);

    if (timeDiff < TIME_TOLERANCE_MS) {
      // 重複範囲内のデータのみ追加
      if (timeA >= overlapStart && timeA <= overlapEnd) {
        alignedA.push(returnsA.returns[idxA]);
        alignedB.push(returnsB.returns[idxB]);
      }
      idxA++;
      idxB++;
    } else if (timeA < timeB) {
      idxA++;
    } else {
      idxB++;
    }
  }

  return {
    alignedA,
    alignedB,
    overlapMs
  };
}

/**
 * 最適オフセットを検索（相関最大化）
 *
 * @returns 最適オフセット、最大相関、サンプルサイズ
 */
export function findOptimalOffset(
  returnsA: PriceReturns,
  returnsB: PriceReturns,
  config: CalibrationConfig
): { offsetMs: number; correlation: number; sampleSize: number; overlapMs: number } {
  let maxCorrelation = -1;
  let optimalOffsetMs = 0;
  let bestSampleSize = 0;
  let bestOverlapMs = 0;

  // オフセット範囲をスキャン: -3000ms ~ +3000ms を 50ms刻み
  for (
    let offset = -config.offsetRangeMs;
    offset <= config.offsetRangeMs;
    offset += config.offsetStepMs
  ) {
    const aligned = alignReturnsWithOffset(returnsA, returnsB, offset);

    if (!aligned) continue;

    // 最低条件チェック
    if (aligned.overlapMs < config.minOverlapMs) continue;
    if (aligned.alignedA.length < config.minSampleSize) continue;

    // 相関計算
    const correlation = pearsonCorrelation(aligned.alignedA, aligned.alignedB);

    // 最大相関を更新
    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
      optimalOffsetMs = offset;
      bestSampleSize = aligned.alignedA.length;
      bestOverlapMs = aligned.overlapMs;
    }
  }

  return {
    offsetMs: optimalOffsetMs,
    correlation: maxCorrelation,
    sampleSize: bestSampleSize,
    overlapMs: bestOverlapMs,
  };
}

/**
 * ペアの重みを計算
 *
 * 重み = 基本相関 × 0.5 + 流動性 × 0.3 + データ品質 × 0.2
 */
export function calculatePairWeight(
  baselineCorrelation: number,
  liquidityA: number,
  liquidityB: number,
  snapshotsA: number,
  snapshotsB: number,
  maxLiquidity: number,
  maxSnapshots: number
): number {
  // 基本相関の重み（0.5）
  const weightCorrelation = Math.max(0, baselineCorrelation) * 0.5;

  // 流動性の重み（0.3）
  const avgLiquidity = (liquidityA + liquidityB) / 2;
  const normalizedLiquidity = maxLiquidity > 0 ? avgLiquidity / maxLiquidity : 0;
  const weightLiquidity = normalizedLiquidity * 0.3;

  // データ品質の重み（0.2）
  const avgSnapshots = (snapshotsA + snapshotsB) / 2;
  const normalizedQuality = maxSnapshots > 0 ? avgSnapshots / maxSnapshots : 0;
  const weightQuality = normalizedQuality * 0.2;

  return weightCorrelation + weightLiquidity + weightQuality;
}
