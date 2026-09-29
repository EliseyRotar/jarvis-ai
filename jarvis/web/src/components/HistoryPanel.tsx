import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, History as HistoryIcon, RefreshCw } from 'lucide-react'
import { registerPanelContent } from './RadialMenu'

interface Session {
  id: string
  title?: string
  model?: string
  message_count?: number
  started_at?: number
  last_active?: number
  tool_call_count?: number
}

interface Msg {
  role: string
  content: unknown
  timestamp?: number
  tool_name?: string
}

function preview(msg: Msg): string {
  let c = msg.content
  if (Array.isArray(c)) {
    c = c.map((p) => (typeof p === 'object' && p && 'text' in p ? (p as { text: string }).text : '')).join(' ')
  }
  if (typeof c === 'object' && c !== null) c = JSON.stringify(c)
  const s = String(c ?? '')
  return s.length > 400 ? s.slice(0, 400) + '…' : s
}

function HistoryPanel() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/hermes/sessions')
      const d = await r.json()
      const list = Array.isArray(d.data) ? d.data : Array.isArray(d.jobs) ? d.jobs : []
      setSessions(list)
      if (!list.length && d.error) setError(d.error)
      else setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const openSession = async (id: string) => {
    setOpenId(id)
    setLoading(true)
    setMessages([])
    try {
      const r = await fetch(`/api/hermes/sessions/${encodeURIComponent(id)}/messages`)
      const d = await r.json()
      const list = Array.isArray(d.data) ? d.data : Array.isArray(d.messages) ? d.messages : []
      setMessages(list)
      if (!list.length && d.error) setError(d.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (openId) {
    return (
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="rounded-sm border border-[var(--line-bright)] p-1 text-[var(--text-faint)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
            title="Back to sessions"
          >
            <ArrowLeft size={12} />
          </button>
          <span className="truncate font-mono text-[10px] tracking-[0.14em] text-[var(--text-dim)]">
            {openId}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[9.5px] text-[var(--text-faint)]">
            {messages.length} msgs
          </span>
        </div>
        {loading && <div className="text-[11px] text-[var(--text-faint)]">loading…</div>}
        <ul className="m-0 max-h-[60vh] list-none space-y-1 overflow-y-auto p-0">
          {messages.map((m, i) => (
            <li
              key={i}
              className="rounded-sm border bg-black/30 p-1.5 text-[10px]"
              style={{
                borderColor:
                  m.role === 'assistant' ? 'var(--blue)' : m.role === 'tool' ? 'var(--line)' : 'var(--green)',
              }}
            >
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
                  {m.role === 'tool' && m.tool_name ? `tool · ${m.tool_name}` : m.role}
                </span>
                {m.timestamp ? (
                  <span className="font-mono text-[8.5px] text-[var(--text-faint)]">
                    {new Date(m.timestamp * 1000).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap break-words text-[var(--text-dim)]">{preview(m)}</div>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">
          <HistoryIcon size={13} /> history · {sessions.length}
        </span>
        <button
          type="button"
          onClick={() => void loadSessions()}
          className="text-[var(--text-faint)] transition hover:text-[var(--blue)]"
          title="Refresh"
        >
          <RefreshCw size={11} />
        </button>
      </div>
      {error && <div className="text-[11px] text-[var(--red)]">{error}</div>}
      {sessions.length === 0 && !error && (
        <div className="text-[11px] text-[var(--text-faint)]">no sessions</div>
      )}
      <ul className="m-0 list-none space-y-1 p-0">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => void openSession(s.id)}
              className="w-full rounded-sm border border-[var(--line)] bg-black/30 p-2 text-left transition hover:border-[var(--blue)]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[10px] tracking-[0.14em] text-[var(--text-dim)]">
                  {s.title || s.id}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[var(--amber)]">
                  {s.message_count ?? 0} msgs
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[9.5px] text-[var(--text-faint)]">
                <span className="truncate">{s.model || ''}</span>
                <span className="shrink-0">
                  {s.last_active ? new Date(s.last_active * 1000).toLocaleString() : ''}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

registerPanelContent('history', HistoryPanel)
