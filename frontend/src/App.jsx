import { useEffect, useState } from "react";

// Public endpoint — not a secret. Override with VITE_API_URL for other stacks.
const API_URL =
  import.meta.env.VITE_API_URL ??
  "https://5otcpnjj2f.execute-api.us-east-1.amazonaws.com/movers";

const fmtPct = (p) => `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
const fmtDate = (d) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export default function App() {
  const [movers, setMovers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(API_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setMovers(data.movers))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="app">
      <header>
        <h1>Daily Top Movers</h1>
        <p className="sub">
          Biggest daily move (open → close) on the tech watchlist: AAPL · MSFT ·
          GOOGL · AMZN · TSLA · NVDA
        </p>
      </header>

      {error && <p className="state error">Couldn’t load data: {error}</p>}
      {!error && !movers && <p className="state">Loading…</p>}
      {movers && movers.length === 0 && (
        <p className="state">No movers recorded yet — check back after the next market close.</p>
      )}

      {movers && movers.length > 0 && (
        <ul className="cards">
          {movers.map((m) => {
            const up = m.percent_change >= 0;
            return (
              <li key={m.date} className={`card ${up ? "up" : "down"}`}>
                <span className="date">{fmtDate(m.date)}</span>
                <span className="ticker">{m.ticker}</span>
                <span className="pct">{fmtPct(m.percent_change)}</span>
                <span className="close">closed at ${m.closing_price.toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
