import { useState, useEffect } from 'react'
import { fetchKasPrice } from './services/binance'
import type { PriceData } from './types/binance'
import './App.css'

function App() {
  const [priceData, setPriceData] = useState<PriceData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('')

  const loadData = async () => {
    try {
      setError(null)
      const data = await fetchKasPrice()
      setPriceData(data)
      setLastUpdateTime(new Date().toLocaleTimeString())
      setIsLoading(false)
    } catch (err) {
      setError('Failed to fetch price data')
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // 初回ロード
    loadData()

    // 10秒ごとに自動更新
    const interval = setInterval(loadData, 10000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Kaspa Custom Oracle</h1>
        <p>Price Monitoring System</p>
      </header>

      <main className="main">
        <section className="status-panel">
          <h2>System Status</h2>
          <div className="status-item">
            <span>Connection:</span>
            <span className="status-value" style={{ color: isLoading ? '#ffc107' : error ? '#dc3545' : '#28a745' }}>
              {isLoading ? 'Connecting...' : error ? 'Error' : 'Connected'}
            </span>
          </div>
          <div className="status-item">
            <span>Monitoring:</span>
            <span className="status-value" style={{ color: priceData ? '#28a745' : '#666' }}>
              {priceData ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="status-item">
            <span>Last Update:</span>
            <span className="status-value">{lastUpdateTime || 'N/A'}</span>
          </div>
        </section>

        <section className="price-panel">
          <h2>Price Monitor - KASUSDT Perpetual</h2>
          {isLoading && <p>Loading data...</p>}
          {error && <p style={{ color: '#dc3545' }}>{error}</p>}
          {priceData && (
            <div className="price-grid">
              <div className="price-item large">
                <span className="label">Current Price</span>
                <span className="value">${priceData.price.toFixed(7)}</span>
                <span className={`change ${priceData.priceChange >= 0 ? 'positive' : 'negative'}`}>
                  {priceData.priceChange >= 0 ? '▲' : '▼'} {priceData.priceChangePercent.toFixed(2)}%
                </span>
              </div>
              <div className="price-item">
                <span className="label">Best Bid</span>
                <span className="value">${priceData.bestBid.toFixed(7)}</span>
              </div>
              <div className="price-item">
                <span className="label">Best Ask</span>
                <span className="value">${priceData.bestAsk.toFixed(7)}</span>
              </div>
              <div className="price-item">
                <span className="label">24h High</span>
                <span className="value">${priceData.high24h.toFixed(7)}</span>
              </div>
              <div className="price-item">
                <span className="label">24h Low</span>
                <span className="value">${priceData.low24h.toFixed(7)}</span>
              </div>
              <div className="price-item">
                <span className="label">24h Volume</span>
                <span className="value">{parseFloat(priceData.volume24h).toLocaleString()} KAS</span>
              </div>
            </div>
          )}
        </section>

        <section className="opportunity-panel">
          <h2>Trading Opportunities</h2>
          <p>Coming soon...</p>
        </section>
      </main>

      <footer className="footer">
        <p>Kaspa Custom Oracle v0.1.0</p>
      </footer>
    </div>
  )
}

export default App
