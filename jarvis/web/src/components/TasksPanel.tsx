import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, CircleDot, Circle } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { registerPanelContent } from './RadialMenu'

function TasksPanel() {
  const task = useJarvisStore((s) => s.task)
  const taskHistory = useJarvisStore((s) => s.taskHistory)
  const [list, setList] = useState(taskHistory.slice(0, 30))

  useEffect(() => {
    setList(taskHistory.slice(0, 30))
  }, [taskHistory])

  return (
    <div className="space-y-3 p-3">
      <section>
        <h4 className="mb-1.5 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Active plan</h4>
        {task ? (
          <div className="rounded-sm border border-[var(--blue)] bg-[rgba(0,200,255,0.05)] p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--text-dim)]">{task.task_id || 'TASK'}</span>
              <span className="font-mono text-[10px] text-[var(--amber)]">
                {task.progress?.toFixed(0) ?? 0}%
              </span>
            </div>
            {task.goal && (
              <div className="mb-2 border-l-2 border-[var(--blue)] bg-[rgba(0,200,255,0.04)] px-2 py-1 text-[11px] text-[var(--text)]">{task.goal}</div>
            )}
            <ul className="m-0 list-none space-y-0.5 p-0">
              {(task.steps || []).map((s) => (
                <li key={s.n} className="flex items-start gap-2 border-l-2 px-2 py-1 text-[11px]" style={{
                  borderColor: s.status === 'running' ? 'var(--blue)' : s.status === 'done' ? 'var(--green)' : s.status === 'error' ? 'var(--red)' : 'var(--line-bright)',
                  color: s.status === 'running' ? 'var(--blue)' : s.status === 'done' ? 'var(--green)' : s.status === 'error' ? 'var(--red)' : 'var(--text-dim)',
                }}>
                  {s.status === 'done' ? <CheckCircle2 size={11} /> : s.status === 'error' ? <XCircle size={11} /> : s.status === 'running' ? <CircleDot size={11} /> : <Circle size={11} />}
                  <span className="w-5 shrink-0 text-[9px] tabular-nums opacity-60">{String(s.n).padStart(2, '0')}</span>
                  <span className="flex-1">{s.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-[var(--text-dim)] text-[11px]">No active task.</div>
        )}
      </section>

      <section>
        <h4 className="mb-1.5 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--text-faint)]">Recent</h4>
        {list.length === 0 && <div className="text-[var(--text-faint)] text-[11px]">no history</div>}
        <ul className="m-0 list-none space-y-1 p-0">
          {list.map((p, i) => (
            <li key={i} className="rounded-sm border border-[var(--line)] bg-black/30 p-2 text-[10.5px]">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] tracking-[0.16em] text-[var(--text-dim)]">{p.task_id || `task ${list.length - i}`}</span>
                <span className={`font-mono text-[9.5px] ${p.status === 'success' ? 'text-[var(--green)]' : p.status === 'failed' ? 'text-[var(--red)]' : 'text-[var(--amber)]'}`}>
                  {p.status}
                </span>
              </div>
              {p.goal && <div className="mt-1 truncate text-[10.5px] text-[var(--text-dim)]">{p.goal}</div>}
              {p.summary && <div className="mt-1 truncate text-[10px] text-[var(--text-faint)]">{p.summary}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

registerPanelContent('tasks', TasksPanel)
