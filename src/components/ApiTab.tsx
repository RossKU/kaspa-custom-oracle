import { useState, useEffect } from 'react';
import BybitAPI from '../services/bybit-api';
import BingXAPI from '../services/bingx-api';
import { logger } from '../utils/logger';

interface ExchangeConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

interface ExchangeStatus {
  connected: boolean;
  message: string;
  balance?: { USDT: number; VST?: number; KAS: number };
}

export function ApiTab() {
  // Separate state for each exchange
  const [bingxConfig, setBingxConfig] = useState<ExchangeConfig>({
    apiKey: '',
    apiSecret: '',
    testnet: true
  });
  const [bybitConfig, setBybitConfig] = useState<ExchangeConfig>({
    apiKey: '',
    apiSecret: '',
    testnet: true
  });

  const [bingxStatus, setBingxStatus] = useState<ExchangeStatus>({
    connected: false,
    message: 'Not connected'
  });
  const [bybitStatus, setBybitStatus] = useState<ExchangeStatus>({
    connected: false,
    message: 'Not connected'
  });

  // Load from localStorage
  useEffect(() => {
    // Load BingX config
    const savedBingx = localStorage.getItem('bingx_api_config');
    if (savedBingx) {
      try {
        const parsed = JSON.parse(savedBingx);
        setBingxConfig(parsed);
      } catch (e) {
        logger.error('API Tab', 'Failed to parse BingX config', { error: e });
      }
    }

    // Load Bybit config
    const savedBybit = localStorage.getItem('bybit_api_config');
    if (savedBybit) {
      try {
        const parsed = JSON.parse(savedBybit);
        setBybitConfig(parsed);
      } catch (e) {
        logger.error('API Tab', 'Failed to parse Bybit config', { error: e });
      }
    }

    // Backward compatibility: Load old single config format
    const oldConfig = localStorage.getItem('apiConfig');
    if (oldConfig && !savedBingx && !savedBybit) {
      try {
        const parsed = JSON.parse(oldConfig);
        if (parsed.exchange === 'bingx') {
          setBingxConfig({
            apiKey: parsed.apiKey,
            apiSecret: parsed.apiSecret,
            testnet: parsed.testnet
          });
        } else if (parsed.exchange === 'bybit') {
          setBybitConfig({
            apiKey: parsed.apiKey,
            apiSecret: parsed.apiSecret,
            testnet: parsed.testnet
          });
        }
        // Migrate to new format
        if (parsed.exchange === 'bingx') {
          localStorage.setItem('bingx_api_config', JSON.stringify({
            apiKey: parsed.apiKey,
            apiSecret: parsed.apiSecret,
            testnet: parsed.testnet
          }));
        } else {
          localStorage.setItem('bybit_api_config', JSON.stringify({
            apiKey: parsed.apiKey,
            apiSecret: parsed.apiSecret,
            testnet: parsed.testnet
          }));
        }
        localStorage.removeItem('apiConfig'); // Clean up old format
      } catch (e) {
        logger.error('API Tab', 'Failed to migrate old config', { error: e });
      }
    }
  }, []);

  // BingX handlers
  const handleBingxSave = () => {
    localStorage.setItem('bingx_api_config', JSON.stringify(bingxConfig));
    setBingxStatus({ connected: false, message: '✅ Saved! Click "Test Connection" to verify.' });
  };

  const handleBingxTest = async () => {
    setBingxStatus({ connected: false, message: '⏳ Testing connection...' });

    if (!bingxConfig.apiKey || !bingxConfig.apiSecret) {
      setBingxStatus({ connected: false, message: '❌ Please enter API Key and Secret' });
      return;
    }

    logger.info('API Tab', 'Testing BingX connection', {
      apiKeyLength: bingxConfig.apiKey.length,
      testnet: bingxConfig.testnet
    });

    try {
      const api = new BingXAPI({
        apiKey: bingxConfig.apiKey.trim(),
        apiSecret: bingxConfig.apiSecret.trim(),
        testnet: bingxConfig.testnet
      });

      const isConnected = await api.testConnection();
      if (!isConnected) {
        setBingxStatus({ connected: false, message: '❌ Connection failed. Check your API credentials.' });
        return;
      }

      const balance = await api.getBalance();
      setBingxStatus({
        connected: true,
        message: '✅ Connected to BingX' + (bingxConfig.testnet ? ' Demo Trading' : ' Production'),
        balance
      });
    } catch (error) {
      logger.error('API Tab', 'BingX connection error', {
        error: error instanceof Error ? error.message : String(error)
      });
      setBingxStatus({
        connected: false,
        message: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

  const handleBingxClear = () => {
    if (confirm('Are you sure you want to clear BingX API keys?')) {
      localStorage.removeItem('bingx_api_config');
      setBingxConfig({ apiKey: '', apiSecret: '', testnet: true });
      setBingxStatus({ connected: false, message: 'API keys cleared' });
    }
  };

  // Bybit handlers
  const handleBybitSave = () => {
    localStorage.setItem('bybit_api_config', JSON.stringify(bybitConfig));
    setBybitStatus({ connected: false, message: '✅ Saved! Click "Test Connection" to verify.' });
  };

  const handleBybitTest = async () => {
    setBybitStatus({ connected: false, message: '⏳ Testing connection...' });

    if (!bybitConfig.apiKey || !bybitConfig.apiSecret) {
      setBybitStatus({ connected: false, message: '❌ Please enter API Key and Secret' });
      return;
    }

    logger.info('API Tab', 'Testing Bybit connection', {
      apiKeyLength: bybitConfig.apiKey.length,
      testnet: bybitConfig.testnet
    });

    try {
      const api = new BybitAPI({
        apiKey: bybitConfig.apiKey.trim(),
        apiSecret: bybitConfig.apiSecret.trim(),
        testnet: bybitConfig.testnet
      });

      const isConnected = await api.testConnection();
      if (!isConnected) {
        setBybitStatus({ connected: false, message: '❌ Connection failed. Check your API credentials.' });
        return;
      }

      const balance = await api.getBalance();
      setBybitStatus({
        connected: true,
        message: `✅ Connected to Bybit ${bybitConfig.testnet ? 'Demo Trading' : 'Production'}`,
        balance
      });
    } catch (error) {
      logger.error('API Tab', 'Bybit connection error', {
        error: error instanceof Error ? error.message : String(error)
      });
      setBybitStatus({
        connected: false,
        message: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

  const handleBybitClear = () => {
    if (confirm('Are you sure you want to clear Bybit API keys?')) {
      localStorage.removeItem('bybit_api_config');
      setBybitConfig({ apiKey: '', apiSecret: '', testnet: true });
      setBybitStatus({ connected: false, message: 'API keys cleared' });
    }
  };

  return (
    <section className="tab-content api-tab">
      <h2>📡 API Connection Management</h2>
      <p style={{ marginBottom: '25px', color: '#666' }}>
        Configure multiple exchanges simultaneously. Each exchange has independent API settings.
      </p>

      {/* BingX Configuration Section */}
      <div style={{
        marginBottom: '30px',
        border: '2px solid #1890ff',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#1890ff' }}>
          📊 BingX Configuration
        </h3>

        <div className="api-config-box">
          <div className="form-group">
            <label>API Key:</label>
            <input
              type="password"
              value={bingxConfig.apiKey}
              onChange={(e) => setBingxConfig({ ...bingxConfig, apiKey: e.target.value })}
              placeholder="Enter your BingX API key"
            />
          </div>

          <div className="form-group">
            <label>Secret Key:</label>
            <input
              type="password"
              value={bingxConfig.apiSecret}
              onChange={(e) => setBingxConfig({ ...bingxConfig, apiSecret: e.target.value })}
              placeholder="Enter your BingX secret key"
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={bingxConfig.testnet}
                onChange={(e) => setBingxConfig({ ...bingxConfig, testnet: e.target.checked })}
              />
              Use Demo Trading (Recommended)
            </label>
          </div>
        </div>

        <div className="button-group">
          <button onClick={handleBingxTest} className="btn btn-primary">
            Test Connection
          </button>
          <button onClick={handleBingxSave} className="btn btn-success">
            Save
          </button>
          <button onClick={handleBingxClear} className="btn btn-danger">
            Clear Keys
          </button>
        </div>

        <div className={`status-box ${bingxStatus.connected ? 'connected' : ''}`}>
          <h4>Status</h4>
          <p>{bingxStatus.message}</p>
          {bingxStatus.balance && (
            <>
              {bingxStatus.balance.USDT > 0 && (
                <p>USDT Balance: {bingxStatus.balance.USDT.toLocaleString()}</p>
              )}
              {bingxStatus.balance.VST !== undefined && bingxStatus.balance.VST > 0 && (
                <p>VST Balance (Demo): {bingxStatus.balance.VST.toLocaleString()}</p>
              )}
              <p>KAS Position: {bingxStatus.balance.KAS.toLocaleString()}</p>
            </>
          )}
        </div>

        <div className="info-box">
          <h4>ℹ️ How to get BingX API keys:</h4>
          <ol>
            <li>Go to <a href="https://bingx.com" target="_blank" rel="noopener noreferrer">BingX</a></li>
            <li>Create an account (free)</li>
            <li>For Demo: Click "Demo Trading" in top right → API Management</li>
            <li>Create new API key with "Contract Trading" permission</li>
            <li>Copy API Key and Secret here</li>
          </ol>
          <p className="warning">
            ⚠️ Never share your API keys! They are stored locally in your browser.
          </p>
        </div>
      </div>

      {/* Bybit Configuration Section */}
      <div style={{
        marginBottom: '30px',
        border: '2px solid #6f42c1',
        borderRadius: '8px',
        padding: '20px',
        backgroundColor: '#f8f9fa'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px', color: '#6f42c1' }}>
          🟣 Bybit Configuration
        </h3>

        <div className="api-config-box">
          <div className="form-group">
            <label>API Key:</label>
            <input
              type="password"
              value={bybitConfig.apiKey}
              onChange={(e) => setBybitConfig({ ...bybitConfig, apiKey: e.target.value })}
              placeholder="Enter your Bybit API key"
            />
          </div>

          <div className="form-group">
            <label>Secret Key:</label>
            <input
              type="password"
              value={bybitConfig.apiSecret}
              onChange={(e) => setBybitConfig({ ...bybitConfig, apiSecret: e.target.value })}
              placeholder="Enter your Bybit secret key"
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={bybitConfig.testnet}
                onChange={(e) => setBybitConfig({ ...bybitConfig, testnet: e.target.checked })}
              />
              Use Demo Trading (Recommended)
            </label>
          </div>
        </div>

        <div className="button-group">
          <button onClick={handleBybitTest} className="btn btn-primary">
            Test Connection
          </button>
          <button onClick={handleBybitSave} className="btn btn-success">
            Save
          </button>
          <button onClick={handleBybitClear} className="btn btn-danger">
            Clear Keys
          </button>
        </div>

        <div className={`status-box ${bybitStatus.connected ? 'connected' : ''}`}>
          <h4>Status</h4>
          <p>{bybitStatus.message}</p>
          {bybitStatus.balance && (
            <>
              <p>USDT Balance: {bybitStatus.balance.USDT.toLocaleString()}</p>
              {bybitStatus.balance.VST !== undefined && bybitStatus.balance.VST > 0 && (
                <p>VST Balance: {bybitStatus.balance.VST.toLocaleString()}</p>
              )}
              <p>KAS Position: {bybitStatus.balance.KAS.toLocaleString()}</p>
            </>
          )}
        </div>

        <div className="info-box">
          <h4>ℹ️ How to get Bybit Demo Trading API keys:</h4>
          <ol>
            <li>Go to <a href="https://www.bybit.com" target="_blank" rel="noopener noreferrer">Bybit</a></li>
            <li>Create an account (free)</li>
            <li>Switch to <strong>Demo Trading</strong> mode (hover on profile → Demo Trading)</li>
            <li>Go to API Management</li>
            <li>Create new API key with these permissions:
              <ul>
                <li>✅ Contract - Trade</li>
                <li>✅ Contract - Order & Position</li>
                <li>✅ Unified Trading - Trade</li>
              </ul>
            </li>
            <li>⏳ Wait 2-3 minutes for activation</li>
            <li>Copy API Key and Secret here</li>
          </ol>
          <p className="warning">
            ⚠️ Never share your API keys! They are stored locally in your browser.
          </p>
          <p style={{marginTop: '1rem', fontSize: '0.9rem', color: '#666'}}>
            💡 Demo Trading uses virtual funds (50,000 USDT) - perfect for safe testing!
          </p>
        </div>
      </div>

      {/* Coming Soon Section */}
      <div style={{
        padding: '20px',
        backgroundColor: '#e9ecef',
        borderRadius: '8px',
        border: '1px dashed #adb5bd'
      }}>
        <h4 style={{ marginTop: 0, color: '#6c757d' }}>🚀 Coming Soon</h4>
        <ul style={{ color: '#6c757d' }}>
          <li>Binance API Configuration</li>
          <li>MEXC API Configuration</li>
          <li>Gate.io API Configuration</li>
        </ul>
      </div>
    </section>
  );
}
