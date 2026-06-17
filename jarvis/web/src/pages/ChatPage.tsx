import { useEffect, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { TerminalChatPage } from './TerminalChatPage'
import { Reactor } from '@/components/Reactor'
import { MarkdownBlock, LiveResponse } from '@/components/MessageBubble'
import { ToolCallCard } from '@/components/ToolCallCard'
import { TaskTracker } from '@/components/TaskTracker'
import { MicButton } from '@/components/MicButton'
import { StreamingDots } from '@/components/StreamingDots'
import { cn } from '@/lib/utils'

function useAutoscroll<T>(dep: T) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const onScroll = () => {
      stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
    }
    node.addEventListener('scroll', onScroll)
    return () => node.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const node = ref.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [dep])
  return ref
}

function ThinkPanel() {
  const thinkText = useJarvisStore((s) => s.thinkText)
  const thinkLive = useJarvisStore((s) => s.thinkLive)
  const ref = useAutoscroll(thinkText)
  return (
    <section className="hud-panel min-h-0 flex-1">
      <div className="hud-panel-head">
        <h3>Thinking</h3>
        <span className={cn('hud-tag', thinkLive && 'live')}>{thinkLive ? 'live' : 'ready'}</span>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3.5 text-[12.5px] leading-[1.55]">
        <div className="whitespace-pre-wrap italic text-[#8ecbe5] opacity-90">
          {thinkText}
          {thinkLive && <span className="hud-caret" />}
        </div>
      </div>
    </section>
  )
}

function TurnMetaFooter() {
  const meta = useJarvisStore((s) => s.lastTurnMeta)
  if (!meta) return null
  const usage = meta.usage || {}
  const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0)
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-3.5 py-1.5 text-[10px] uppercase tracking-[0.15em] text-[var(--text-faint)]">
      {meta.model && <span>{meta.model}</span>}
      {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tok</span>}
      {typeof meta.total_cost_usd === 'number' && <span>${meta.total_cost_usd.toFixed(4)}</span>}
      {typeof meta.duration_ms === 'number' && <span>{(meta.duration_ms / 1000).toFixed(1)}s</span>}
    </div>
  )
}

function ResponsePanel() {
  const responseTurns = useJarvisStore((s) => s.responseTurns)
  const responseLive = useJarvisStore((s) => s.responseLive)
  const responseState = useJarvisStore((s) => s.responseState)
  const ref = useAutoscroll(responseLive + responseTurns.length)
  return (
    <section className="flex min-h-0 flex-[1.2] flex-col border-b border-[var(--line)]">
      <div className="hud-panel-head">
        <h3>Response</h3>
        <span className={cn('hud-tag', responseState === 'streaming' && 'live')}>{responseState}</span>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3.5 text-sm leading-[1.65]" style={{ textShadow: '0 0 8px rgba(0,200,255,0.15)' }}>
        {responseTurns.map((t, i) => (
          <div key={t.id}>
            {i > 0 && <hr className="my-2.5 border-0 opacity-45" style={{ height: 1, background: 'linear-gradient(to right, transparent, var(--blue-dim), transparent)' }} />}
            <MarkdownBlock text={t.text} />
          </div>
        ))}
        {responseLive && (
          <>
            {responseTurns.length > 0 && <hr className="my-2.5 border-0 opacity-45" style={{ height: 1, background: 'linear-gradient(to right, transparent, var(--blue-dim), transparent)' }} />}
            <LiveResponse text={responseLive} />
          </>
        )}
        {responseTurns.length === 0 && !responseLive && (
          <div className="text-[var(--text-faint)]">Awaiting input…</div>
        )}
      </div>
      <TurnMetaFooter />
    </section>
  )
}

function TranscriptPanel() {
  const transcript = useJarvisStore((s) => s.transcript)
  const ref = useAutoscroll(transcript.length)
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="hud-panel-head">
        <h3>Transcript</h3>
        <span className="hud-tag">{transcript.length ? (transcript[transcript.length - 1].voice ? 'voice' : 'text') : 'idle'}</span>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3.5 text-xs text-[var(--text-dim)]">
        {transcript.map((t) => (
          <div key={t.id} className={cn('mb-2 border-l-2 pl-2.5', t.voice ? 'border-[var(--amber)]' : 'border-[var(--line-bright)]')}>
            <div className={cn('mb-0.5 text-[9px] uppercase tracking-[0.25em]', t.voice ? 'text-[var(--amber)]' : 'text-[var(--blue)]')}>
              {t.voice ? 'VOICE › OPERATOR' : 'TEXT › OPERATOR'}
            </div>
            <div className="text-[var(--text)]">{t.text}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActionsPanel() {
  const toolCalls = useJarvisStore((s) => s.toolCalls)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const ref = useAutoscroll(toolCalls.length)
  const running = toolCalls.some((t) => t.status === 'running')
  return (
    <section className="hud-panel min-h-0 flex-1">
      <div className="hud-panel-head">
        <h3>Actions</h3>
        <span className={cn('hud-tag', running && 'live')}>{running ? 'running' : toolCalls.length ? 'ok' : 'idle'}</span>
      </div>
      <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3">
        {toolCalls.length === 0 && !turnActive && (
          <div className="text-xs text-[var(--text-faint)]">No tool activity yet.</div>
        )}
        {toolCalls.map((c) => (
          <ToolCallCard key={c.id} call={c} />
        ))}
        {turnActive && toolCalls.every((t) => t.status !== 'running') && (
          <div className="px-1 py-1 text-xs text-[var(--text-dim)]">
            <StreamingDots />
          </div>
        )}
      </div>
    </section>
  )
}

function Composer() {
  const [text, setText] = useState('')
  const sendText = useJarvisStore((s) => s.sendText)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const stop = useJarvisStore((s) => s.stop)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    sendText(t, false)
    setText('')
  }

  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-[var(--line)] bg-[var(--bg-elev-2)] p-2.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Speak, sir…"
        className="flex-1 rounded-sm border border-[var(--line-bright)] bg-transparent px-2.5 py-2 font-mono text-sm text-[var(--text)] outline-none transition focus:border-[var(--blue)] focus:shadow-[0_0_10px_var(--blue-glow)]"
      />
      <MicButton />
      <button
        type="submit"
        className="flex items-center gap-1.5 rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]"
      >
        <Send size={13} />
        SEND
      </button>
      <button
        type="button"
        onClick={stop}
        className={cn(
          'flex items-center gap-1.5 rounded-sm border border-[var(--red)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--red)] transition hover:bg-[rgba(255,71,111,0.12)] hover:shadow-[0_0_12px_var(--red-glow)]',
          turnActive ? 'opacity-100' : 'opacity-35',
        )}
      >
        <Square size={12} />
        STOP
      </button>
    </form>
  )
}

export function ChatPage() {
  const task = useJarvisStore((s) => s.task)
  const persona = useJarvisStore((s) => s.persona)
  if (persona === 'eli6') return <TerminalChatPage />
  return (
    <div className="grid h-full grid-cols-1 gap-3.5 p-3.5 lg:grid-cols-[1fr_1.15fr_1fr]">
      <ThinkPanel />
      <div className="flex min-h-0 flex-col gap-3.5">
        <div className="hud-panel min-h-0 flex-1 overflow-hidden p-0">
          <Reactor />
          <div className="flex min-h-0 flex-1 flex-col">
            {task && <TaskTracker plan={task} />}
            <ResponsePanel />
            <TranscriptPanel />
            <Composer />
          </div>
        </div>
      </div>
      <ActionsPanel />
    </div>
  )
}
