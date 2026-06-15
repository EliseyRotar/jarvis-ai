import { useJarvisStore } from '@/store/jarvisStore'
import { TaskTracker } from '@/components/TaskTracker'
import { cn } from '@/lib/utils'

export function TasksPage() {
  const task = useJarvisStore((s) => s.task)
  const taskHistory = useJarvisStore((s) => s.taskHistory)

  const isActive = task && !['success', 'failed', 'partial'].includes(task.status || '')

  return (
    <div className="grid h-full grid-cols-1 gap-3.5 overflow-y-auto p-3.5 lg:grid-cols-2">
      <section className="hud-panel min-h-0">
        <div className="hud-panel-head">
          <h3>Active Task</h3>
          <span className={cn('hud-tag', isActive && 'live')}>{isActive ? 'running' : 'idle'}</span>
        </div>
        <div className="min-h-[120px] p-0">
          {task ? (
            <TaskTracker plan={task} />
          ) : (
            <div className="p-3.5 text-xs text-[var(--text-faint)]">No task currently in progress.</div>
          )}
        </div>
      </section>

      <section className="hud-panel min-h-0">
        <div className="hud-panel-head">
          <h3>Task History</h3>
          <span className="hud-tag">{taskHistory.length}</span>
        </div>
        <div className="max-h-full overflow-y-auto p-3">
          {taskHistory.length === 0 && (
            <div className="text-xs text-[var(--text-faint)]">
              No completed tasks yet this session. The Agentic Task Engine activates for complex,
              multi-step requests.
            </div>
          )}
          {taskHistory.map((plan, i) => (
            <div key={`${plan.task_id}-${i}`} className="mb-2.5">
              <TaskTracker plan={plan} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
