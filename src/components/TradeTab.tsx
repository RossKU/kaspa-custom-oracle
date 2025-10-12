import { useState, useEffect } from 'react';
import { TRADE_PASSWORD, SESSION_TIMEOUT } from '../types/trade';
import type { TradeAuthState } from '../types/trade';
import type { PriceData } from '../types/binance';
import type { MexcPriceData } from '../services/mexc';
import type { BybitPriceData } from '../services/bybit';
import type { GateioPriceData } from '../services/gateio';
import type { KucoinPriceData } from '../services/kucoin';
import type { BingXPriceData } from '../services/bingx';
import { logger } from '../utils/logger';

interface TradeTabProps {
  binanceData: PriceData | null;
  mexcData: MexcPriceData | null;
  bybitData: BybitPriceData | null;
  gateioData: GateioPriceData | null;
  kucoinData: KucoinPriceData | null;
  bingxData: BingXPriceData | null;
}

export function TradeTab(props: TradeTabProps) {
  const [authState, setAuthState] = useState<TradeAuthState>({
    isAuthenticated: false,
    lastAuthTime: null,
    sessionTimeout: SESSION_TIMEOUT
  });

  const [passwordInput, setPasswordInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Exchange selection state
  const [exchangeA, setExchangeA] = useState('Bybit');
  const [exchangeB, setExchangeB] = useState('BingX');

  // Get price from exchange name
  const getPrice = (exchange: string): number | null => {
    switch (exchange) {
      case 'Binance': return props.binanceData?.price || null;
      case 'MEXC': return props.mexcData?.price || null;
      case 'Bybit': return props.bybitData?.price || null;
      case 'Gate.io': return props.gateioData?.price || null;
      case 'Kucoin': return props.kucoinData?.price || null;
      case 'BingX': return props.bingxData?.price || null;
      default: return null;
    }
  };

  // Calculate Gap as percentage
  const calculateGap = (priceA: number | null, priceB: number | null): string => {
    if (!priceA || !priceB || priceB === 0) return '--';
    const gap = ((priceA - priceB) / priceB) * 100;
    return gap.toFixed(3);
  };

  // Calculate gaps for both directions
  const priceA = getPrice(exchangeA);
  const priceB = getPrice(exchangeB);
  const gapABuyBSell = calculateGap(priceA, priceB); // A買いB売り
  const gapBBuyASell = calculateGap(priceB, priceA); // B買いA売り

  // Check session timeout
  useEffect(() => {
    if (authState.isAuthenticated && authState.lastAuthTime) {
      const checkTimeout = () => {
        const elapsed = Date.now() - authState.lastAuthTime!;
        if (elapsed > SESSION_TIMEOUT) {
          logger.info('Trade Tab', 'Session expired, logging out');
          setAuthState({
            isAuthenticated: false,
            lastAuthTime: null,
            sessionTimeout: SESSION_TIMEOUT
          });
        }
      };

      const interval = setInterval(checkTimeout, 60000); // Check every minute
      return () => clearInterval(interval);
    }
  }, [authState]);

  const handleLogin = () => {
    if (passwordInput === TRADE_PASSWORD) {
      logger.info('Trade Tab', 'Authentication successful');
      setAuthState({
        isAuthenticated: true,
        lastAuthTime: Date.now(),
        sessionTimeout: SESSION_TIMEOUT
      });
      setPasswordInput('');
      setErrorMessage('');
    } else {
      logger.warn('Trade Tab', 'Authentication failed');
      setErrorMessage('❌ Incorrect password');
      setPasswordInput('');
    }
  };

  const handleLogout = () => {
    logger.info('Trade Tab', 'User logged out');
    setAuthState({
      isAuthenticated: false,
      lastAuthTime: null,
      sessionTimeout: SESSION_TIMEOUT
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  // Login screen
  if (!authState.isAuthenticated) {
    return (
      <section className="tab-content trade-tab">
        <h2>⚡ Trade Execution</h2>

        <div className="auth-container" style={{
          maxWidth: '400px',
          margin: '50px auto',
          padding: '30px',
          border: '2px solid #ffc107',
          borderRadius: '8px',
          backgroundColor: '#fff3cd'
        }}>
          <h3 style={{ textAlign: 'center', marginBottom: '20px' }}>
            🔒 Authentication Required
          </h3>

          <p style={{ textAlign: 'center', color: '#856404', marginBottom: '20px' }}>
            Trading features are protected. Enter password to continue.
          </p>

          <div style={{ marginBottom: '15px' }}>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter password"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '4px'
              }}
              autoFocus
            />
          </div>

          {errorMessage && (
            <div style={{
              padding: '10px',
              marginBottom: '15px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '4px',
              textAlign: 'center'
            }}>
              {errorMessage}
            </div>
          )}

          <button
            onClick={handleLogin}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '16px',
              backgroundColor: '#ffc107',
              color: '#000',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Unlock Trade Tab
          </button>

          <div style={{
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#d1ecf1',
            border: '1px solid #bee5eb',
            borderRadius: '4px',
            fontSize: '14px',
            color: '#0c5460'
          }}>
            <strong>ℹ️ Security Notice:</strong>
            <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
              <li>Session expires after 1 hour of inactivity</li>
              <li>Password: <code>KAS2025Arb</code></li>
              <li>Trading involves real/demo funds - use carefully</li>
            </ul>
          </div>
        </div>
      </section>
    );
  }

  // Authenticated - MT5-style Trade Settings UI
  return (
    <section className="tab-content trade-tab">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Kaspa Trade Settings</h2>
          <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#888' }}>build 2025.10.12</p>
        </div>
        <button onClick={handleLogout} className="btn btn-danger">
          Logout
        </button>
      </div>

      {/* Settings Panel - MT5 Style */}
      <div style={{
        border: '1px solid #ccc',
        borderRadius: '4px',
        padding: '20px',
        backgroundColor: '#f9f9f9',
        fontFamily: 'Arial, sans-serif'
      }}>
        {/* Input Fields Section */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 80px auto', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>発注量:</label>
            <input type="number" defaultValue="100" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>KAS</span>
            <button style={{ padding: '4px 12px', border: '1px solid #999', background: '#eee', cursor: 'pointer' }}>計算</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>最大ポジション:</label>
            <input type="number" defaultValue="500" style={{ padding: '4px', border: '1px solid #ccc' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>最小スプレッド:</label>
            <input type="number" defaultValue="0.2" step="0.1" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>%</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>取引所A:</label>
            <select
              value={exchangeA}
              onChange={(e) => setExchangeA(e.target.value)}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            >
              <option>Binance</option>
              <option>MEXC</option>
              <option>Bybit</option>
              <option>Gate.io</option>
              <option>Kucoin</option>
              <option>BingX</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>取引所B:</label>
            <select
              value={exchangeB}
              onChange={(e) => setExchangeB(e.target.value)}
              style={{ padding: '4px', border: '1px solid #ccc' }}
            >
              <option>Binance</option>
              <option>MEXC</option>
              <option>Bybit</option>
              <option>Gate.io</option>
              <option>Kucoin</option>
              <option>BingX</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 80px 40px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>実行間隔:</label>
            <input type="number" defaultValue="5" style={{ padding: '4px', border: '1px solid #ccc' }} />
            <span>秒</span>
          </div>
        </div>

        {/* Checkboxes Section - 2x4 Grid */}
        <div style={{ marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>リアルタイム監視</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>音声通知</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>手数料を含む</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>自動リバランス</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>自動実行</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" defaultChecked />
            <span>確認ダイアログ</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>履歴記録</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" />
            <span>実行後ログアウト</span>
          </label>
        </div>

        {/* Comparison Settings */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>注文タイプ:</label>
            <select style={{ padding: '4px', border: '1px solid #ccc' }}>
              <option>Market</option>
              <option>Limit</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 60px', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
            <label>タイムアウト:</label>
            <select style={{ padding: '4px', border: '1px solid #ccc' }}>
              <option>1000</option>
              <option>3000</option>
              <option selected>5000</option>
              <option>10000</option>
            </select>
            <span>ms</span>
          </div>
        </div>

        {/* Execution Conditions - MT5 SL Style */}
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '15px', marginTop: '15px' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              SL A買いB売り利用制時:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: '10px', fontSize: '13px' }}>
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% IN</span>
              <input type="number" defaultValue="0" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% OUT</span>
              <input
                type="text"
                value={gapABuyBSell}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  backgroundColor: '#f0f0f0',
                  color: parseFloat(gapABuyBSell) < 0 ? '#dc3545' : parseFloat(gapABuyBSell) > 0 ? '#28a745' : '#666',
                  fontWeight: '600'
                }}
              />
              <span style={{ fontSize: '11px', color: '#666' }}>Gap</span>
              <input type="number" defaultValue="0" style={{ width: '40px', padding: '4px', border: '1px solid #ccc' }} />
              <select style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}>
                <option>300</option>
                <option>600</option>
                <option selected>900</option>
              </select>
              <span style={{ fontSize: '11px', background: '#e9ecef', padding: '4px 8px', border: '1px solid #ccc' }}>S左M両</span>
              <button style={{ padding: '4px 8px', border: '1px solid #999', background: '#d4edda', cursor: 'pointer', fontSize: '11px' }}>自動</button>
            </div>
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
              SL B買いA売り利用制時:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', paddingLeft: '10px', fontSize: '13px' }}>
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% IN</span>
              <input type="number" defaultValue="0" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <input type="number" defaultValue="0.2" step="0.1" style={{ width: '50px', padding: '4px', border: '1px solid #ccc' }} />
              <span>% OUT</span>
              <input
                type="text"
                value={gapBBuyASell}
                readOnly
                style={{
                  width: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  backgroundColor: '#f0f0f0',
                  color: parseFloat(gapBBuyASell) < 0 ? '#dc3545' : parseFloat(gapBBuyASell) > 0 ? '#28a745' : '#666',
                  fontWeight: '600'
                }}
              />
              <span style={{ fontSize: '11px', color: '#666' }}>Gap</span>
              <input type="number" defaultValue="0" style={{ width: '40px', padding: '4px', border: '1px solid #ccc' }} />
              <select style={{ width: '70px', padding: '4px', border: '1px solid #ccc' }}>
                <option>300</option>
                <option>600</option>
                <option selected>900</option>
              </select>
              <span style={{ fontSize: '11px', background: '#e9ecef', padding: '4px 8px', border: '1px solid #ccc' }}>M右S両</span>
              <button style={{ padding: '4px 8px', border: '1px solid #999', background: '#d4edda', cursor: 'pointer', fontSize: '11px' }}>自動</button>
            </div>
          </div>
        </div>
      </div>

      {/* Session Info */}
      <p style={{ marginTop: '15px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
        Session active. Auto-logout in {Math.round((SESSION_TIMEOUT - (Date.now() - authState.lastAuthTime!)) / 60000)} minutes.
      </p>
    </section>
  );
}
