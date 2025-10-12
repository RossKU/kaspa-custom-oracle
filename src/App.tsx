import { useState, useEffect, useRef } from 'react'
import { BinancePriceMonitor } from './services/binance'
import { MexcPriceMonitor, type MexcPriceData } from './services/mexc'
import { BybitPriceMonitor, type BybitPriceData } from './services/bybit'
import { GateioPriceMonitor, type GateioPriceData } from './services/gateio'
import { KucoinPriceMonitor, type KucoinPriceData } from './services/kucoin'
import { BingXPriceMonitor, type BingXPriceData } from './services/bingx'
import type { PriceData } from './types/binance'
import './App.css'

function App() {
  const [binanceData, setBinanceData] = useState<PriceData | null>(null)
  const [mexcData, setMexcData] = useState<MexcPriceData | null>(null)
  const [bybitData, setBybitData] = useState<BybitPriceData | null>(null)
  const [gateioData, setGateioData] = useState<GateioPriceData | null>(null)
  const [kucoinData, setKucoinData] = useState<KucoinPriceData | null>(null)
  const [bingxData, setBingxData] = useState<BingXPriceData | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('')
  const binanceMonitorRef = useRef<BinancePriceMonitor | null>(null)
  const mexcMonitorRef = useRef<MexcPriceMonitor | null>(null)
  const bybitMonitorRef = useRef<BybitPriceMonitor | null>(null)
  const gateioMonitorRef = useRef<GateioPriceMonitor | null>(null)
  const kucoinMonitorRef = useRef<KucoinPriceMonitor | null>(null)
  const bingxMonitorRef = useRef<BingXPriceMonitor | null>(null)

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

      <main className="main">
        <section className="table-section">
          {isConnecting && <p className="loading-message">Connecting to exchanges...</p>}
          {error && <p className="error-message">{error}</p>}

          {(binanceData || mexcData || bybitData || gateioData || kucoinData || bingxData) && (
            <table className="price-table">
              <thead>
                <tr>
                  <th>Exchange</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Bid</th>
                  <th>Ask</th>
                </tr>
              </thead>
              <tbody>
                {binanceData && (
                  <tr>
                    <td>Binance</td>
                    <td className="type-futures">F</td>
                    <td className="price">${binanceData.price.toFixed(7)}</td>
                    <td className="bid">${binanceData.bestBid.toFixed(7)}</td>
                    <td className="ask">${binanceData.bestAsk.toFixed(7)}</td>
                  </tr>
                )}
                {mexcData && (
                  <tr>
                    <td>MEXC</td>
                    <td className="type-futures">F</td>
                    <td className="price">${mexcData.price.toFixed(7)}</td>
                    <td className="bid">${mexcData.bid.toFixed(7)}</td>
                    <td className="ask">${mexcData.ask.toFixed(7)}</td>
                  </tr>
                )}
                {bybitData && (
                  <tr>
                    <td>Bybit</td>
                    <td className="type-futures">F</td>
                    <td className="price">${bybitData.price.toFixed(7)}</td>
                    <td className="bid">${bybitData.bid.toFixed(7)}</td>
                    <td className="ask">${bybitData.ask.toFixed(7)}</td>
                  </tr>
                )}
                {gateioData && (
                  <tr>
                    <td>Gate.io</td>
                    <td className="type-futures">F</td>
                    <td className="price">${gateioData.price.toFixed(7)}</td>
                    <td className="bid">${gateioData.bid.toFixed(7)}</td>
                    <td className="ask">${gateioData.ask.toFixed(7)}</td>
                  </tr>
                )}
                {kucoinData && (
                  <tr>
                    <td>Kucoin</td>
                    <td className="type-futures">F</td>
                    <td className="price">${kucoinData.price.toFixed(7)}</td>
                    <td className="bid">${kucoinData.bid.toFixed(7)}</td>
                    <td className="ask">${kucoinData.ask.toFixed(7)}</td>
                  </tr>
                )}
                {bingxData && (
                  <tr>
                    <td>BingX</td>
                    <td className="type-futures">F</td>
                    <td className="price">${bingxData.price.toFixed(7)}</td>
                    <td className="bid">${bingxData.bid.toFixed(7)}</td>
                    <td className="ask">${bingxData.ask.toFixed(7)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Kaspa Custom Oracle v0.5.0 - 6 Exchanges</p>
      </footer>
    </div>
  )
}

export default App
