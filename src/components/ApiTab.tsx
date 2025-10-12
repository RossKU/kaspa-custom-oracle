import { useState, useEffect } from 'react';
import BybitAPI from '../services/bybit-api';

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

    try {
      const api = new BybitAPI({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        testnet: config.testnet
      });

      // Test connection
      const isConnected = await api.testConnection();

      if (!isConnected) {
        setStatus({ connected: false, message: '❌ Connection failed. Check your API credentials.' });
        return;
      }

      // Get balance
      const balance = await api.getBalance();

      setStatus({
        connected: true,
        message: `✅ Connected to Bybit ${config.testnet ? 'Testnet' : 'Mainnet'}`,
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
            Use Testnet (Demo Trading - Recommended)
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

      <div className="info-box">
        <h4>ℹ️ How to get Bybit API keys:</h4>
        <ol>
          <li>Go to <a href="https://testnet.bybit.com" target="_blank" rel="noopener noreferrer">Bybit Testnet</a></li>
          <li>Create an account (free, no KYC required)</li>
          <li>Go to API Management</li>
          <li>Create new API key with "Trade" permission</li>
          <li>Copy API Key and Secret here</li>
        </ol>
        <p className="warning">
          ⚠️ Never share your API keys! They are stored locally in your browser.
        </p>
      </div>
    </section>
  );
}
