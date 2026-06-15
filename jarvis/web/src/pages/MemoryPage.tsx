import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type MemoryEntry = {
  key: string
  value: unknown
  tags: string[]
  created: number
  updated: number
}

function formatTime(ts: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function valueToString(value: unknown) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch('/api/memory?limit=200')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'failed')
        setMemories(data.memories || [])
        setCount(data.count || 0)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const addEntry = (e: React.FormEvent) => {
    e.preventDefault()
    const key = newKey.trim()
    if (!key) return
    let value: unknown = newValue
    try {
      value = JSON.parse(newValue)
    } catch {
      value = newValue
    }
    const tags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setSaving(true)
    setError(null)
    fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, tags }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'failed')
        setNewKey('')
        setNewValue('')
        setNewTags('')
        load()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setSaving(false))
  }

  const deleteEntry = (key: string) => {
    setError(null)
    fetch(`/api/memory/${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'failed')
        load()
      })
      .catch((e) => setError(String(e)))
  }

  const filtered = memories.filter((m) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      m.key.toLowerCase().includes(q) ||
      m.tags?.some((t) => t.toLowerCase().includes(q)) ||
      valueToString(m.value).toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex h-full flex-col p-3.5">
      <section className="hud-panel flex min-h-0 flex-1 flex-col">
        <div className="hud-panel-head">
          <h3>Long-Term Memory</h3>
          <div className="flex items-center gap-2">
            <span className="hud-tag">{count} entries</span>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1 rounded-sm border border-[var(--line-bright)] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
            >
              <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
        <div className="border-b border-[var(--line)] p-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by key, tag, or value…"
            className="w-full rounded-sm border border-[var(--line-bright)] bg-transparent px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--blue)]"
          />
        </div>
        <form onSubmit={addEntry} className="flex flex-col gap-2 border-b border-[var(--line)] p-2.5">
          <div className="flex gap-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="Key"
              className="w-1/3 rounded-sm border border-[var(--line-bright)] bg-transparent px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--blue)]"
            />
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="flex-1 rounded-sm border border-[var(--line-bright)] bg-transparent px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--blue)]"
            />
          </div>
          <textarea
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value (plain text or JSON)…"
            rows={3}
            className="w-full resize-y rounded-sm border border-[var(--line-bright)] bg-transparent px-2.5 py-1.5 font-mono text-xs text-[var(--text)] outline-none focus:border-[var(--blue)]"
          />
          <button
            type="submit"
            disabled={saving || !newKey.trim()}
            className={cn(
              'flex w-fit items-center gap-1.5 rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
              (saving || !newKey.trim()) && 'opacity-35',
            )}
          >
            <Plus size={12} />
            ADD ENTRY
          </button>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {error && <div className="p-2 text-xs text-[var(--red)]">Error: {error}</div>}
          {!error && filtered.length === 0 && (
            <div className="p-2 text-xs text-[var(--text-faint)]">No matching memory entries.</div>
          )}
          {filtered.map((m) => (
            <div key={m.key} className="mb-2 rounded-sm border border-[var(--line)] p-2.5">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-[var(--blue)]">{m.key}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-faint)]">{formatTime(m.updated)}</span>
                  <button
                    type="button"
                    onClick={() => deleteEntry(m.key)}
                    title="Delete entry"
                    className="flex items-center text-[var(--text-faint)] transition hover:text-[var(--red)]"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {m.tags && m.tags.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-[var(--line-bright)] px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[var(--amber)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <pre className="m-0 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-[var(--text)]">
                {valueToString(m.value)}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
