export function TradeTab() {
  return (
    <section className="tab-content trade-tab">
      <h2>⚡ Arbitrage Trading</h2>

      <div className="coming-soon-box">
        <h3>🚧 Coming Soon</h3>
        <p>This feature is under development.</p>

        <div className="planned-features">
          <h4>Planned Features:</h4>
          <ul>
            <li>✅ Real-time arbitrage opportunity detection</li>
            <li>✅ Manual trade execution</li>
            <li>✅ Fee calculation and net profit display</li>
            <li>✅ Risk management checks</li>
            <li>⏳ Auto-trade mode (future)</li>
            <li>⏳ Trade history and analytics</li>
            <li>⏳ Multi-exchange portfolio view</li>
          </ul>
        </div>

        <div className="next-steps">
          <h4>Next Steps:</h4>
          <ol>
            <li>Go to <strong>API</strong> tab and connect your Bybit Testnet account</li>
            <li>Monitor price spreads in <strong>Price</strong> tab</li>
            <li>Manual arbitrage execution coming in next update</li>
          </ol>
        </div>

        <div className="info-box">
          <h4>💡 What is Arbitrage?</h4>
          <p>
            Arbitrage is buying an asset on one exchange at a lower price and
            simultaneously selling it on another exchange at a higher price,
            profiting from the price difference (spread).
          </p>
          <p>
            <strong>Example:</strong> Buy KAS on Binance @ $0.05612,
            Sell on Kucoin @ $0.05741 = $0.00129 profit per KAS (2.3% spread)
          </p>
        </div>
      </div>
    </section>
  );
}
