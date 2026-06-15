import { useEffect } from 'react'
import { Power, RotateCcw, Square } from 'lucide-react'
import { useJarvisStore, loadModels, setModel, modelLabel } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

export function SettingsPage() {
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const connected = useJarvisStore((s) => s.connected)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const reset = useJarvisStore((s) => s.reset)
  const stop = useJarvisStore((s) => s.stop)
  const pushToast = useJarvisStore((s) => s.pushToast)

  useEffect(() => {
    loadModels()
  }, [])

  const doReset = () => {
    if (!confirm('Reset the current conversation? This clears chat history and memory of this session.')) return
    reset()
    fetch('/reset', { method: 'POST' }).catch(() => {})
    pushToast('Conversation reset', 'ok')
  }

  const doShutdown = () => {
    if (!confirm('Shut down JARVIS completely?')) return
    fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
  }

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-3.5">
      <section className="hud-panel min-h-0">
        <div className="hud-panel-head">
          <h3>Model</h3>
          <span className={cn('hud-tag', connected && 'live')}>{connected ? 'link' : 'offline'}</span>
        </div>
        <div className="flex flex-col gap-2 p-3.5">
          <div className="text-xs text-[var(--text-dim)]">Active model</div>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={cn(
                  'rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
                  m === activeModel
                    ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
                    : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                )}
              >
                {modelLabel(m)}
              </button>
            ))}
            {models.length === 0 && <div className="text-xs text-[var(--text-faint)]">Loading models…</div>}
          </div>
        </div>
      </section>

      <section className="hud-panel min-h-0">
        <div className="hud-panel-head">
          <h3>Session Controls</h3>
        </div>
        <div className="flex flex-wrap gap-3 p-3.5">
          <button
            type="button"
            onClick={() => stop()}
            disabled={!turnActive}
            className={cn(
              'flex items-center gap-1.5 rounded-sm border border-[var(--amber)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--amber)] transition hover:bg-[rgba(255,179,0,0.1)] hover:shadow-[0_0_12px_var(--amber-glow)]',
              !turnActive && 'opacity-35',
            )}
          >
            <Square size={12} />
            STOP TURN
          </button>
          <button
            type="button"
            onClick={doReset}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]"
          >
            <RotateCcw size={12} />
            RESET CONVERSATION
          </button>
          <button
            type="button"
            onClick={doShutdown}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--red)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--red)] transition hover:bg-[rgba(255,71,111,0.12)] hover:shadow-[0_0_12px_var(--red-glow)]"
          >
            <Power size={12} />
            SHUT DOWN
          </button>
        </div>
      </section>

      <section className="hud-panel min-h-0">
        <div className="hud-panel-head">
          <h3>About</h3>
        </div>
        <div className="space-y-1.5 p-3.5 text-xs text-[var(--text-dim)]">
          <div>JARVIS — Just A Rather Very Intelligent System</div>
          <div>Web UI v2 — React 19 / Vite / Tailwind 4</div>
          <div>
            Keyboard shortcut: <kbd className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 text-[10px]">Ctrl/Cmd+K</kbd> opens the command palette.
          </div>
        </div>
      </section>
    </div>
  )
}
