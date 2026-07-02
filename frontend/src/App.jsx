import { useEffect, useRef, useState } from 'react'

const API_URL =
  import.meta.env.VITE_API_URL ??
  'https://5otcpnjj2f.execute-api.us-east-1.amazonaws.com/movers'

const fmtDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', opts)

const fmtPct = (pct) => `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="9" width="3.4" height="8" rx="1" fill="#EDEFF2" />
      <rect x="7.3" y="4" width="3.4" height="13" rx="1" fill="#EDEFF2" />
      <rect x="13.6" y="1" width="3.4" height="16" rx="1" fill="#34C98E" />
    </svg>
  )
}

function Stats({ movers }) {
  const latest = movers[0]
  const gains = movers.filter((m) => m.percent_change >= 0)
  const losses = movers.filter((m) => m.percent_change < 0)
  const best = gains.length
    ? gains.reduce((a, b) => (b.percent_change > a.percent_change ? b : a))
    : null
  const worst = losses.length
    ? losses.reduce((a, b) => (b.percent_change < a.percent_change ? b : a))
    : null
  const up = latest.percent_change >= 0

  return (
    <section className="stats">
      <div className="stat primary">
        <div className="label">Latest top mover · {fmtDate(latest.date, { month: 'short', day: 'numeric' })}</div>
        <div className="value num">
          {latest.ticker}
          <span className={`chip ${up ? 'up' : 'down'}`}>
            {up ? '▲' : '▼'} {Math.abs(latest.percent_change).toFixed(2)}%
          </span>
        </div>
        <div className="sub num">Closed at ${latest.closing_price.toFixed(2)}</div>
      </div>
      <div className="stat">
        <div className="label">Biggest gain · 7d</div>
        <div className="value num up">{best ? fmtPct(best.percent_change) : '—'}</div>
        <div className="sub">{best ? `${best.ticker} · ${fmtDate(best.date, { month: 'short', day: 'numeric' })}` : 'no up days'}</div>
      </div>
      <div className="stat">
        <div className="label">Biggest drop · 7d</div>
        <div className="value num down">{worst ? fmtPct(worst.percent_change) : '—'}</div>
        <div className="sub">{worst ? `${worst.ticker} · ${fmtDate(worst.date, { month: 'short', day: 'numeric' })}` : 'no down days'}</div>
      </div>
      <div className="stat">
        <div className="label">Direction · 7d</div>
        <div className="value num">
          {gains.length}<span className="slash">/</span>{losses.length}
        </div>
        <div className="sub">up days vs down days</div>
      </div>
    </section>
  )
}

const W = 700, H = 210, PADX = 34, PADT = 16, PADB = 16

function Chart({ movers }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)

  const days = [...movers].reverse() // oldest → newest
  const vals = days.map((m) => m.percent_change)
  const vmax = Math.max(...vals, 0)
  const vmin = Math.min(...vals, 0)
  const span = vmax - vmin || 1
  const plotH = H - PADT - PADB

  const x = (i) => (days.length > 1 ? PADX + (i * (W - 2 * PADX)) / (days.length - 1) : W / 2)
  const y = (v) => PADT + ((vmax - v) / span) * plotH
  const pts = days.map((m, i) => ({ ...m, x: x(i), y: y(m.percent_change) }))
  const y0 = y(0)
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} ${pts[pts.length - 1].x.toFixed(1)},${H - PADB} ${pts[0].x.toFixed(1)},${H - PADB}`
  const iMax = vals.indexOf(Math.max(...vals))
  const iMin = vals.indexOf(Math.min(...vals))
  const last = pts[pts.length - 1]

  const onMove = (clientX) => {
    const r = svgRef.current.getBoundingClientRect()
    const vx = ((clientX - r.left) / r.width) * W
    let best = 0
    pts.forEach((p, i) => {
      if (Math.abs(p.x - vx) < Math.abs(pts[best].x - vx)) best = i
    })
    setHover(best)
  }

  const hv = hover != null ? pts[hover] : null
  const tipLeft = hv && svgRef.current
    ? Math.max(70, Math.min(svgRef.current.getBoundingClientRect().width - 70,
        (hv.x / W) * svgRef.current.getBoundingClientRect().width))
    : 0

  return (
    <section className="chartcard num">
      <div className="head">
        <h2>Daily move</h2>
        <span>top mover’s % change per day</span>
      </div>
      <div className="chartwrap">
        <svg
          ref={svgRef}
          className="linechart"
          viewBox={`0 -14 ${W} ${H + 30}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Line chart of the daily top mover's percent change"
          onMouseMove={(e) => onMove(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0].clientX)}
          onTouchMove={(e) => onMove(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            <linearGradient id="fillgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34C98E" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#34C98E" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="zero" x1={PADX} y1={y0} x2={W - PADX} y2={y0} />
          <text className="zlabel" x={W - PADX + 4} y={y0 + 3.5}>0%</text>
          <polygon points={area} fill="url(#fillgrad)" />
          <polyline points={line} className="priceline" />
          <circle cx={last.x} cy={last.y} r="7" className="endring" />
          {pts.map((p, i) => (
            <circle
              key={p.date}
              className={`dot ${p.percent_change >= 0 ? 'du' : 'dd'}`}
              cx={p.x}
              cy={p.y}
              r={hover === i ? 6 : 4}
            />
          ))}
          {[iMax, iMin].map((i) =>
            iMax === iMin && i === iMin ? null : (
              <text
                key={i}
                className={`vlabel ${vals[i] >= 0 ? 'lu' : 'ld'}`}
                x={pts[i].x}
                y={pts[i].y + (i === iMax ? -12 : 18)}
                textAnchor="middle"
              >
                {fmtPct(vals[i])}
              </text>
            )
          )}
          {hv && (
            <line className="xhair" x1={hv.x} x2={hv.x} y1={PADT - 6} y2={H - PADB} />
          )}
        </svg>
        {hv && (
          <div className="tip" style={{ left: tipLeft, opacity: 1 }}>
            <span className="tt">{hv.ticker}</span>{' '}
            <span className={`tv ${hv.percent_change >= 0 ? 'up' : 'down'}`}>
              {fmtPct(hv.percent_change)}
            </span>
            <br />
            <span className="tm">${hv.closing_price.toFixed(2)} · {fmtDate(hv.date)}</span>
          </div>
        )}
      </div>
      <div className="xlabels">
        {pts.map((p) => (
          <div key={p.date}>
            <div className="t">{p.ticker}</div>
            <div className="d">{fmtDate(p.date, { month: 'short', day: 'numeric' })}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Ledger({ movers }) {
  const maxAbs = Math.max(...movers.map((m) => Math.abs(m.percent_change)))
  return (
    <section className="tablecard">
      <header>
        <h2>Last {movers.length} trading days</h2>
        <span>% change, open → close</span>
      </header>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Top mover</th>
              <th className="r">Move</th>
              <th className="r close">Close</th>
              <th className="r">Magnitude</th>
            </tr>
          </thead>
          <tbody className="num">
            {movers.map((m) => {
              const up = m.percent_change >= 0
              const width = maxAbs ? (Math.abs(m.percent_change) / maxAbs) * 100 : 0
              return (
                <tr key={m.date}>
                  <td className="date">{fmtDate(m.date)}</td>
                  <td className="ticker">{m.ticker}</td>
                  <td className={`r move ${up ? 'up' : 'down'}`}>{fmtPct(m.percent_change)}</td>
                  <td className="r close">${m.closing_price.toFixed(2)}</td>
                  <td className="r">
                    <span className="meter">
                      <i className={up ? 'fu' : 'fd'} style={{ width: `${width}%` }} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function App() {
  const [movers, setMovers] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(API_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setMovers(data.movers))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="shell">
      <nav className="topbar">
        <div className="brand"><Logo /> Movers</div>
        <div className="updated">
          {movers?.length > 0 && <>Updated <b>{fmtDate(movers[0].date, { month: 'short', day: 'numeric', year: 'numeric' })} · market close</b></>}
        </div>
      </nav>

      <h1>Watchlist daily top mover</h1>
      <p className="lede">
        The single largest move — up or down — across AAPL, MSFT, GOOGL, AMZN,
        TSLA and NVDA, recorded each trading day.
      </p>

      {error && <div className="state error">Couldn’t load the data ({error}). Refresh to try again.</div>}
      {!error && !movers && <div className="state">Loading market data…</div>}
      {movers?.length === 0 && <div className="state">No movers recorded yet — check back after the next market close.</div>}
      {movers?.length > 0 && (
        <>
          <Stats movers={movers} />
          {movers.length >= 2 && <Chart movers={movers} />}
          <Ledger movers={movers} />
        </>
      )}

      <div className="foot">
        <span>Data: Massive · refreshed nightly at 01:30 UTC</span>
      </div>
    </div>
  )
}
