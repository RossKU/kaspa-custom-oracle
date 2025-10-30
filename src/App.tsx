import { useState, useEffect, useRef, useCallback } from 'react'
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
import { LendingOracleTab } from './components/LendingOracleTab'
import { CorrelationEngine } from './services/correlation-engine'
import type { CorrelationMatrix } from './types/correlation'
import './App.css'

type TabType = 'price' | 'lending' | 'api' | 'trade' | 'settings' | 'debug';

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
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    // Load dark mode preference from localStorage
    const saved = localStorage.getItem('darkMode')
    return saved ? JSON.parse(saved) : false
  })
  const binanceMonitorRef = useRef<BinancePriceMonitor | null>(null)
  const mexcMonitorRef = useRef<MexcPriceMonitor | null>(null)
  const bybitMonitorRef = useRef<BybitPriceMonitor | null>(null)
  const gateioMonitorRef = useRef<GateioPriceMonitor | null>(null)
  const kucoinMonitorRef = useRef<KucoinPriceMonitor | null>(null)
  const bingxMonitorRef = useRef<BingXPriceMonitor | null>(null)

  // Phase 2A: Correlation Engine
  const [correlationMatrix, setCorrelationMatrix] = useState<CorrelationMatrix | null>(null)
  const [correlationLogs, setCorrelationLogs] = useState<Array<{timestamp: number; level: string; message: string}>>([])
  const correlationEngineRef = useRef(new CorrelationEngine())

  // Phase 2A: Refs to always access latest data (avoid closure stale data)
  const binanceDataRef = useRef(binanceData)
  const mexcDataRef = useRef(mexcData)
  const bybitDataRef = useRef(bybitData)
  const gateioDataRef = useRef(gateioData)
  const kucoinDataRef = useRef(kucoinData)
  const bingxDataRef = useRef(bingxData)

  // Update refs when data changes
  useEffect(() => {
    binanceDataRef.current = binanceData
  }, [binanceData])

  useEffect(() => {
    mexcDataRef.current = mexcData
  }, [mexcData])

  useEffect(() => {
    bybitDataRef.current = bybitData
  }, [bybitData])

  useEffect(() => {
    gateioDataRef.current = gateioData
  }, [gateioData])

  useEffect(() => {
    kucoinDataRef.current = kucoinData
  }, [kucoinData])

  useEffect(() => {
    bingxDataRef.current = bingxData
  }, [bingxData])

  // WebSocket management state for Trade Tab
  const [tradeMonitoringActive, setTradeMonitoringActive] = useState(false)
  const [activeExchanges, setActiveExchanges] = useState<string[]>([])
  const stoppedWebSocketsRef = useRef<string[]>([])

  // Handle monitoring state changes from TradeTab
  // useCallback prevents infinite loop by keeping function reference stable
  const handleMonitoringChange = useCallback((isMonitoring: boolean, exchangeA: string, exchangeB: string) => {
    logger.info('App', 'Trade monitoring state changed', { isMonitoring, exchangeA, exchangeB })
    setTradeMonitoringActive(isMonitoring)
    setActiveExchanges([exchangeA, exchangeB])
  }, [])

  // Dark mode persistence
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode))
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

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

  // Manage WebSocket connections for Trade Tab monitoring
  useEffect(() => {
    if (!tradeMonitoringActive) {
      // Monitoring stopped - do NOT reconnect stopped WebSockets
      // Keep unused exchanges stopped to reduce load and avoid 403 errors
      if (stoppedWebSocketsRef.current.length > 0) {
        logger.info('App', 'Trade monitoring stopped, keeping unused WebSockets stopped', {
          stoppedWebSockets: stoppedWebSocketsRef.current
        })
      }
      return
    }

    // Monitoring started - stop unused WebSockets
    const allExchanges = ['Binance', 'MEXC', 'Bybit', 'Gate.io', 'Kucoin', 'BingX']
    const unusedExchanges = allExchanges.filter(ex => !activeExchanges.includes(ex))

    logger.info('App', 'Trade monitoring started, stopping unused WebSockets', {
      activeExchanges,
      unusedExchanges
    })

    const stopped: string[] = []

    unusedExchanges.forEach(exchange => {
      if (exchange === 'Binance' && binanceMonitorRef.current) {
        logger.info('App', 'Stopping Binance WebSocket')
        binanceMonitorRef.current.disconnect()
        stopped.push('Binance')
      } else if (exchange === 'MEXC' && mexcMonitorRef.current) {
        logger.info('App', 'Stopping MEXC WebSocket')
        mexcMonitorRef.current.disconnect()
        stopped.push('MEXC')
      } else if (exchange === 'Gate.io' && gateioMonitorRef.current) {
        logger.info('App', 'Stopping Gate.io WebSocket')
        gateioMonitorRef.current.disconnect()
        stopped.push('Gate.io')
      } else if (exchange === 'Kucoin' && kucoinMonitorRef.current) {
        logger.info('App', 'Stopping Kucoin WebSocket')
        kucoinMonitorRef.current.disconnect()
        stopped.push('Kucoin')
      }
    })

    stoppedWebSocketsRef.current = stopped
  }, [tradeMonitoringActive, activeExchanges])

  // Phase 2A: Periodic correlation calculation (every 30 seconds)
  useEffect(() => {
    const calculateCorrelation = () => {
      // デバッグログ: 関数実行を記録
      const debugLog = {
        timestamp: Date.now(),
        level: 'info' as const,
        message: `[DEBUG] calculateCorrelation() called`,
      };
      setCorrelationLogs(prevLogs => [...prevLogs, debugLog]);

      // データ状態チェック（refから最新データ取得）
      const dataStatus = {
        binance: binanceDataRef.current ? (binanceDataRef.current.priceHistory ? `OK (${binanceDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
        mexc: mexcDataRef.current ? (mexcDataRef.current.priceHistory ? `OK (${mexcDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
        bybit: bybitDataRef.current ? (bybitDataRef.current.priceHistory ? `OK (${bybitDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
        gateio: gateioDataRef.current ? (gateioDataRef.current.priceHistory ? `OK (${gateioDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
        kucoin: kucoinDataRef.current ? (kucoinDataRef.current.priceHistory ? `OK (${kucoinDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
        bingx: bingxDataRef.current ? (bingxDataRef.current.priceHistory ? `OK (${bingxDataRef.current.priceHistory.snapshots.length} snapshots)` : 'NO_HISTORY') : 'NULL',
      };

      const statusLog = {
        timestamp: Date.now(),
        level: 'info' as const,
        message: `[DEBUG] Data status: Binance=${dataStatus.binance}, MEXC=${dataStatus.mexc}, Bybit=${dataStatus.bybit}, Gate.io=${dataStatus.gateio}, Kucoin=${dataStatus.kucoin}, BingX=${dataStatus.bingx}`,
      };
      setCorrelationLogs(prevLogs => [...prevLogs, statusLog]);

      // データをrefから取得（常に最新データにアクセス）
      const exchanges = new Map<string, { priceHistory: any; volumeStats?: any; lastUpdate: number }>();

      if (binanceDataRef.current?.priceHistory) {
        exchanges.set('Binance', {
          priceHistory: binanceDataRef.current.priceHistory,
          volumeStats: binanceDataRef.current.volumeStats,
          lastUpdate: binanceDataRef.current.lastUpdate,
        });
      }
      if (mexcDataRef.current?.priceHistory) {
        exchanges.set('MEXC', {
          priceHistory: mexcDataRef.current.priceHistory,
          volumeStats: mexcDataRef.current.volumeStats,
          lastUpdate: mexcDataRef.current.lastUpdate,
        });
      }
      if (bybitDataRef.current?.priceHistory) {
        exchanges.set('Bybit', {
          priceHistory: bybitDataRef.current.priceHistory,
          volumeStats: bybitDataRef.current.volumeStats,
          lastUpdate: bybitDataRef.current.lastUpdate,
        });
      }
      if (gateioDataRef.current?.priceHistory) {
        exchanges.set('Gate.io', {
          priceHistory: gateioDataRef.current.priceHistory,
          volumeStats: gateioDataRef.current.volumeStats,
          lastUpdate: gateioDataRef.current.lastUpdate,
        });
      }
      if (kucoinDataRef.current?.priceHistory) {
        exchanges.set('Kucoin', {
          priceHistory: kucoinDataRef.current.priceHistory,
          volumeStats: kucoinDataRef.current.volumeStats,
          lastUpdate: kucoinDataRef.current.lastUpdate,
        });
      }
      if (bingxDataRef.current?.priceHistory) {
        exchanges.set('BingX', {
          priceHistory: bingxDataRef.current.priceHistory,
          volumeStats: bingxDataRef.current.volumeStats,
          lastUpdate: bingxDataRef.current.lastUpdate,
        });
      }

      // デバッグログ: exchanges.size
      const sizeLog = {
        timestamp: Date.now(),
        level: 'info' as const,
        message: `[DEBUG] exchanges.size = ${exchanges.size} (need >= 2)`,
      };
      setCorrelationLogs(prevLogs => [...prevLogs, sizeLog]);

      // 最低2取引所のデータが必要
      if (exchanges.size >= 2) {
        const conditionLog = {
          timestamp: Date.now(),
          level: 'success' as const,
          message: `[DEBUG] Condition met (${exchanges.size} >= 2), executing correlation calculation`,
        };
        setCorrelationLogs(prevLogs => [...prevLogs, conditionLog]);

        const result = correlationEngineRef.current.calculateCorrelationMatrix(exchanges);
        setCorrelationMatrix(result.matrix);
        setCorrelationLogs(prevLogs => [...prevLogs, ...result.logs]);
      } else {
        const skipLog = {
          timestamp: Date.now(),
          level: 'warning' as const,
          message: `[DEBUG] Skipping correlation calculation (only ${exchanges.size}/2 exchanges ready)`,
        };
        setCorrelationLogs(prevLogs => [...prevLogs, skipLog]);
      }
    };

    // 初回実行（30秒後）
    const initialTimer = setTimeout(calculateCorrelation, 30000);

    // 定期実行（30秒ごと）
    const intervalTimer = setInterval(calculateCorrelation, 30000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空の依存配列: マウント時に一度だけ実行

  return (
    <div className="app">
      <header className="header">
        <div className="header-top">
          <h1>Kaspa Custom Oracle</h1>
          <button
            className="theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
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
          className={`tab-button ${activeTab === 'lending' ? 'active' : ''}`}
          onClick={() => setActiveTab('lending')}
        >
          🏦 Lending Oracle
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
        {activeTab === 'lending' && (
          <LendingOracleTab
            binanceData={binanceData}
            mexcData={mexcData}
            bybitData={bybitData}
            gateioData={gateioData}
            kucoinData={kucoinData}
            bingxData={bingxData}
            correlationMatrix={correlationMatrix}
            correlationLogs={correlationLogs}
          />
        )}
        {activeTab === 'api' && <ApiTab />}
        {activeTab === 'trade' && (
          <TradeTab
            binanceData={binanceData}
            mexcData={mexcData}
            bybitData={bybitData}
            gateioData={gateioData}
            kucoinData={kucoinData}
            bingxData={bingxData}
            onMonitoringChange={handleMonitoringChange}
          />
        )}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'debug' && <DebugTab debugLogs={debugLogs} />}
      </main>

      <footer className="footer">
        <p>Kaspa Oracle v0.6.0 - 6 Exchanges | Multi-Tab Interface</p>
      </footer>
    </div>
  )
}

export default App
