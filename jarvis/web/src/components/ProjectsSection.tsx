import { useEffect, useState } from 'react'
import { FolderPlus, FolderMinus, Loader2 } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

interface Project {
  name: string
  built_in: boolean
  cwd?: string
  model?: string
  provider?: string
  notes?: string
  added_at?: number
}

const DEFAULT_FORM = {
  name: '',
  cwd: '',
  project_title: '',
  project_description: '',
  tech_stack: '',
  conventions: '',
  notes: '',
}

type FormState = typeof DEFAULT_FORM

function cleanPreview(s: string, max = 320): string {
  const t = s.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return '…' + t.slice(t.length - max)
}

export function ProjectsSection() {
  const pushToast = useJarvisStore((s) => s.pushToast)
  const mode = useJarvisStore((s) => s.mode)
  const setMode = useJarvisStore((s) => s.setMode)

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [preview, setPreview] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const fetchProjects = () => {
    setLoading(true)
    fetch('/api/admin/projects')
      .then((r) => r.json())
      .then((data: { ok: boolean; projects: Project[] }) => {
        setProjects(data.projects || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { fetchProjects() }, [])

  useEffect(() => {
    const onWizardOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { name?: string }
      setShowForm(true)
      setForm((f) => ({ ...f, name: detail?.name || f.name }))
      pushToast(`Project wizard opened for "${detail?.name || ''}"`, 'info')
    }
    window.addEventListener('jarvis-open-project-wizard', onWizardOpen)
    return () => window.removeEventListener('jarvis-open-project-wizard', onWizardOpen)
  }, [pushToast])

  const update = (k: keyof FormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const generatePreview = async () => {
    if (!form.project_title || !form.cwd) {
      pushToast('Project title and cwd are required for the preview', 'err')
      return
    }
    const r = await fetch('/api/admin/preview_soul', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await r.json()
    if (data.ok) setPreview(data.soul_md)
    else pushToast(`Preview failed: ${data.error}`, 'err')
  }

  const submit = async () => {
    if (!form.name || !form.cwd || !form.project_title || !form.project_description) {
      pushToast('Name, cwd, title, and description are required', 'err')
      return
    }
    setSubmitting(true)
    let soul = preview
    if (!soul) {
      const pr = await fetch('/api/admin/preview_soul', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const pd = await pr.json()
      soul = pd.soul_md
    }
    const r = await fetch('/api/admin/add_project', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name, cwd: form.cwd, soul_md: soul, notes: form.notes,
        model: 'gpt-oss:120b', provider: 'ollama-cloud', base_url: 'https://ollama.com/v1',
      }),
    })
    const data = await r.json()
    setSubmitting(false)
    if (data.ok) {
      pushToast(`Project "${form.name}" created — gateway restarted, profile live`, 'ok')
      setForm(DEFAULT_FORM); setPreview(''); setShowForm(false)
      fetchProjects()
      // After voice-server restart the gateway is up but the in-process
      // session id list is stale. We refresh by switching to default and back.
      await fetch('/api/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'default' }) })
      // Force a re-fetch of /api/mode so the UI sees the new mode in the list
      window.dispatchEvent(new Event('jarvis-refresh-modes'))
    } else {
      pushToast(`Failed: ${data.error || JSON.stringify(data)}`, 'err')
    }
  }

  const remove = async (name: string) => {
    if (!confirm(`Remove project "${name}"? This deletes the Hermes profile directory (sessions, memory).`)) return
    setRemoving(name)
    const r = await fetch('/api/admin/remove_project', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, confirm: true }),
    })
    const data = await r.json()
    setRemoving(null)
    if (data.ok) {
      pushToast(`Project "${name}" removed`, 'ok')
      fetchProjects()
    } else {
      pushToast(`Remove failed: ${data.error}`, 'err')
    }
  }

  const switchTo = async (name: string) => {
    const r = await fetch('/api/mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: name }),
    })
    const data = await r.json()
    if (data.ok) {
      setMode(name as 'default' | 'wwf')
      pushToast(`Mode: ${name}`, 'ok')
    } else {
      pushToast(`Mode switch failed: ${data.error}`, 'err')
    }
  }

  return (
    <section className="hud-panel">
      <div className="hud-panel-head">
        <h3>Projects</h3>
        <span className="hud-tag">{projects.filter((p) => !p.built_in).length} custom</span>
      </div>
      <div className="p-3.5 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 py-2 text-[var(--text-dim)]">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && projects.length > 0 && (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {projects.map((p) => (
              <li
                key={p.name}
                className={cn(
                  'flex items-center gap-2 rounded-sm border px-2.5 py-1.5',
                  p.name === mode
                    ? 'border-[var(--blue)] bg-[rgba(0,200,255,0.06)]'
                    : 'border-[var(--line)] bg-[rgba(0,200,255,0.02)]',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    p.name === mode ? 'bg-[var(--blue)]' : 'bg-[var(--text-faint)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[12px] tracking-[0.18em] text-[var(--text)]">
                    {p.name}
                    {p.name === mode && (
                      <span className="ml-2 rounded-sm border border-[var(--blue)] px-1 font-mono text-[8.5px] tracking-[0.2em] text-[var(--blue)]">
                        ACTIVE
                      </span>
                    )}
                    {p.built_in && (
                      <span className="ml-2 font-mono text-[8.5px] tracking-[0.2em] text-[var(--text-faint)]">
                        BUILT-IN
                      </span>
                    )}
                  </div>
                  {p.cwd && (
                    <div className="truncate font-mono text-[9.5px] text-[var(--text-faint)]">{p.cwd}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.name !== mode && (
                    <button
                      type="button"
                      onClick={() => switchTo(p.name)}
                      className="rounded-sm border border-[var(--line-bright)] px-2 py-0.5 font-mono text-[9.5px] tracking-[0.15em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
                    >
                      switch
                    </button>
                  )}
                  {!p.built_in && (
                    <button
                      type="button"
                      onClick={() => remove(p.name)}
                      disabled={removing === p.name}
                      className="flex items-center gap-1 rounded-sm border border-[var(--line-bright)] px-2 py-0.5 font-mono text-[9.5px] tracking-[0.15em] text-[var(--text-faint)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-50"
                    >
                      {removing === p.name ? <Loader2 size={10} className="animate-spin" /> : <FolderMinus size={10} />}
                      rm
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-[var(--line)] pt-3">
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-[var(--line-bright)] px-3 py-2 font-mono text-[10.5px] tracking-[0.18em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
            >
              <FolderPlus size={13} />
              Add project
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display text-[11px] tracking-[0.22em] text-[var(--blue)]">
                  New project
                </span>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setPreview('') }}
                  className="font-mono text-[9.5px] tracking-[0.15em] text-[var(--text-faint)] hover:text-[var(--text-dim)]"
                >
                  cancel
                </button>
              </div>

              <FormRow label="Name (kebab-case)" value={form.name} onChange={(v) => update('name', v)} placeholder="finance, jarvis-self, …" />
              <FormRow label="Working directory (absolute)" value={form.cwd} onChange={(v) => update('cwd', v)} placeholder="C:/Users/.../project" />
              <FormRow label="Project title" value={form.project_title} onChange={(v) => update('project_title', v)} placeholder="Personal Finance" />
              <FormRow label="One-line description" value={form.project_description} onChange={(v) => update('project_description', v)} placeholder="My personal budgeting and tracking" />
              <FormRow label="Tech stack (optional)" value={form.tech_stack} onChange={(v) => update('tech_stack', v)} placeholder="Python, SQLite" />
              <FormRow label="Key conventions (optional)" value={form.conventions} onChange={(v) => update('conventions', v)} placeholder="Be precise with numbers" />
              <FormRow label="Notes (optional)" value={form.notes} onChange={(v) => update('notes', v)} placeholder="" />

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={generatePreview}
                  className="rounded-sm border border-[var(--line-bright)] px-3 py-1 font-mono text-[10px] tracking-[0.15em] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
                >
                  preview SOUL.md
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-sm border border-[var(--blue)] px-3 py-1 font-mono text-[10px] tracking-[0.15em] text-[var(--blue)] hover:bg-[rgba(0,200,255,0.12)] disabled:opacity-50"
                >
                  {submitting && <Loader2 size={10} className="animate-spin" />}
                  {submitting ? 'creating…' : 'create + restart gateway'}
                </button>
              </div>

              {preview && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-[var(--line)] bg-black/40 p-2.5 font-mono text-[10.5px] leading-relaxed text-[var(--text-dim)]">
                  {cleanPreview(preview, 800)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function FormRow({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-sm border border-[var(--line-bright)] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)] focus:shadow-[0_0_8px_var(--blue-glow)]"
      />
    </label>
  )
}
