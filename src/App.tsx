import './App.css'

function App() {
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
            <span className="status-value">Disconnected</span>
          </div>
          <div className="status-item">
            <span>Monitoring:</span>
            <span className="status-value">Inactive</span>
          </div>
        </section>

        <section className="price-panel">
          <h2>Price Monitor</h2>
          <p>No data available</p>
        </section>

        <section className="opportunity-panel">
          <h2>Trading Opportunities</h2>
          <p>Waiting for data...</p>
        </section>
      </main>

      <footer className="footer">
        <p>Kaspa Custom Oracle v0.1.0</p>
      </footer>
    </div>
  )
}

export default App
