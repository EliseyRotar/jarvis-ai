import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, CircleDot, Circle } from 'lucide-react'
import type { TaskPlan, TaskStep } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

function StepIcon({ status }: { status: TaskStep['status'] }) {
  if (status === 'done') return <CheckCircle2 size={13} className="text-[var(--green)]" />
  if (status === 'error') return <XCircle size={13} className="text-[var(--red)]" />
  if (status === 'running') return <CircleDot size={13} className="text-[var(--blue)]" />
  return <Circle size={13} className="text-[var(--text-faint)]" />
}

export function TaskTracker({ plan }: { plan: TaskPlan }) {
  const [elapsed, setElapsed] = useState(0)
  const isComplete = plan.status === 'success' || plan.status === 'failed' || plan.status === 'partial'

  useEffect(() => {
    if (isComplete) return
    const t0 = plan.started_at ? plan.started_at * 1000 : Date.now()
    const i = setInterval(() => setElapsed((Date.now() - t0) / 1000), 100)
    return () => clearInterval(i)
  }, [plan.started_at, isComplete])

  const progress = plan.progress ?? 0

  return (
    <div className="border-b border-[var(--line)] bg-gradient-to-b from-[rgba(0,200,255,0.05)] to-transparent p-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-display text-[11px] tracking-[0.28em] text-[var(--blue)]">{plan.task_id || 'TASK'}</span>
        <span className="font-mono text-[11px] tabular-nums text-[var(--amber)]">
          {isComplete ? (plan.summary ? '' : '') : `${elapsed.toFixed(1)}s`}
        </span>
      </div>
      {plan.goal && (
        <div className="mb-2.5 border-l-2 border-[var(--blue)] bg-[rgba(0,200,255,0.04)] px-2 py-1.5 text-xs text-[var(--text)]">
          {plan.goal}
        </div>
      )}
      {!isComplete && (
        <div className="mb-3 flex items-center gap-2.5">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full bg-gradient-to-r from-[var(--blue)] to-[#5cdcff] shadow-[0_0_10px_var(--blue-glow)] transition-[width] duration-400"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="min-w-[38px] text-right text-[11px] tabular-nums text-[var(--blue)]">
            {progress.toFixed(0)}%
          </span>
        </div>
      )}
      <ul className="m-0 list-none p-0">
        {(plan.steps || []).map((s) => (
          <li
            key={s.n}
            className={cn(
              'mb-0.5 flex items-start gap-2.5 border-l-2 px-2 py-1 text-xs',
              s.status === 'running' && 'border-[var(--blue)] bg-[rgba(0,200,255,0.06)] text-[var(--blue)]',
              s.status === 'done' && 'border-[var(--green)] text-[var(--green)]',
              s.status === 'error' && 'border-[var(--red)] text-[var(--red)]',
              s.status === 'pending' && 'border-[var(--line-bright)] text-[var(--text-dim)]',
            )}
          >
            <span className="mt-0.5 shrink-0">
              <StepIcon status={s.status} />
            </span>
            <span className="w-6 shrink-0 text-[10px] tabular-nums text-[var(--text-faint)]">
              {String(s.n).padStart(2, '0')}
            </span>
            <span className="flex-1">
              {s.label}
              {s.status === 'error' && s.reason && (
                <span className="mt-0.5 block text-[10.5px] text-[var(--red)]">{s.reason}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {isComplete && (
        <div
          className={cn(
            'mt-3 rounded-sm border p-2.5 shadow-[0_0_16px_rgba(25,245,177,0.18)]',
            plan.status === 'failed'
              ? 'border-[var(--red)] bg-[rgba(255,71,111,0.07)] shadow-[0_0_16px_rgba(255,71,111,0.18)]'
              : 'border-[var(--green)] bg-[rgba(25,245,177,0.07)]',
          )}
        >
          <h3
            className={cn(
              'mb-1.5 font-display text-[11px] tracking-[0.32em]',
              plan.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--green)]',
            )}
          >
            {plan.status === 'failed' ? 'TASK FAILED' : 'TASK COMPLETE'}
          </h3>
          {plan.summary && <div className="mb-2 text-xs text-[var(--text)]">{plan.summary}</div>}
          {plan.artifacts && plan.artifacts.length > 0 && (
            <ul className="m-0 list-none p-0">
              {plan.artifacts.map((a) => (
                <li key={a} className="py-0.5 text-[11px] text-[var(--text-dim)]">
                  {/^https?:\/\//i.test(a) ? (
                    <a href={a} target="_blank" rel="noopener noreferrer" className="text-[var(--blue)] hover:underline">
                      {a}
                    </a>
                  ) : (
                    a
                  )}
                </li>
              ))}
            </ul>
          )}
          {plan.issues && <div className="mt-2 text-xs text-[var(--amber)]">⚠ {plan.issues}</div>}
        </div>
      )}
    </div>
  )
}
