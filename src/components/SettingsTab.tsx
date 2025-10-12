import { useState, useEffect } from 'react';

interface Settings {
  autoRefresh: boolean;
  showArbitrageAlerts: boolean;
  soundNotifications: boolean;
  minSpread: number;
  maxPosition: number;
  autoTrade: boolean;
}

export function SettingsTab() {
  const [settings, setSettings] = useState<Settings>({
    autoRefresh: true,
    showArbitrageAlerts: true,
    soundNotifications: false,
    minSpread: 2.0,
    maxPosition: 1000,
    autoTrade: false
  });

  // Load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        // Invalid saved data
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('appSettings', JSON.stringify(settings));
    alert('✅ Settings saved!');
  };

  const handleReset = () => {
    if (confirm('Reset all settings to default?')) {
      const defaults: Settings = {
        autoRefresh: true,
        showArbitrageAlerts: true,
        soundNotifications: false,
        minSpread: 2.0,
        maxPosition: 1000,
        autoTrade: false
      };
      setSettings(defaults);
      localStorage.setItem('appSettings', JSON.stringify(defaults));
    }
  };

  return (
    <section className="tab-content settings-tab">
      <h2>⚙️ Settings</h2>

      <div className="settings-group">
        <h3>Display</h3>
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={(e) => setSettings({ ...settings, autoRefresh: e.target.checked })}
            />
            Auto-refresh prices
          </label>
        </div>
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.showArbitrageAlerts}
              onChange={(e) => setSettings({ ...settings, showArbitrageAlerts: e.target.checked })}
            />
            Show price spread alerts
          </label>
        </div>
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.soundNotifications}
              onChange={(e) => setSettings({ ...settings, soundNotifications: e.target.checked })}
            />
            Sound notifications
          </label>
        </div>
      </div>

      <div className="settings-group">
        <h3>Trading</h3>
        <div className="form-group">
          <label>Minimum Spread (%):</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="10"
            value={settings.minSpread}
            onChange={(e) => setSettings({ ...settings, minSpread: parseFloat(e.target.value) })}
          />
          <small>Only show opportunities with spread above this threshold</small>
        </div>
        <div className="form-group">
          <label>Maximum Position (KAS):</label>
          <input
            type="number"
            step="100"
            min="0"
            value={settings.maxPosition}
            onChange={(e) => setSettings({ ...settings, maxPosition: parseInt(e.target.value) })}
          />
          <small>Maximum position size per trade</small>
        </div>
        <div className="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={settings.autoTrade}
              onChange={(e) => setSettings({ ...settings, autoTrade: e.target.checked })}
              disabled
            />
            Auto-trade (Coming Soon)
          </label>
          <small>⚠️ Automatically execute trades when spread opportunities detected</small>
        </div>
      </div>

      <div className="settings-group">
        <h3>Security</h3>
        <p>API Keys stored: <strong>LocalStorage</strong></p>
        <p className="warning">
          ⚠️ LocalStorage is not encrypted. Only use with Testnet accounts.
        </p>
        <button onClick={() => {
          if (confirm('Clear all API keys from storage?')) {
            localStorage.removeItem('apiConfig');
            alert('✅ API keys cleared');
          }
        }} className="btn btn-danger">
          Clear All API Keys
        </button>
      </div>

      <div className="button-group">
        <button onClick={handleSave} className="btn btn-primary">
          Save Settings
        </button>
        <button onClick={handleReset} className="btn btn-secondary">
          Reset to Defaults
        </button>
      </div>
    </section>
  );
}
