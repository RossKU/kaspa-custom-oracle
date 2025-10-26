// Oracle Price Calculation Types
// Based on Chainlink's 3-layer aggregation methodology

/**
 * Oracle価格計算の結果
 * Chainlink方式のMedian計算に基づく
 */
export interface OracleResult {
  /** Oracle価格（Median） */
  price: number;

  /** 信頼度レベル */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  /** 有効なデータソース数 */
  validSources: number;

  /** 最低価格 */
  lowestPrice: number;

  /** 最高価格 */
  highestPrice: number;

  /** 価格スプレッド（%） */
  spreadPercent: number;

  /** 計算タイムスタンプ */
  timestamp: number;
}

/**
 * Oracle計算設定
 */
export interface OracleConfig {
  /** データの最大許容遅延（ms）デフォルト: 5000 */
  maxStalenessMs?: number;

  /** 最低必要データソース数 デフォルト: 3 */
  minSources?: number;

  /** HIGH信頼度の条件: 最小データソース数 デフォルト: 6 */
  highConfidenceMinSources?: number;

  /** HIGH信頼度の条件: 最大スプレッド% デフォルト: 0.5 */
  highConfidenceMaxSpread?: number;

  /** MEDIUM信頼度の条件: 最小データソース数 デフォルト: 4 */
  mediumConfidenceMinSources?: number;

  /** MEDIUM信頼度の条件: 最大スプレッド% デフォルト: 1.0 */
  mediumConfidenceMaxSpread?: number;
}

/**
 * 各取引所の価格データ（共通インターフェース）
 */
export interface ExchangePriceSource {
  /** 取引所名 */
  exchange: string;

  /** 現在価格 */
  price: number;

  /** 最終更新タイムスタンプ */
  lastUpdate: number;

  /** データが有効かどうか */
  isValid: boolean;
}

/**
 * 取引データ（VWAP計算用）
 * WebSocketから受信した個別取引の情報
 */
export interface MarketTrade {
  /** 取引価格 */
  price: number;

  /** 取引数量（出来高） */
  volume: number;

  /** 取引時刻（ミリ秒） */
  timestamp: number;

  /** 買い手が maker かどうか（オプション） */
  isBuyerMaker?: boolean;

  /** 取引ID（オプション） */
  tradeId?: string | number;
}

/**
 * 時間範囲内の取引データをフィルタリング
 * @param trades 全取引データ
 * @param windowMs ウィンドウサイズ（ミリ秒）
 * @returns フィルタ後の取引データ
 */
export function filterTradesByTime(
  trades: MarketTrade[],
  windowMs: number
): MarketTrade[] {
  const now = Date.now();
  const cutoffTime = now - windowMs;

  return trades.filter(trade => trade.timestamp >= cutoffTime);
}

/**
 * 古い取引データをクリーンアップ（破壊的変更）
 * @param trades 取引データ配列
 * @param windowMs ウィンドウサイズ（ミリ秒）
 */
export function cleanupOldTrades(
  trades: MarketTrade[],
  windowMs: number
): void {
  const now = Date.now();
  const cutoffTime = now - windowMs;

  // 古いデータを削除（配列の先頭から）
  let removeCount = 0;
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].timestamp < cutoffTime) {
      removeCount++;
    } else {
      break; // 時系列順なので、新しいデータに到達したら終了
    }
  }

  if (removeCount > 0) {
    trades.splice(0, removeCount);
  }
}

/**
 * VWAP (Volume Weighted Average Price) を計算
 *
 * Chainlink方式: VWAP = Σ(price_i × volume_i) / Σ(volume_i)
 *
 * @param trades 取引データ配列
 * @param minTrades 最低取引数（デフォルト: 3）
 * @returns VWAP価格、または取引データ不足の場合null
 */
export function calculateVWAP(
  trades: MarketTrade[],
  minTrades: number = 3
): number | null {
  // 取引データが不足している場合
  if (!trades || trades.length < minTrades) {
    return null;
  }

  let totalValue = 0;  // Σ(price × volume)
  let totalVolume = 0; // Σ(volume)

  for (const trade of trades) {
    totalValue += trade.price * trade.volume;
    totalVolume += trade.volume;
  }

  // 出来高がゼロの場合
  if (totalVolume === 0) {
    return null;
  }

  return totalValue / totalVolume;
}
