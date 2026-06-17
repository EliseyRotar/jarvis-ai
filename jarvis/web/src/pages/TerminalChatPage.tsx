import { useEffect, useMemo, useRef, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'
import { MicButton } from '@/components/MicButton'
import { cn } from '@/lib/utils'

type LogEntry =
  | { kind: 'user'; id: string; text: string; voice?: boolean; time: number }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; args: unknown; result?: unknown; status: 'running' | 'done' | 'error' }
  | { kind: 'live-think'; text: string }
  | { kind: 'live-response'; text: string }

function fmtArgs(a: unknown): string {
  if (a === undefined || a === null) return ''
  if (typeof a === 'string') return a
  try {
    const s = JSON.stringify(a)
    return s.length > 80 ? s.slice(0, 77) + '…' : s
  } catch {
    return String(a)
  }
}

function fmtResult(r: unknown): string {
  if (r === undefined || r === null) return ''
  const s = typeof r === 'string' ? r : (() => { try { return JSON.stringify(r) } catch { return String(r) } })()
  return s.length > 200 ? s.slice(0, 197) + '…' : s
}

export function TerminalChatPage() {
  const transcript = useJarvisStore((s) => s.transcript)
  const responseTurns = useJarvisStore((s) => s.responseTurns)
  const responseLive = useJarvisStore((s) => s.responseLive)
  const thinkText = useJarvisStore((s) => s.thinkText)
  const thinkLive = useJarvisStore((s) => s.thinkLive)
  const toolCalls = useJarvisStore((s) => s.toolCalls)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const sendText = useJarvisStore((s) => s.sendText)

  const [text, setText] = useState('')
  const [showThink, setShowThink] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)

  // Build unified log
  const log: LogEntry[] = useMemo(() => {
    const items: LogEntry[] = []
    // Interleave user transcript + assistant responses by index (they roughly correspond turn-by-turn).
    const maxLen = Math.max(transcript.length, responseTurns.length)
    for (let i = 0; i < maxLen; i++) {
      const u = transcript[i]
      const a = responseTurns[i]
      if (u) items.push({ kind: 'user', id: u.id, text: u.text, voice: u.voice, time: u.time })
      if (a) items.push({ kind: 'assistant', id: a.id, text: a.text })
    }
    // Tool calls — append in chronological order at the end (they're always part of current turn).
    for (const t of toolCalls) {
      items.push({ kind: 'tool', id: t.id, name: t.name, args: t.args, result: t.result, status: t.status })
    }
    return items
  }, [transcript, responseTurns, toolCalls])

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickyRef.current) el.scrollTop = el.scrollHeight
  }, [log, responseLive, thinkText])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendText(t, false)
    setText('')
  }

  return (
    <div className="flex h-full flex-col bg-black" style={{ fontFamily: 'var(--mono)' }}>
      {/* Scrolling log */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] leading-[1.55]"
      >
        {log.length === 0 && !thinkText && !responseLive && (
          <div className="text-[var(--text-faint)]">
            <div>eli6 ready.</div>
            <div>type below or hit the mic. ask anything.</div>
          </div>
        )}
        {log.map((e) => {
          if (e.kind === 'user') {
            return (
              <div key={e.id} className="mb-2">
                <span className="text-[var(--amber)]">{e.voice ? '🎙 ' : '> '}</span>
                <span className="text-[var(--text)]">{e.text}</span>
              </div>
            )
          }
          if (e.kind === 'assistant') {
            return (
              <div key={e.id} className="mb-3 whitespace-pre-wrap">
                <span className="text-[var(--text-dim)]">· </span>
                <span className="text-[var(--text)]">{e.text}</span>
              </div>
            )
          }
          if (e.kind === 'tool') {
            const statusColor =
              e.status === 'error' ? 'text-[var(--red)]' :
              e.status === 'running' ? 'text-[var(--amber)]' :
              'text-[var(--text-dim)]'
            return (
              <div key={e.id} className={cn('mb-1 text-[12px]', statusColor)}>
                <span>[{e.status}] {e.name}</span>
                {fmtArgs(e.args) && <span> → {fmtArgs(e.args)}</span>}
                {e.result !== undefined && (
                  <div className="ml-4 whitespace-pre-wrap text-[var(--text-faint)]">{fmtResult(e.result)}</div>
                )}
              </div>
            )
          }
          return null
        })}

        {/* Live streaming response */}
        {responseLive && (
          <div className="mb-3 whitespace-pre-wrap">
            <span className="text-[var(--text-dim)]">· </span>
            <span className="text-[var(--text)]">{responseLive}</span>
            <span className="crt-cursor text-[var(--text)]">█</span>
          </div>
        )}

        {/* Optional thinking trace */}
        {showThink && thinkText && (
          <div className="mb-3 whitespace-pre-wrap text-[var(--text-faint)] italic">
            <span>[think] </span>
            {thinkText}
            {thinkLive && <span className="crt-cursor">█</span>}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--line)] bg-black px-4 py-2">
        <span className="text-[var(--amber)] text-[14px]">{'>'}</span>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={turnActive ? 'thinking…' : 'type a message'}
          className="flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          style={{ fontFamily: 'var(--mono)' }}
          autoFocus
        />
        <button
          type="button"
          onClick={() => setShowThink((s) => !s)}
          className={cn(
            'rounded-none border border-[var(--line-bright)] px-2 py-1 text-[11px] transition',
            showThink ? 'text-[var(--amber)] border-[var(--amber)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]',
          )}
        >
          [think]
        </button>
        <MicButton />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className={cn(
            'rounded-none border border-[var(--text)] px-2 py-1 text-[11px] text-[var(--text)] transition hover:bg-[var(--text)] hover:text-black',
            !text.trim() && 'opacity-40',
          )}
        >
          [send]
        </button>
      </div>
    </div>
  )
}
