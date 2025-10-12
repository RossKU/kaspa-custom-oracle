import { useState, useEffect } from 'react';
import BybitAPI from '../services/bybit-api';
import BingXAPI from '../services/bingx-api';
import { logger } from '../utils/logger';

interface ApiConfig {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

export function ApiTab() {
  const [config, setConfig] = useState<ApiConfig>({
    exchange: 'bybit',
    apiKey: '',
    apiSecret: '',
    testnet: true
  });
  const [status, setStatus] = useState<{
    connected: boolean;
    message: string;
    balance?: { USDT: number; KAS: number };
  }>({
    connected: false,
    message: 'Not connected'
  });

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('apiConfig');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig(parsed);
      } catch (e) {
        // Invalid saved data
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('apiConfig', JSON.stringify(config));
    setStatus({ connected: false, message: '✅ Saved! Click "Test Connection" to verify.' });
  };

  const handleTestConnection = async () => {
    setStatus({ connected: false, message: '⏳ Testing connection...' });

    if (!config.apiKey || !config.apiSecret) {
      setStatus({ connected: false, message: '❌ Please enter API Key and Secret' });
      return;
    }

    logger.info('API Tab', 'Starting connection test', {
      apiKeyLength: config.apiKey.length,
      apiKeyFirst8: config.apiKey.substring(0, 8),
      apiKeyLast4: config.apiKey.substring(config.apiKey.length - 4),
      secretKeyLength: config.apiSecret.length,
      secretKeyFirst4: config.apiSecret.substring(0, 4),
      secretKeyLast4: config.apiSecret.substring(config.apiSecret.length - 4),
      testnet: config.testnet,
      exchange: config.exchange
    });

    // Log potential whitespace issues
    const hasLeadingSpaceKey = config.apiKey !== config.apiKey.trim();
    const hasLeadingSpaceSecret = config.apiSecret !== config.apiSecret.trim();
    if (hasLeadingSpaceKey || hasLeadingSpaceSecret) {
      logger.warn('API Tab', 'Whitespace detected in API keys!', {
        hasLeadingSpaceKey,
        hasLeadingSpaceSecret
      });
    }

    try {
      // Create API instance based on selected exchange
      let api: BybitAPI | BingXAPI;
      let exchangeName: string;

      if (config.exchange === 'bingx') {
        api = new BingXAPI({
          apiKey: config.apiKey.trim(),
          apiSecret: config.apiSecret.trim(),
          testnet: config.testnet
        });
        exchangeName = 'BingX';
      } else {
        // Default to Bybit
        api = new BybitAPI({
          apiKey: config.apiKey.trim(),
          apiSecret: config.apiSecret.trim(),
          testnet: config.testnet
        });
        exchangeName = 'Bybit';
      }

      // Test connection
      const isConnected = await api.testConnection();

      if (!isConnected) {
        setStatus({ connected: false, message: '❌ Connection failed. Check your API credentials.' });
        return;
      }

      // Get balance
      const balance = await api.getBalance();

      // Create connection message based on exchange and testnet
      let message = `✅ Connected to ${exchangeName}`;
      if (config.exchange === 'bybit') {
        message += ` ${config.testnet ? 'Demo Trading' : 'Production'}`;
      } else if (config.exchange === 'bingx') {
        message += config.testnet ? ' (Note: BingX has no testnet, using Production)' : ' Production';
      }

      setStatus({
        connected: true,
        message,
        balance
      });
    } catch (error) {
      console.error('Connection test error:', error);
      setStatus({
        connected: false,
        message: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  };

  const handleClearKeys = () => {
    if (confirm('Are you sure you want to clear all API keys?')) {
      localStorage.removeItem('apiConfig');
      setConfig({
        exchange: 'bybit',
        apiKey: '',
        apiSecret: '',
        testnet: true
      });
      setStatus({ connected: false, message: 'API keys cleared' });
    }
  };

  return (
    <section className="tab-content api-tab">
      <h2>📡 API Connection Management</h2>

      <div className="form-group">
        <label>Select Exchange:</label>
        <select
          value={config.exchange}
          onChange={(e) => setConfig({ ...config, exchange: e.target.value })}
        >
          <option value="bybit">Bybit</option>
          <option value="bingx">BingX</option>
          <option value="binance" disabled>Binance (Coming Soon)</option>
          <option value="mexc" disabled>MEXC (Coming Soon)</option>
        </select>
      </div>

      <div className="api-config-box">
        <h3>API Configuration</h3>

        <div className="form-group">
          <label>API Key:</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder="Enter your API key"
          />
        </div>

        <div className="form-group">
          <label>Secret Key:</label>
          <input
            type="password"
            value={config.apiSecret}
            onChange={(e) => setConfig({ ...config, apiSecret: e.target.value })}
            placeholder="Enter your secret key"
          />
        </div>

        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={config.testnet}
              onChange={(e) => setConfig({ ...config, testnet: e.target.checked })}
            />
            Use Demo Trading (Recommended)
          </label>
        </div>
      </div>

      <div className="button-group">
        <button onClick={handleTestConnection} className="btn btn-primary">
          Test Connection
        </button>
        <button onClick={handleSave} className="btn btn-success">
          Save
        </button>
        <button onClick={handleClearKeys} className="btn btn-danger">
          Clear All Keys
        </button>
      </div>

      <div className={`status-box ${status.connected ? 'connected' : ''}`}>
        <h3>Status</h3>
        <p>{status.message}</p>
        {status.balance && (
          <>
            <p>USDT Balance: {status.balance.USDT.toLocaleString()}</p>
            <p>KAS Position: {status.balance.KAS.toLocaleString()}</p>
          </>
        )}
      </div>

      {config.exchange === 'bybit' && (
        <div className="info-box">
          <h4>ℹ️ How to get Bybit Demo Trading API keys:</h4>
          <ol>
            <li>Go to <a href="https://www.bybit.com" target="_blank" rel="noopener noreferrer">Bybit</a> (Production site)</li>
            <li>Create an account (free)</li>
            <li>Switch to <strong>Demo Trading</strong> mode (hover on profile → Demo Trading)</li>
            <li>Go to API Management</li>
            <li>Create new API key with "Contract Account" or "Unified Trading" permission</li>
            <li>Copy API Key and Secret here</li>
            <li>Check "Use Demo Trading" checkbox above</li>
          </ol>
          <p className="warning">
            ⚠️ Never share your API keys! They are stored locally in your browser.
          </p>
          <p style={{marginTop: '1rem', fontSize: '0.9rem', color: '#666'}}>
            💡 Demo Trading uses virtual funds but real market liquidity - perfect for safe testing!
          </p>
        </div>
      )}

      {config.exchange === 'bingx' && (
        <div className="info-box">
          <h4>ℹ️ How to get BingX API keys:</h4>
          <ol>
            <li>Go to <a href="https://bingx.com" target="_blank" rel="noopener noreferrer">BingX</a></li>
            <li>Create an account (free, KYC may be required for trading)</li>
            <li>Go to Account → API Management</li>
            <li>Create new API key with "Contract Trading" permission</li>
            <li>Set IP whitelist for additional security (optional)</li>
            <li>Copy API Key and Secret here</li>
          </ol>
          <p className="warning">
            ⚠️ Never share your API keys! They are stored locally in your browser.
          </p>
          <p style={{marginTop: '1rem', fontSize: '0.9rem', color: '#f39c12'}}>
            ⚠️ BingX does not offer a testnet. The "Use Demo Trading" checkbox has no effect. Test with small amounts!
          </p>
        </div>
      )}
    </section>
  );
}
