import { useState, useEffect, useRef } from 'react'
import { BinancePriceMonitor } from './services/binance'
import { MexcPriceMonitor, type MexcPriceData } from './services/mexc'
import { BybitPriceMonitor, type BybitPriceData } from './services/bybit'
import { GateioPriceMonitor, type GateioPriceData } from './services/gateio'
import { KucoinPriceMonitor, type KucoinPriceData } from './services/kucoin'
import { BingXPriceMonitor, type BingXPriceData } from './services/bingx'
import type { PriceData } from './types/binance'
import { logger } from './utils/logger'
import { PriceTab } from './components/PriceTab'
import { ApiTab } from './components/ApiTab'
import { TradeTab } from './components/TradeTab'
import { SettingsTab } from './components/SettingsTab'
import { DebugTab } from './components/DebugTab'
import './App.css'

type TabType = 'price' | 'api' | 'trade' | 'settings' | 'debug';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('price')
  const [binanceData, setBinanceData] = useState<PriceData | null>(null)
  const [mexcData, setMexcData] = useState<MexcPriceData | null>(null)
  const [bybitData, setBybitData] = useState<BybitPriceData | null>(null)
  const [gateioData, setGateioData] = useState<GateioPriceData | null>(null)
  const [kucoinData, setKucoinData] = useState<KucoinPriceData | null>(null)
  const [bingxData, setBingxData] = useState<BingXPriceData | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('')
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const binanceMonitorRef = useRef<BinancePriceMonitor | null>(null)
  const mexcMonitorRef = useRef<MexcPriceMonitor | null>(null)
  const bybitMonitorRef = useRef<BybitPriceMonitor | null>(null)
  const gateioMonitorRef = useRef<GateioPriceMonitor | null>(null)
  const kucoinMonitorRef = useRef<KucoinPriceMonitor | null>(null)
  const bingxMonitorRef = useRef<BingXPriceMonitor | null>(null)

  // Subscribe to debug logs
  useEffect(() => {
    const unsubscribe = logger.subscribe((logs) => {
      const formatted = logs.slice(-100).map(log => {
        const dataStr = log.data ? ` | ${JSON.stringify(log.data)}` : '';
        return `[${log.timestamp.split('T')[1].split('.')[0]}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${dataStr}`;
      });
      setDebugLogs(formatted);
    });

    return () => unsubscribe();
  }, [])

  // Binance WebSocket
  useEffect(() => {
    const monitor = new BinancePriceMonitor()
    binanceMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setBinanceData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
        setIsConnecting(false)
        setError(null)
      },
      (errorMsg) => {
        setError(errorMsg)
        setIsConnecting(false)
      }
    )

    return () => {
      monitor.disconnect()
      binanceMonitorRef.current = null
    }
  }, [])

  // MEXC WebSocket
  useEffect(() => {
    const monitor = new MexcPriceMonitor()
    mexcMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setMexcData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
      },
      (errorMsg) => {
        console.error('[App] MEXC error:', errorMsg)
      }
    )

    return () => {
      monitor.disconnect()
      mexcMonitorRef.current = null
    }
  }, [])

  // Bybit WebSocket
  useEffect(() => {
    const monitor = new BybitPriceMonitor()
    bybitMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setBybitData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
      },
      (errorMsg) => {
        console.error('[App] Bybit error:', errorMsg)
      }
    )

    return () => {
      monitor.disconnect()
      bybitMonitorRef.current = null
    }
  }, [])

  // Gate.io WebSocket
  useEffect(() => {
    const monitor = new GateioPriceMonitor()
    gateioMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setGateioData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
      },
      (errorMsg) => {
        console.error('[App] Gate.io error:', errorMsg)
      }
    )

    return () => {
      monitor.disconnect()
      gateioMonitorRef.current = null
    }
  }, [])

  // Kucoin WebSocket
  useEffect(() => {
    const monitor = new KucoinPriceMonitor()
    kucoinMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setKucoinData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
      },
      (errorMsg) => {
        console.error('[App] Kucoin error:', errorMsg)
      }
    )

    return () => {
      monitor.disconnect()
      kucoinMonitorRef.current = null
    }
  }, [])

  // BingX WebSocket
  useEffect(() => {
    const monitor = new BingXPriceMonitor()
    bingxMonitorRef.current = monitor

    monitor.connect(
      (data) => {
        setBingxData(data)
        setLastUpdateTime(new Date().toLocaleTimeString())
      },
      (errorMsg) => {
        console.error('[App] BingX error:', errorMsg)
      }
    )

    return () => {
      monitor.disconnect()
      bingxMonitorRef.current = null
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Kaspa Custom Oracle</h1>
        <div className="status-bar">
          <span className="status-item">
            Status: <span className={`status-badge ${isConnecting ? 'connecting' : error ? 'error' : 'connected'}`}>
              {isConnecting ? 'Connecting' : error ? 'Error' : 'Connected'}
            </span>
          </span>
          <span className="status-item">Last Update: {lastUpdateTime || 'N/A'}</span>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab-button ${activeTab === 'price' ? 'active' : ''}`}
          onClick={() => setActiveTab('price')}
        >
          📊 Price
        </button>
        <button
          className={`tab-button ${activeTab === 'api' ? 'active' : ''}`}
          onClick={() => setActiveTab('api')}
        >
          📡 API
        </button>
        <button
          className={`tab-button ${activeTab === 'trade' ? 'active' : ''}`}
          onClick={() => setActiveTab('trade')}
        >
          ⚡ Trade
        </button>
        <button
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
        <button
          className={`tab-button ${activeTab === 'debug' ? 'active' : ''}`}
          onClick={() => setActiveTab('debug')}
        >
          🐛 Debug
        </button>
      </nav>

      <main className="main">
        {activeTab === 'price' && (
          <PriceTab
            binanceData={binanceData}
            mexcData={mexcData}
            bybitData={bybitData}
            gateioData={gateioData}
            kucoinData={kucoinData}
            bingxData={bingxData}
            isConnecting={isConnecting}
            error={error}
          />
        )}
        {activeTab === 'api' && <ApiTab />}
        {activeTab === 'trade' && <TradeTab />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'debug' && <DebugTab debugLogs={debugLogs} />}
      </main>

      <footer className="footer">
        <p>Kaspa Arbitrage System v0.6.0 - 6 Exchanges | Tab Navigation</p>
      </footer>
    </div>
  )
}

export default App
