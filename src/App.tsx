import { useState, useEffect, useRef } from 'react'
import { BinancePriceMonitor } from './services/binance'
import type { PriceData } from './types/binance'
import './App.css'

function App() {
  const [priceData, setPriceData] = useState<PriceData | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('')
  const monitorRef = useRef<BinancePriceMonitor | null>(null)

  useEffect(() => {
    const monitor = new BinancePriceMonitor()
    monitorRef.current = monitor

    monitor.connect(
      (data) => {
        setPriceData(data)
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
      monitorRef.current = null
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

          {priceData && (
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
                <tr>
                  <td>Binance</td>
                  <td className="type-futures">F</td>
                  <td className="price">${priceData.price.toFixed(7)}</td>
                  <td className="bid">${priceData.bestBid.toFixed(7)}</td>
                  <td className="ask">${priceData.bestAsk.toFixed(7)}</td>
                </tr>
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
