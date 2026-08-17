import { useEffect, useState } from 'react'
import { registerPanelContent } from './RadialMenu'

function LogsPanel() {
  const [entries, setEntries] = useState<{ time: number; level: string; msg: string }[]>([])
  const [auto, setAuto] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    const fetchLogs = async () => {
      try {
        const r = await fetch(`/api/logs?limit=200&filter=${encodeURIComponent(filter)}`)
        const data = await r.json()
        if (alive && data?.entries) setEntries(data.entries)
      } catch { /* noop */ }
    }
    fetchLogs()
    if (!auto) return () => { alive = false }
    const i = setInterval(fetchLogs, 4000)
    return () => { alive = false; clearInterval(i) }
  }, [filter, auto])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="flex-1 rounded-sm border border-[var(--line-bright)] bg-black/40 px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]"
        />
        <label className="flex items-center gap-1 font-mono text-[9.5px] text-[var(--text-dim)]">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          live
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-snug">
        {entries.length === 0 && <div className="text-[var(--text-faint)]">no log entries yet</div>}
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2 border-b border-[var(--line)]/30 py-0.5" style={{ color: e.level === 'ERROR' ? 'var(--red)' : e.level === 'WARN' ? 'var(--amber)' : 'var(--text-dim)' }}>
            <span className="shrink-0 tabular-nums text-[var(--text-faint)]">{new Date(e.time).toLocaleTimeString('en-GB')}</span>
            <span className="w-12 shrink-0 text-[var(--text-faint)]">{e.level}</span>
            <span className="flex-1 break-all">{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

registerPanelContent('logs', LogsPanel)
