/**
 * Lending Oracle Type Definitions
 * Phase 1: Data Collection Infrastructure
 */

/**
 * 価格スナップショット（100ms間隔で記録）
 */
export interface PriceSnapshot {
  /** 価格 */
  price: number;

  /** クライアント受信時刻（ms） */
  clientTimestamp: number;

  /** サーバー時刻（取引所提供、ms） */
  serverTimestamp: number;

  /** 出来高（この時点での累積または瞬間値） */
  volume?: number;
}

/**
 * 価格履歴バッファ（循環バッファ）
 * 過去1分間の価格スナップショットを保持（オフセット計算用）
 */
export interface PriceHistory {
  /** スナップショット配列（最大サイズに達したら古いものから削除） */
  snapshots: PriceSnapshot[];

  /** 最大保持数（デフォルト: 600 = 1分間 @ 100ms間隔） */
  maxSize: number;

  /** 最後の追加時刻 */
  lastUpdateTime: number;
}

/**
 * 出来高統計（Rolling統計）
 */
export interface VolumeStats {
  /** 出来高の移動平均 */
  mean: number;

  /** 出来高の標準偏差 */
  stdDev: number;

  /** サンプル数 */
  sampleCount: number;

  /** 最小値 */
  min: number;

  /** 最大値 */
  max: number;

  /** 最終更新時刻 */
  lastUpdate: number;
}

/**
 * 取引所データ（Phase 1拡張版）
 */
export interface ExchangeDataPhase1 {
  /** 取引所名 */
  exchange: string;

  /** 現在価格 */
  currentPrice: number;

  /** 最終更新時刻 */
  lastUpdate: number;

  /** 価格履歴（Phase 1で追加） */
  priceHistory: PriceHistory;

  /** 出来高統計（Phase 1で追加） */
  volumeStats: VolumeStats;

  /** 推定Ping（ms、後のフェーズで使用） */
  estimatedPing?: number;
}

/**
 * Phase 1のデータ収集状態
 */
export interface Phase1CollectionState {
  /** データ収集開始時刻 */
  startTime: number;

  /** 収集されたスナップショット総数 */
  totalSnapshots: number;

  /** 各取引所の収集状態 */
  exchanges: {
    [key: string]: {
      snapshotCount: number;
      lastSnapshot: number;
      isCollecting: boolean;
    };
  };
}

/**
 * 価格履歴バッファを作成
 */
export function createPriceHistory(maxSize: number = 600): PriceHistory {
  return {
    snapshots: [],
    maxSize,
    lastUpdateTime: 0,
  };
}

/**
 * 価格履歴にスナップショットを追加
 */
export function addSnapshot(
  history: PriceHistory,
  snapshot: PriceSnapshot
): void {
  history.snapshots.push(snapshot);
  history.lastUpdateTime = snapshot.clientTimestamp;

  // 最大サイズを超えたら古いものから削除
  if (history.snapshots.length > history.maxSize) {
    history.snapshots.shift();
  }
}

/**
 * 空の出来高統計を作成
 */
export function createVolumeStats(): VolumeStats {
  return {
    mean: 0,
    stdDev: 0,
    sampleCount: 0,
    min: Infinity,
    max: -Infinity,
    lastUpdate: 0,
  };
}

/**
 * 出来高統計を更新（オンラインアルゴリズム）
 * @deprecated Use calculateVolumeStatsFromTrades instead for 60-second window
 */
export function updateVolumeStats(
  stats: VolumeStats,
  newVolume: number,
  timestamp: number
): void {
  const n = stats.sampleCount + 1;
  const delta = newVolume - stats.mean;
  const newMean = stats.mean + delta / n;
  const delta2 = newVolume - newMean;

  // Welford's online algorithm for variance
  const newVariance = stats.sampleCount === 0
    ? 0
    : ((stats.stdDev ** 2) * stats.sampleCount + delta * delta2) / n;

  stats.mean = newMean;
  stats.stdDev = Math.sqrt(newVariance);
  stats.sampleCount = n;
  stats.min = Math.min(stats.min, newVolume);
  stats.max = Math.max(stats.max, newVolume);
  stats.lastUpdate = timestamp;
}

/**
 * 60秒窓の取引データから出来高統計を計算
 * VWAP計算のweight用
 */
export function calculateVolumeStatsFromTrades(
  trades: Array<{ volume: number; timestamp: number }>
): VolumeStats {
  if (trades.length === 0) {
    return createVolumeStats();
  }

  const volumes = trades.map(t => t.volume);
  const sum = volumes.reduce((acc, v) => acc + v, 0);
  const mean = sum / volumes.length;

  // Calculate variance
  const variance = volumes.reduce((acc, v) => acc + (v - mean) ** 2, 0) / volumes.length;
  const stdDev = Math.sqrt(variance);

  const min = Math.min(...volumes);
  const max = Math.max(...volumes);

  return {
    mean,
    stdDev,
    sampleCount: volumes.length,
    min,
    max,
    lastUpdate: Date.now(),
  };
}

/**
 * z-scoreを計算
 */
export function calculateZScore(value: number, stats: VolumeStats): number {
  if (stats.stdDev === 0 || stats.sampleCount < 2) {
    return 0;
  }
  return (value - stats.mean) / stats.stdDev;
}
