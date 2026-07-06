import { useEffect, useRef, useState } from 'react'

const API_URL =
  import.meta.env.VITE_API_URL ??
  'https://5otcpnjj2f.execute-api.us-east-1.amazonaws.com/movers'
const CHAT_URL = API_URL.replace(/\/movers$/, '/chat')

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

function Stats({ movers, days }) {
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

  let streak = 1
  while (streak < movers.length && movers[streak].ticker === latest.ticker) streak++
  const avgMove = movers.reduce((s, m) => s + Math.abs(m.percent_change), 0) / movers.length

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
        <div className="sub num">
          Closed at ${latest.closing_price.toFixed(2)}
          {streak > 1 && <span className="streak"> · {streak} days running</span>}
        </div>
      </div>
      <div className="stat">
        <div className="label">Biggest gain · {days}d</div>
        <div className="value num up">{best ? fmtPct(best.percent_change) : '—'}</div>
        <div className="sub">{best ? `${best.ticker} · ${fmtDate(best.date, { month: 'short', day: 'numeric' })}` : 'no up days'}</div>
      </div>
      <div className="stat">
        <div className="label">Biggest drop · {days}d</div>
        <div className="value num down">{worst ? fmtPct(worst.percent_change) : '—'}</div>
        <div className="sub">{worst ? `${worst.ticker} · ${fmtDate(worst.date, { month: 'short', day: 'numeric' })}` : 'no down days'}</div>
      </div>
      <div className="stat">
        <div className="label">Direction · {days}d</div>
        <div className="value num">
          {gains.length}<span className="slash">/</span>{losses.length}
        </div>
        <div className="sub num">up vs down · avg {avgMove.toFixed(2)}%</div>
      </div>
    </section>
  )
}

function DayChat({ date, ticker }) {
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const send = () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user', text }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, messages: next.slice(-12) }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        const reply = r.ok ? data.reply : `Sorry — ${data.error || `error ${r.status}`}.`
        setMsgs((m) => [...m, { role: 'model', text: reply }])
      })
      .catch(() => setMsgs((m) => [...m, { role: 'model', text: 'Sorry — network error.' }]))
      .finally(() => setBusy(false))
  }

  if (!open) {
    return (
      <button className="askai" onClick={() => setOpen(true)}>
        {msgs.length ? `Reopen chat (${msgs.length})` : 'Ask AI about this day'}
      </button>
    )
  }
  return (
    <div className="chat">
      <div className="chead">
        <span className="nsrc">Chat · {ticker}</span>
        <button className="askai" onClick={() => setOpen(false)}>Hide chat</button>
      </div>
      {msgs.map((m, i) => (
        <div key={i} className={`cmsg ${m.role}`}>{m.text}</div>
      ))}
      {busy && <div className="cmsg model nsrc">Thinking…</div>}
      <div className="crow">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={`Ask why ${ticker} moved on ${fmtDate(date, { month: 'short', day: 'numeric' })}…`}
          maxLength={500}
          autoFocus
        />
        <button onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
      <div className="cnote">AI-generated commentary — context, not financial advice.</div>
    </div>
  )
}

function NewsStrip({ mover, picked }) {
  if (!mover.headline && !picked) return null
  return (
    <section className="newscard">
      <div className="nlabel">
        {mover.sentiment && <span className={`sdot ${mover.sentiment}`} />}
        In the news · {mover.ticker} · {fmtDate(mover.date, { month: 'short', day: 'numeric' })}
      </div>
      {mover.headline ? (
        <>
          {mover.news_reason && <p className="nreason">{mover.news_reason}</p>}
          <div className="nmeta">
            <a href={mover.news_url} target="_blank" rel="noreferrer">{mover.headline}</a>
            {mover.news_source && <span className="nsrc"> · {mover.news_source}</span>}
          </div>
        </>
      ) : (
        <p className="nreason nsrc">No headline recorded for this day.</p>
      )}
      <DayChat key={mover.date} date={mover.date} ticker={mover.ticker} />
    </section>
  )
}

function Leaderboard({ movers }) {
  const counts = {}
  movers.forEach((m) => { counts[m.ticker] = (counts[m.ticker] || 0) + 1 })
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return (
    <div className="board num">
      <span className="blabel">Top-mover wins</span>
      {rows.map(([ticker, n]) => (
        <span key={ticker} className="bchip">{ticker} <b>×{n}</b></span>
      ))}
    </div>
  )
}

