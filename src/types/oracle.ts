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
