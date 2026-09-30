import { useCallback, useEffect, useMemo, useState } from 'react'
import { Network, RefreshCw, Search, Trash2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { registerPanelContent } from './RadialMenu'

interface MemoryItem {
  id: string
  text: string
  tags: string[]
  created?: string
  updated?: string
  score?: number | null
  metadata?: Record<string, unknown>
}

interface GraphEdge {
  source: string
  target: string
  sim: number
}

/** Layout happens in a fixed virtual space; the SVG viewBox scales to fit. */
const VW = 760
const VH = 1040
const LAYOUT_CAP = 300

const SOURCE_COLOR: Record<string, string> = {
  conversation: 'var(--blue)',
  explicit: 'var(--green)',
  migration: 'var(--amber)',
}

function sourceOf(m: MemoryItem): string {
  const src = m.metadata?.source
  if (typeof src === 'string' && src) return src === 'memory.db' ? 'migration' : src
  return 'conversation'
}

function ago(iso?: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

interface Pos {
  x: number
  y: number
  vx: number
  vy: number
}

/** One-shot force layout: pair repulsion + edge springs + centering.
 *  Runs synchronously in useMemo (≤300 nodes ≈ few hundred ms, once). */
function layout(ids: string[], edges: GraphEdge[]): Map<string, Pos> {
  const pos = new Map<string, Pos>()
  const n = ids.length
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2
    const r = Math.min(VW, VH) * 0.36 + ((i * 37) % 90)
    pos.set(id, {
      x: VW / 2 + Math.cos(a) * r,
      y: VH / 2 + Math.sin(a) * r,
      vx: 0,
      vy: 0,
    })
  })

  const REP = 34000
  const SPRING = 0.04
  const LEN = 135
  const CENTER = 0.008
  const DAMP = 0.86
  const ITER = 340

  for (let it = 0; it < ITER; it++) {
    // repulsion (all pairs — n ≤ 300, cheap enough for a one-shot)
    for (let i = 0; i < n; i++) {
      const a = pos.get(ids[i])!
      for (let j = i + 1; j < n; j++) {
        const b = pos.get(ids[j])!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = ((i + j) % 7) - 3 || 1
          dy = ((i * j) % 5) - 2 || 1
          d2 = dx * dx + dy * dy
        }
        const inv = REP / (d2 * Math.sqrt(d2))
        a.vx += dx * inv
        a.vy += dy * inv
        b.vx -= dx * inv
        b.vy -= dy * inv
      }
    }
    // springs
    for (const e of edges) {
      const a = pos.get(e.source)
      const b = pos.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = SPRING * (d - LEN)
      const ux = (dx / d) * f
      const uy = (dy / d) * f
      a.vx += ux
      a.vy += uy
      b.vx -= ux
      b.vy -= uy
    }
    // centering + integrate
    for (const id of ids) {
      const p = pos.get(id)!
      p.vx += (VW / 2 - p.x) * CENTER
      p.vy += (VH / 2 - p.y) * CENTER
      p.vx *= DAMP
      p.vy *= DAMP
      p.x = Math.max(24, Math.min(VW - 24, p.x + p.vx))
      p.y = Math.max(24, Math.min(VH - 24, p.y + p.vy))
    }
  }
  return pos
}

