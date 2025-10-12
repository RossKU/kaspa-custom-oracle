import { useState, useEffect, useRef } from 'react'
import { BinancePriceMonitor } from './services/binance'
import { MexcPriceMonitor, type MexcPriceData } from './services/mexc'
import type { PriceData } from './types/binance'
import './App.css'

function App() {
  const [binanceData, setBinanceData] = useState<PriceData | null>(null)
  const [mexcData, setMexcData] = useState<MexcPriceData | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('')
  const binanceMonitorRef = useRef<BinancePriceMonitor | null>(null)
  const mexcMonitorRef = useRef<MexcPriceMonitor | null>(null)

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

          {(binanceData || mexcData) && (
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
              </tbody>
            </table>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>Kaspa Custom Oracle v0.3.0</p>
      </footer>
    </div>
  )
}

export default App
