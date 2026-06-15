import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { MarkdownBlock } from '@/components/MessageBubble'
import { cn } from '@/lib/utils'

type HistoryMessage = {
  role: string
  content: unknown
}

function contentToText(content: unknown) {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

export function LogsPage() {
  const [messages, setMessages] = useState<HistoryMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch('/api/history')
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'failed')
        setMessages(data.messages || [])
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="flex h-full flex-col p-3.5">
      <section className="hud-panel flex min-h-0 flex-1 flex-col">
        <div className="hud-panel-head">
          <h3>Conversation Log</h3>
          <div className="flex items-center gap-2">
            <span className="hud-tag">{messages.length} messages</span>
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
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5 text-sm leading-[1.65]">
          {error && <div className="p-2 text-xs text-[var(--red)]">Error: {error}</div>}
          {!error && messages.length === 0 && (
            <div className="text-xs text-[var(--text-faint)]">No persisted history yet.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className="mb-3 border-l-2 border-[var(--line-bright)] pl-2.5">
              <div
                className={cn(
                  'mb-1 text-[9px] uppercase tracking-[0.25em]',
                  m.role === 'user' ? 'text-[var(--amber)]' : 'text-[var(--blue)]',
                )}
              >
                {m.role}
              </div>
              {m.role === 'assistant' ? (
                <MarkdownBlock text={contentToText(m.content)} />
              ) : (
                <div className="whitespace-pre-wrap text-[var(--text)]">{contentToText(m.content)}</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
