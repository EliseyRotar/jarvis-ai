import { useCallback, useEffect, useState } from 'react'
import { AlarmClock, Pause, Play, RefreshCw, Trash2, Plus } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { registerPanelContent } from './RadialMenu'

interface ReminderJob {
  id: number
  name?: string
  prompt: string
  kind: 'once' | 'interval' | 'daily'
  spec: string
  next_run_iso?: string
  enabled: number
  runs?: number
  last_result?: string
}

interface HermesJob {
  id?: string
  job_id?: string
  name?: string
  schedule?: string
  cron?: string
  prompt?: string
  enabled?: boolean
  status?: string
  next_run?: string | number
}

const SPEC_HINT: Record<ReminderJob['kind'], string> = {
  once: 'ISO datetime — 2026-09-29T15:30',
  interval: 'seconds — 1800 (= every 30 min)',
  daily: 'time of day — 08:00',
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  return res.json()
}

function JobsPanel() {
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [reminders, setReminders] = useState<ReminderJob[]>([])
  const [hermesJobs, setHermesJobs] = useState<HermesJob[]>([])
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<ReminderJob['kind']>('once')
  const [spec, setSpec] = useState('')

  const refresh = useCallback(async () => {
    try {
      const r = await api('/api/scheduler')
      setReminders(Array.isArray(r.jobs) ? r.jobs : [])
    } catch {
      setReminders([])
    }
    try {
      const h = await api('/api/hermes/jobs')
      setHermesJobs(Array.isArray(h.jobs) ? h.jobs : [])
    } catch {
      setHermesJobs([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createReminder = async () => {
    if (!prompt.trim() || !spec.trim()) {
      pushToast('prompt and schedule are required', 'err')
      return
    }
    setBusy(true)
    try {
      const data = await api('/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim(), kind, spec: spec.trim() }),
      })
      if (data.ok) {
        pushToast(`reminder set — fires ${data.next_run ?? ''}`.trim(), 'ok')
        setName('')
        setPrompt('')
        setSpec('')
        await refresh()
      } else {
        pushToast(data.error || 'failed to create reminder', 'err')
      }
    } catch (e) {
      pushToast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const toggleReminder = async (job: ReminderJob) => {
    try {
      const data = await api(`/api/scheduler/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !job.enabled }),
      })
      if (!data.ok) pushToast(data.error || 'toggle failed', 'err')
      await refresh()
    } catch (e) {
      pushToast((e as Error).message, 'err')
    }
  }

  const deleteReminder = async (job: ReminderJob) => {
    try {
      const data = await api(`/api/scheduler/${job.id}`, { method: 'DELETE' })
      if (!data.ok) pushToast(data.error || 'delete failed', 'err')
      else pushToast('reminder removed', 'ok')
      await refresh()
    } catch (e) {
      pushToast((e as Error).message, 'err')
    }
  }

  const hermesAction = async (job: HermesJob, action: 'pause' | 'resume' | 'run' | 'delete') => {
    const id = job.id ?? job.job_id
    if (!id) return
    try {
      const data =
        action === 'delete'
          ? await api(`/api/hermes/jobs/${id}`, { method: 'DELETE' })
          : await api(`/api/hermes/jobs/${id}/${action}`, { method: 'POST' })
      if (!data.ok) pushToast(data.error || `${action} failed`, 'err')
      else pushToast(action === 'run' ? 'job run' : `job ${action}d`, 'ok')
      await refresh()
    } catch (e) {
      pushToast((e as Error).message, 'err')
    }
  }

  return (
    <div className="space-y-4 p-3">
      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">
          <AlarmClock size={12} /> Reminders
        </h4>

        <div className="mb-2 space-y-1.5 rounded-sm border border-[var(--line)] bg-black/30 p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name (optional)"
            className="w-full rounded-sm border border-[var(--line-bright)] bg-black/40 px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]"
          />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="what should Cosmo say/do when it fires"
            className="w-full rounded-sm border border-[var(--line-bright)] bg-black/40 px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]"
          />
          <div className="flex gap-1.5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ReminderJob['kind'])}
              className="rounded-sm border border-[var(--line-bright)] bg-black/40 px-1.5 py-1 font-mono text-[11px] text-[var(--text-dim)] outline-none focus:border-[var(--blue)]"
            >
              <option value="once">once</option>
              <option value="interval">interval</option>
              <option value="daily">daily</option>
            </select>
            <input
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={SPEC_HINT[kind]}
              className="flex-1 rounded-sm border border-[var(--line-bright)] bg-black/40 px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]"
            />
            <button
              type="button"
              onClick={createReminder}
              disabled={busy}
              className="rounded-sm border border-[var(--blue)] px-2 text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.12)] disabled:opacity-40"
              title="Create reminder"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {reminders.length === 0 && (
          <div className="text-[11px] text-[var(--text-faint)]">no reminders scheduled</div>
        )}
        <ul className="m-0 list-none space-y-1 p-0">
          {reminders.map((j) => (
            <li key={j.id} className="rounded-sm border border-[var(--line)] bg-black/30 p-2 text-[10.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[10px] tracking-[0.14em] text-[var(--text-dim)]">
                  {j.name || j.prompt.slice(0, 40)}
                </span>
                <span className="shrink-0 font-mono text-[9.5px] text-[var(--amber)]">
                  {j.kind}·{j.spec}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className={`truncate text-[10px] ${j.enabled ? 'text-[var(--green)]' : 'text-[var(--text-faint)]'}`}>
                  {j.enabled ? `next ${j.next_run_iso ?? '?'}` : 'paused'}
                  {j.runs ? ` · ran ${j.runs}×` : ''}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleReminder(j)}
                    className="text-[var(--text-faint)] transition hover:text-[var(--blue)]"
                    title={j.enabled ? 'Pause' : 'Resume'}
                  >
                    <Pause size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteReminder(j)}
                    className="text-[var(--text-faint)] transition hover:text-[var(--red)]"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
              <div className="mt-0.5 truncate text-[9.5px] text-[var(--text-faint)]">{j.prompt}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="font-display text-[11px] uppercase tracking-[0.2em] text-[var(--text-faint)]">Hermes cron</h4>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[var(--text-faint)] transition hover:text-[var(--blue)]"
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
        </div>
        {hermesJobs.length === 0 && (
          <div className="text-[11px] text-[var(--text-faint)]">no Hermes jobs — ask Cosmo to schedule one</div>
        )}
        <ul className="m-0 list-none space-y-1 p-0">
          {hermesJobs.map((j, i) => {
            const id = j.id ?? j.job_id ?? String(i)
            return (
              <li key={id} className="rounded-sm border border-[var(--line)] bg-black/30 p-2 text-[10.5px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-[10px] tracking-[0.14em] text-[var(--text-dim)]">
                    {j.name || id}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-[var(--amber)]">
                    {j.schedule ?? j.cron ?? ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className={`truncate text-[10px] ${j.enabled === false ? 'text-[var(--text-faint)]' : 'text-[var(--green)]'}`}>
                    {j.status || (j.enabled === false ? 'paused' : 'active')}
                    {j.next_run ? ` · ${typeof j.next_run === 'number' ? new Date(j.next_run * 1000).toLocaleString() : j.next_run}` : ''}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void hermesAction(j, j.enabled === false ? 'resume' : 'pause')}
                      className="text-[var(--text-faint)] transition hover:text-[var(--blue)]"
                      title={j.enabled === false ? 'Resume' : 'Pause'}
                    >
                      <Play size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void hermesAction(j, 'run')}
                      className="text-[var(--text-faint)] transition hover:text-[var(--amber)]"
                      title="Run now"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void hermesAction(j, 'delete')}
                      className="text-[var(--text-faint)] transition hover:text-[var(--red)]"
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
                {j.prompt && <div className="mt-0.5 truncate text-[9.5px] text-[var(--text-faint)]">{j.prompt}</div>}
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

registerPanelContent('jobs', JobsPanel)