function Chart({ movers }) {
  const [hover, setHover] = useState(null)
  const [width, setWidth] = useState(0)
  const wrapRef = useRef(null)

  useEffect(() => {
    const el = wrapRef.current
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const mobile = width > 0 && width < 560
  const W = width || 700
  const H = mobile ? 170 : 210
  const PADX = mobile ? 14 : 34
  const PADT = 16, PADB = 16

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

  const anchorFor = (i) => (i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle')

  const onMove = (clientX) => {
    const r = wrapRef.current.getBoundingClientRect()
    const vx = clientX - r.left
    let best = 0
    pts.forEach((p, i) => {
      if (Math.abs(p.x - vx) < Math.abs(pts[best].x - vx)) best = i
    })
    setHover(best)
  }

  const hv = hover != null ? pts[hover] : null
  const tipLeft = hv ? Math.max(70, Math.min(W - 70, hv.x)) : 0

  return (
    <section className="chartcard num">
      <div className="head">
        <h2>Daily move</h2>
        <span>top mover’s % change per day</span>
      </div>
      <div className="chartwrap" ref={wrapRef}>
        {width > 0 && (
        <svg
          className="linechart"
          width={W}
          height={H + 30}
          viewBox={`0 -14 ${W} ${H + 30}`}
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
                textAnchor={anchorFor(i)}
              >
                {fmtPct(vals[i])}
              </text>
            )
          )}
          {hv && (
            <line className="xhair" x1={hv.x} x2={hv.x} y1={PADT - 6} y2={H - PADB} />
          )}
        </svg>
        )}
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
      <div className="xlabels" style={{ paddingLeft: PADX, paddingRight: PADX }}>
        {pts.map((p, i) => {
          const every = Math.ceil(pts.length / 8) // thin labels on long windows
          const show = i % every === 0 || i === pts.length - 1
          return (
            <div key={p.date} style={show ? undefined : { visibility: 'hidden' }}>
              <div className="t">{p.ticker}</div>
              <div className="d">{fmtDate(p.date, { month: 'short', day: 'numeric' })}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Ledger({ movers, selected, onSelect }) {
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
                <tr
                  key={m.date}
                  className={m.date === selected ? 'sel' : ''}
                  onClick={() => onSelect(m.date)}
                >
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

// Most recent weekday before today (UTC) — the newest date we could have data for.
function lastExpectedTradingDay() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function CopyButton({ latest }) {
  const [copied, setCopied] = useState(false)
  const summary = `${latest.ticker} ${fmtPct(latest.percent_change)} was the watchlist's top mover on ${fmtDate(latest.date, { month: 'short', day: 'numeric', year: 'numeric' })}, closing at $${latest.closing_price.toFixed(2)}.`
  return (
    <button
      className="copy"
      onClick={() => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(summary)
        } else {
          // S3 website hosting is HTTP-only and navigator.clipboard needs HTTPS
          const ta = document.createElement('textarea')
          ta.value = summary
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied ✓' : 'Copy summary'}
    </button>
  )
}

export default function App() {
  const [movers, setMovers] = useState(null)
  const [error, setError] = useState(null)
  const [days, setDays] = useState(7)
  const [selected, setSelected] = useState(null) // date whose news is shown; null = latest

  useEffect(() => {
    setError(null)
    setSelected(null)
    fetch(`${API_URL}?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setMovers(data.movers))
      .catch((e) => setError(e.message))
  }, [days])

  const stale = movers?.length > 0 && movers[0].date < lastExpectedTradingDay()

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
          <div className="toolrow">
            <div className="range" role="group" aria-label="History window">
              {[7, 14, 30].map((n) => (
                <button key={n} className={n === days ? 'on' : ''} onClick={() => setDays(n)}>
                  {n}d
                </button>
              ))}
            </div>
            <CopyButton latest={movers[0]} />
          </div>
          {stale && (
            <div className="state">
              No data for {fmtDate(lastExpectedTradingDay())} yet — US market holiday, or the nightly
              refresh hasn’t run. Showing the last recorded trading day.
            </div>
          )}
          <Stats movers={movers} days={days} />
          <NewsStrip
            mover={movers.find((m) => m.date === selected) || movers[0]}
            picked={selected != null}
          />
          <Leaderboard movers={movers} />
          {movers.length >= 2 && <Chart movers={movers} />}
          <Ledger movers={movers} selected={selected} onSelect={setSelected} />
        </>
      )}

      <div className="foot">
        <span>Data: Massive · refreshed nightly at 06:00 UTC</span>
      </div>
    </div>
  )
}
