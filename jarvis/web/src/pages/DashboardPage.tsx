import { useEffect, useState } from 'react'
import { useJarvisStore, modelLabel } from '@/store/jarvisStore'
import { ToolCallCard } from '@/components/ToolCallCard'
import { cn } from '@/lib/utils'

type Healthz = {
  ok: boolean
  backend: string
  claude_model: string
  openrouter_model: string
  ollama_model: string
  credentials: { claude_oauth: boolean; openrouter: boolean; anthropic_api_key_shadowing: boolean }
  clients: number
  conversation_length: number
}

function StatCard({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="hud-panel min-h-0 p-3.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.25em] text-[var(--text-dim)]">{label}</div>
      <div className={cn('font-display text-xl tracking-[0.08em]', accent || 'text-[var(--text)]')}>{value}</div>
    </div>
  )
}

export function DashboardPage() {
  const connected = useJarvisStore((s) => s.connected)
  const reactor = useJarvisStore((s) => s.reactor)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const toolCalls = useJarvisStore((s) => s.toolCalls)
  const task = useJarvisStore((s) => s.task)
  const taskHistory = useJarvisStore((s) => s.taskHistory)
  const transcript = useJarvisStore((s) => s.transcript)
  const [health, setHealth] = useState<Healthz | null>(null)

  useEffect(() => {
    const load = () => {
      fetch('/healthz')
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => {})
    }
    load()
    const i = setInterval(load, 5000)
    return () => clearInterval(i)
  }, [])

  const successCount = taskHistory.filter((t) => t.status === 'success').length
  const failedCount = taskHistory.filter((t) => t.status === 'failed' || t.status === 'partial').length

  return (
    <div className="grid h-full grid-cols-1 gap-3.5 overflow-y-auto p-3.5 lg:grid-cols-3">
      <StatCard
        label="Link Status"
        value={connected ? 'ONLINE' : 'OFFLINE'}
        accent={connected ? 'text-[var(--blue)]' : 'text-[var(--red)]'}
      />
      <StatCard label="Reactor State" value={reactor} accent="text-[var(--amber)]" />
      <StatCard label="Active Model" value={modelLabel(activeModel || '—')} accent="text-[var(--green)]" />

      <StatCard label="Backend" value={health?.backend ?? '—'} />
      <StatCard label="Connected Clients" value={health?.clients ?? '—'} />
      <StatCard label="Conversation Length" value={health?.conversation_length ?? '—'} />

      <StatCard label="Transcript Entries" value={transcript.length} />
      <StatCard label="Tasks Completed" value={successCount} accent="text-[var(--green)]" />
      <StatCard label="Tasks Failed/Partial" value={failedCount} accent={failedCount ? 'text-[var(--red)]' : 'text-[var(--text)]'} />

      <section className="hud-panel col-span-1 min-h-0 lg:col-span-2">
        <div className="hud-panel-head">
          <h3>Recent Tool Activity</h3>
          <span className={cn('hud-tag', toolCalls.some((t) => t.status === 'running') && 'live')}>
            {toolCalls.length} calls
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto p-3">
          {toolCalls.length === 0 && <div className="text-xs text-[var(--text-faint)]">No tool activity yet.</div>}
          {toolCalls
            .slice(-8)
            .reverse()
            .map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}
        </div>
      </section>

      <section className="hud-panel col-span-1 min-h-0">
        <div className="hud-panel-head">
          <h3>Credentials</h3>
          <span className="hud-tag">{health ? 'ok' : 'idle'}</span>
        </div>
        <div className="space-y-2 p-3 text-xs">
          {health ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">Claude OAuth</span>
                <span className={health.credentials.claude_oauth ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
                  {health.credentials.claude_oauth ? 'present' : 'missing'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">OpenRouter Key</span>
                <span className={health.credentials.openrouter ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
                  {health.credentials.openrouter ? 'present' : 'missing'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">Claude Model</span>
                <span className="text-[var(--text)]">{health.claude_model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">OpenRouter Model</span>
                <span className="text-[var(--text)]">{health.openrouter_model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-dim)]">Ollama Model</span>
                <span className="text-[var(--text)]">{health.ollama_model}</span>
              </div>
            </>
          ) : (
            <div className="text-[var(--text-faint)]">Loading…</div>
          )}
        </div>
      </section>

      {task && (
        <section className="hud-panel col-span-1 min-h-0 lg:col-span-3">
          <div className="hud-panel-head">
            <h3>Active Task</h3>
            <span className={cn('hud-tag', task.status ? '' : 'live')}>{task.status || 'running'}</span>
          </div>
          <div className="p-3 text-xs">
            <div className="mb-1 font-display text-[11px] tracking-[0.28em] text-[var(--blue)]">{task.task_id}</div>
            <div className="text-[var(--text)]">{task.goal}</div>
          </div>
        </section>
      )}
    </div>
  )
}
