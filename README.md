# Kaspa Custom Oracle

A real-time cryptocurrency price oracle for KAS/USDT using Chainlink's VWAP-based methodology to aggregate data from 6 major exchanges.

🌐 **Live Demo**: [https://rossku.github.io/kaspa-custom-oracle/](https://rossku.github.io/kaspa-custom-oracle/)

---

## 🎯 Features

### Oracle Price Calculation (Chainlink Method)
- **VWAP Calculation**: Calculate Volume Weighted Average Price for each exchange
  ```
  VWAP = Σ(price × volume) / Σ(volume)
  ```
- **Median Aggregation**: Take the median of all exchange VWAPs as the final Oracle price
- **Real-time Updates**: 60-second rolling window for trade data
- **Data Freshness**: Only use data updated within the last 5 seconds

### Supported Exchanges (6 Total)
| Exchange | Type | Stream | Update Frequency |
|----------|------|--------|------------------|
| Binance  | Futures | `@aggTrade` | 100ms |
| MEXC     | Futures | `push.deal` | Real-time |
| Bybit    | Futures | `publicTrade` | Real-time |
| Gate.io  | Futures | `futures.trades` | Real-time |
| Kucoin   | Futures | `/execution` | Real-time |
| BingX    | Perpetual | `trade.detail` | Real-time |

### Gap Detection & Arbitrage
- Real-time price gap detection across exchanges
- Profit percentage calculation (fees included)
- Arbitrage opportunity alerts

---

## 🏗️ Architecture

### Chainlink 3-Layer Structure (Simplified)

```
┌─────────────────────────────────────────┐
│ Layer 1: VWAP Calculation               │
│ ┌─────────────────────────────────────┐ │
│ │ Binance  → VWAP (60s window)        │ │
│ │ MEXC     → VWAP (60s window)        │ │
│ │ Bybit    → VWAP (60s window)        │ │
│ │ Gate.io  → VWAP (60s window)        │ │
│ │ Kucoin   → VWAP (60s window)        │ │
│ │ BingX    → VWAP (60s window)        │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Layer 2: Median Aggregation             │
│ Oracle Price = Median(VWAP₁...VWAP₆)    │
└─────────────────────────────────────────┘
```

**Fallback Logic**: If VWAP calculation fails (< 3 trades or total volume = 0), use the latest price (lastPrice/midPrice).

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite 7
- **Styling**: CSS3 with CSS Variables (Dark Mode support)
- **WebSocket**: Native WebSocket API
- **Deployment**: GitHub Pages (CI/CD via GitHub Actions)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/RossKU/kaspa-custom-oracle.git
cd kaspa-custom-oracle

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

Output will be in the `dist/` directory.

---

## 📊 Oracle Calculation Details

### VWAP Calculation
Each exchange collects trade data (price × volume) over a 60-second rolling window:

```typescript
function calculateVWAP(trades: MarketTrade[]): number | null {
  if (trades.length < 3) return null;

  let totalValue = 0;
  let totalVolume = 0;

  for (const trade of trades) {
    totalValue += trade.price * trade.volume;
    totalVolume += trade.volume;
  }

  return totalVolume > 0 ? totalValue / totalVolume : null;
}
```

### Median Calculation
The Oracle price is the median of all valid exchange VWAPs:

```typescript
// Sort prices in ascending order
const sorted = prices.sort((a, b) => a - b);

// Take the middle value (or average of two middle values)
const median = sorted.length % 2 === 0
  ? (sorted[n/2 - 1] + sorted[n/2]) / 2
  : sorted[Math.floor(n/2)];
```

---

## 📁 Project Structure

```
src/
├── components/         # React components
│   ├── PriceTab.tsx   # Price display & Oracle card
│   ├── GapTab.tsx     # Arbitrage gap detection
│   └── ...
├── services/          # Exchange WebSocket services
│   ├── binance.ts     # Binance Futures
│   ├── mexc.ts        # MEXC Futures
│   ├── bybit.ts       # Bybit Futures
│   ├── gateio.ts      # Gate.io Futures
│   ├── kucoin.ts      # Kucoin Futures
│   ├── bingx.ts       # BingX Perpetual
│   └── oracle-calculator.ts  # Oracle VWAP + Median logic
├── types/             # TypeScript type definitions
│   ├── oracle.ts      # Oracle & VWAP types
│   └── ...
└── App.tsx            # Main application component
```

---

## 🎨 UI Features

- **Real-time Price Table**: Shows bid/ask/last price for all 6 exchanges
- **Oracle Price Card**: Displays the calculated Oracle price with explanation
- **Gap Detection**: Highlights arbitrage opportunities with profit percentages
- **Dark Mode**: Full dark mode support with CSS variables
- **Responsive Design**: Mobile, tablet, and desktop optimized

---

## 📝 License

MIT License

---

## 🤖 Credits

Generated with [Claude Code](https://claude.com/claude-code)