function MemoryPanel() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [lr, gr] = await Promise.all([
        fetch('/api/memory?limit=400'),
        fetch('/api/memory/graph?limit=250'),
      ])
      const l = await lr.json()
      if (!l.ok) throw new Error(l.error || 'memory list failed')
      setItems(Array.isArray(l.memories) ? l.memories : [])
      const g = await gr.json().catch(() => ({ ok: false }))
      setEdges(g.ok && Array.isArray(g.edges) ? g.edges : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [items, query])

  const visible = useMemo(
    () => (view === 'graph' ? filtered.slice(0, LAYOUT_CAP) : filtered),
    [view, filtered],
  )

  const ids = useMemo(() => visible.map((m) => m.id), [visible])

  const activeEdges = useMemo(() => {
    const known = new Set(ids)
    return edges.filter((e) => known.has(e.source) && known.has(e.target))
  }, [edges, ids])

  const positions = useMemo(
    () => (view === 'graph' ? layout(ids, activeEdges) : new Map<string, Pos>()),
    [view, ids, activeEdges],
  )

  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const e of activeEdges) {
      d.set(e.source, (d.get(e.source) || 0) + 1)
      d.set(e.target, (d.get(e.target) || 0) + 1)
    }
    return d
  }, [activeEdges])

  const neighbors = useMemo(() => {
    const focus = hovered ?? selected
    if (!focus) return null
    const s = new Set<string>([focus])
    for (const e of activeEdges) {
      if (e.source === focus) s.add(e.target)
      if (e.target === focus) s.add(e.source)
    }
    return s
  }, [hovered, selected, activeEdges])

  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items])

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((m) => m.id !== id))
    if (selected === id) setSelected(null)
    try {
      await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      void load()
    }
  }

  const remember = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const d = await r.json()
      if (d.ok) {
        setDraft('')
        await load()
      } else {
        setError(d.error || 'failed to store')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectedNode = selected ? byId.get(selected) : undefined
  const legend = [
    ['conversation', SOURCE_COLOR.conversation],
    ['explicit', SOURCE_COLOR.explicit],
    ['migrated', SOURCE_COLOR.migration],
  ] as const

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={13} className="shrink-0 text-[var(--blue)]" />
          <span className="font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">
            memory · {items.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-sm border border-[var(--line)]">
            {(['graph', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] transition',
                  view === v
                    ? 'bg-[rgba(0,200,255,0.12)] text-[var(--blue)]'
                    : 'text-[var(--text-faint)] hover:text-[var(--text)]',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-sm border border-[var(--line)] p-1 text-[var(--text-faint)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
            title="Refresh"
          >
            <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 rounded-sm border border-[var(--line)] bg-black/30 px-2 py-1">
        <Search size={12} className="shrink-0 text-[var(--text-faint)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search memories…"
          className="w-full bg-transparent font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <X size={11} />
          </button>
        )}
      </div>

      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void remember()}
          placeholder="teach Cosmo something…"
          className="w-full rounded-sm border border-[var(--line)] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
        />
        <button
          type="button"
          onClick={() => void remember()}
          disabled={busy || !draft.trim()}
          className="flex shrink-0 items-center gap-1 rounded-sm border border-[var(--line-bright)] px-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[var(--green)] hover:text-[var(--green)] disabled:opacity-40"
        >
          <Plus size={11} /> save
        </button>
      </div>

      {error && <div className="text-[11px] text-[var(--red)]">{error}</div>}

      {view === 'graph' && (
        <>
          <div className="relative h-[46vh] min-h-[320px] w-full overflow-hidden rounded-sm border border-[var(--line)] bg-black/40">
            {visible.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-[var(--text-faint)]">
                {loading ? 'loading…' : 'no memories yet'}
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${VW} ${VH}`}
                preserveAspectRatio="xMidYMid meet"
                className="h-full w-full"
              >
                {activeEdges.map((e, i) => {
                  const a = positions.get(e.source)
                  const b = positions.get(e.target)
                  if (!a || !b) return null
                  const dim =
                    neighbors && !(neighbors.has(e.source) && neighbors.has(e.target))
                  return (
                    <line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="var(--blue)"
                      strokeWidth={0.7 + e.sim * 1.4}
                      opacity={dim ? 0.06 : 0.14 + e.sim * 0.5}
                    />
                  )
                })}
                {ids.map((id) => {
                  const p = positions.get(id)
                  const m = byId.get(id)
                  if (!p || !m) return null
                  const deg = degree.get(id) || 0
                  const r = 7 + Math.min(8, deg * 1.6)
                  const dim = neighbors ? !neighbors.has(id) : false
                  const isFocus = id === (hovered ?? selected)
                  return (
                    <g
                      key={id}
                      transform={`translate(${p.x} ${p.y})`}
                      className="cursor-pointer"
                      opacity={dim ? 0.22 : 1}
                      onMouseEnter={() => setHovered(id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(id === selected ? null : id)}
                    >
                      <circle
                        r={r + 3}
                        fill={SOURCE_COLOR[sourceOf(m)] || 'var(--blue)'}
                        opacity={0.12}
                      />
                      <circle
                        r={r}
                        fill={SOURCE_COLOR[sourceOf(m)] || 'var(--blue)'}
                        fillOpacity={isFocus ? 0.95 : 0.62}
                        stroke={isFocus ? 'var(--text)' : 'var(--line-bright)'}
                        strokeWidth={isFocus ? 1.6 : 0.8}
                      />
                      {(visible.length <= 40 || isFocus) && (
                        <text
                          y={r + 11}
                          textAnchor="middle"
                          className="pointer-events-none"
                          style={{
                            fontFamily: 'var(--font-mono, monospace)',
                            fontSize: 9,
                            fill: 'var(--text-dim)',
                          }}
                        >
                          {m.text.slice(0, 22)}
                          {m.text.length > 22 ? '…' : ''}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            )}

            {/* hover tooltip */}
            {hovered && byId.get(hovered) && positions.get(hovered) && (
              <div
                className="pointer-events-none absolute z-10 max-w-[240px] rounded-sm border border-[var(--line-bright)] bg-black/90 p-2"
                style={{
                  left: `${(positions.get(hovered)!.x / VW) * 100}%`,
                  top: `${(positions.get(hovered)!.y / VH) * 100}%`,
                  transform: 'translate(-50%, 8px)',
                }}
              >
                <div className="font-mono text-[10px] leading-snug text-[var(--text)]">
                  {byId.get(hovered)!.text.slice(0, 220)}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {legend.map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
            <span className="ml-auto font-mono text-[9px] text-[var(--text-faint)]">
              {activeEdges.length} links
            </span>
          </div>

          {selectedNode && (
            <div className="rounded-sm border border-[var(--line-bright)] bg-black/50 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span
                  className="font-mono text-[9px] uppercase tracking-[0.14em]"
                  style={{ color: SOURCE_COLOR[sourceOf(selectedNode)] || 'var(--blue)' }}
                >
                  {sourceOf(selectedNode)} · {ago(selectedNode.updated)}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(selectedNode.id)}
                  className="text-[var(--text-faint)] transition hover:text-[var(--red)]"
                  title="Delete memory"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-[var(--text)]">
                {selectedNode.text}
              </div>
              {selectedNode.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedNode.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-sm border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--amber)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {view === 'list' && (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {visible.map((m) => (
            <li key={m.id} className="group rounded-sm border border-[var(--line)] bg-black/30 p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[10.5px] leading-snug text-[var(--text-dim)]">
                    {m.text}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: SOURCE_COLOR[sourceOf(m)] || 'var(--blue)' }}
                    />
                    <span className="font-mono text-[9px] text-[var(--text-faint)]">
                      {ago(m.updated)}
                    </span>
                    {m.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-sm border border-[var(--line)] px-1 py-0.5 font-mono text-[8.5px] text-[var(--amber)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(m.id)}
                  className="shrink-0 text-[var(--text-faint)] opacity-0 transition hover:text-[var(--red)] group-hover:opacity-100"
                  title="Delete memory"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="font-mono text-[11px] text-[var(--text-faint)]">
              {loading ? 'loading…' : 'no memories yet'}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

registerPanelContent('memory', MemoryPanel)
