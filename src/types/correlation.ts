/**
 * Phase 2A: Correlation Type Definitions
 * Pairwise correlation calculation for exchange synchronization
 */

/**
 * 価格変化率（returns）
 * clientTimestampベースで計算
 */
export interface PriceReturns {
  exchange: string;
  returns: number[];        // [(p[i]-p[i-1])/p[i-1], ...]
  timestamps: number[];     // clientTimestamp配列
  sampleCount: number;
}

/**
 * 相関計算結果（取引所ペア）
 */
export interface CorrelationResult {
  exchangeA: string;
  exchangeB: string;
  correlation: number;          // -1.0 ~ 1.0
  optimalOffsetMs: number;      // clientTimestamp基準のオフセット（ms）
  sampleSize: number;           // 使用サンプル数
  overlapDurationMs: number;    // 重複期間（ms）
  weight: number;               // ペアの重み（0~1）
  calculatedAt: number;         // 計算時刻
}

/**
 * 相関行列（全ペア）
 */
export interface CorrelationMatrix {
  results: CorrelationResult[]; // N個のペア結果
  healthyExchanges: string[];   // 健全な取引所リスト
  averageCorrelation: number;   // 平均相関
  timestamp: number;            // 計算時刻
}

/**
 * キャリブレーション設定
 */
export interface CalibrationConfig {
  offsetRangeMs: number;        // ±3000ms
  offsetStepMs: number;         // 50ms刻み
  minOverlapMs: number;         // 最低45秒の重複
  minSampleSize: number;        // 最低450サンプル（45秒分）
  healthCheckTimeoutMs: number; // 5秒
}

/**
 * デフォルト設定
 */
export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  offsetRangeMs: 3000,          // ±3秒
  offsetStepMs: 50,             // 50ms刻み（121ステップ）
  minOverlapMs: 45000,          // 45秒
  minSampleSize: 450,           // 450サンプル（45秒@100ms）
  healthCheckTimeoutMs: 5000,   // 5秒
};
