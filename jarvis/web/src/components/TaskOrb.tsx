import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, CircleDot, Circle, ListChecks } from 'lucide-react'
import type { TaskPlan, TaskStep } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

function StepIcon({ status }: { status: TaskStep['status'] }) {
  if (status === 'done') return <CheckCircle2 size={10} className="text-[var(--green)]" />
  if (status === 'error') return <XCircle size={10} className="text-[var(--red)]" />
  if (status === 'running') return <CircleDot size={10} className="text-[var(--blue)]" />
  return <Circle size={10} className="text-[var(--text-faint)]" />
}

export function TaskOrb({ plan }: { plan: TaskPlan }) {
  const [elapsed, setElapsed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const isComplete = plan.status === 'success' || plan.status === 'failed' || plan.status === 'partial'

  useEffect(() => {
    if (isComplete) return
    const t0 = plan.started_at ? plan.started_at * 1000 : Date.now()
    const i = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
    return () => clearInterval(i)
  }, [plan.started_at, isComplete])

  const steps = plan.steps || []
  const done = steps.filter((s) => s.status === 'done').length
  const total = steps.length
  const progress = plan.progress ?? (total ? (done / total) * 100 : 0)
  const running = steps.find((s) => s.status === 'running')

  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        'pointer-events-auto cursor-pointer overflow-hidden rounded-2xl border bg-black/55 backdrop-blur-md transition-all duration-300',
        expanded
          ? 'max-w-md border-[var(--blue)] shadow-[0_0_22px_rgba(0,200,255,0.18)]'
          : 'border-[var(--line-bright)] hover:border-[var(--blue)] hover:shadow-[0_0_14px_rgba(0,200,255,0.14)]',
      )}
    >
      {/* Header pill */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <ListChecks size={11} className={cn(isComplete ? (plan.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--green)]') : 'text-[var(--blue)]')} />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
          {isComplete ? (plan.status === 'failed' ? 'failed' : 'complete') : 'task'}
        </span>
        <div className="relative h-1 w-16 overflow-hidden rounded-full bg-[var(--line)]">
          <div
            className={cn(
              'h-full transition-[width] duration-300',
              isComplete && plan.status === 'failed' ? 'bg-[var(--red)]' : 'bg-gradient-to-r from-[var(--blue)] to-[#5cdcff]',
            )}
            style={{ width: `${progress}%`, boxShadow: '0 0 6px rgba(0,200,255,0.5)' }}
          />
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[var(--blue)]">
          {done}/{total}
        </span>
        {!isComplete && (
          <span className="font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">
            {elapsed.toFixed(1)}s
          </span>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="max-h-72 overflow-y-auto border-t border-[var(--line)] px-3 py-2">
          {plan.goal && (
            <div className="mb-2 line-clamp-2 border-l-2 border-[var(--blue)] pl-2 text-[11px] leading-snug text-[var(--text)]">
              {plan.goal}
            </div>
          )}
          <ul className="m-0 list-none space-y-1 p-0">
            {steps.map((s) => (
              <li
                key={s.n}
                className={cn(
                  'flex items-center gap-1.5 text-[11px]',
                  s.status === 'running' && 'text-[var(--blue)]',
                  s.status === 'done' && 'text-[var(--green)] opacity-70',
                  s.status === 'error' && 'text-[var(--red)]',
                  s.status === 'pending' && 'text-[var(--text-faint)]',
                )}
              >
                <StepIcon status={s.status} />
                <span className="w-4 shrink-0 text-[9px] tabular-nums text-[var(--text-faint)]">
                  {String(s.n).padStart(2, '0')}
                </span>
                <span className="flex-1 truncate">{s.label}</span>
              </li>
            ))}
          </ul>
          {isComplete && plan.summary && (
            <div className="mt-2 border-t border-[var(--line)] pt-2 text-[10.5px] leading-snug text-[var(--text-dim)]">
              {plan.summary}
            </div>
          )}
          {isComplete && plan.issues && (
            <div className="mt-1 text-[10.5px] text-[var(--amber)]">⚠ {plan.issues}</div>
          )}
          {running && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--line)] pt-2 text-[10px] text-[var(--blue)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--blue)] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--blue)]" />
              </span>
              {running.label}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
