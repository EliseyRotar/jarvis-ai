import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react'
import { registerPanelContent } from './RadialMenu'
import { useJarvisStore, modelLabel } from '@/store/jarvisStore'

interface AdminStatus {
  ok: boolean
  username: string
  is_admin: boolean
  is_local_system: boolean
  can_manage_services: boolean
}

function AdminStatusCard() {
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/admin/status')
        const data = await r.json()
        if (alive) {
          setStatus(data)
          setErr(null)
        }
      } catch (e) {
        if (alive) setErr((e as Error).message)
      }
    }
    fetchStatus()
    const i = setInterval(fetchStatus, 15000)
    return () => { alive = false; clearInterval(i) }
  }, [])

  if (err) {
    return (
      <div className="rounded-sm border border-[var(--red)] bg-[rgba(255,71,111,0.05)] px-3 py-2 font-mono text-[10.5px] text-[var(--red)]">
        <ShieldAlert size={11} className="mr-1.5 inline align-[-1px]" />
        status probe failed: {err}
      </div>
    )
  }
  if (!status) {
    return (
      <div className="rounded-sm border border-[var(--line-bright)] bg-black/30 px-3 py-2 font-mono text-[10.5px] text-[var(--text-dim)]">
        probing…
      </div>
    )
  }

  const Icon = status.is_local_system ? ShieldCheck : status.is_admin ? ShieldCheck : Shield
  const colorClass = status.is_local_system
    ? 'border-[var(--green)] text-[var(--green)]'
    : status.is_admin
      ? 'border-[var(--amber)] text-[var(--amber)]'
      : 'border-[var(--line-bright)] text-[var(--text-dim)]'
  const label = status.is_local_system
    ? 'LOCAL SYSTEM'
    : status.is_admin
      ? 'elevated'
      : 'unprivileged'

  return (
    <div className={`rounded-sm border ${colorClass} bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed`}>
      <div className="flex items-center gap-1.5">
        <Icon size={11} />
        <span className="uppercase tracking-[0.18em]">{label}</span>
      </div>
      <div className="mt-1 text-[var(--text-dim)]">
        user: <span className="text-[var(--text)]">{status.username || '—'}</span>
      </div>
      <div className="text-[var(--text-dim)]">
        can manage services:{' '}
        <span className={status.can_manage_services ? 'text-[var(--green)]' : 'text-[var(--red)]'}>
          {status.can_manage_services ? 'yes' : 'no'}
        </span>
      </div>
      {!status.is_local_system && (
        <div className="mt-2 text-[9.5px] text-[var(--text-faint)]">
          Run <code className="rounded bg-black/50 px-1 py-0.5">.\install_service.ps1</code> to elevate.
        </div>
      )}
    </div>
  )
}

function SettingsPanel() {
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const mode = useJarvisStore((s) => s.mode)
  const send = useJarvisStore((s) => s.send)
  const pushToast = useJarvisStore((s) => s.pushToast)

  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('cosmo-theme') as any) || 'dark'
  )

  useEffect(() => {
    try {
      localStorage.setItem('cosmo-theme', theme)
      document.documentElement.classList.toggle('theme-light', theme === 'light')
    } catch { /* noop */ }
  }, [theme])

  const setModel = (m: string) => {
    send({ type: 'set_model', model: m })
    pushToast(`Model → ${modelLabel(m)}`, 'ok')
  }

  return (
    <div className="space-y-4 p-4">
      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Model</h4>
        <select
          value={activeModel}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-sm border border-[var(--line-bright)] bg-black/40 px-2.5 py-2 font-mono text-[11px] text-[var(--text)] outline-none focus:border-[var(--blue)]"
        >
          {models.map((m) => (
            <option key={m} value={m} className="bg-[#0d1218]">{modelLabel(m)}</option>
          ))}
        </select>
      </section>

      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Mode</h4>
        <div className="rounded-sm border border-[var(--line-bright)] bg-black/30 px-3 py-2 font-mono text-[11px]">
          Current: <span className="text-[var(--blue)]">{mode}</span>
        </div>
        <div className="mt-2 text-[10px] text-[var(--text-faint)]">
          Switch via the radial menu's projects panel, or "switch to project X" by voice.
        </div>
      </section>

      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Theme</h4>
        <div className="flex gap-2">
          <button
            onClick={() => setTheme('dark')}
            className={`rounded-sm border px-3 py-1 font-mono text-[10.5px] tracking-[0.16em] transition ${theme === 'dark' ? 'border-[var(--blue)] text-[var(--blue)]' : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]'}`}
          >
            dark
          </button>
          <button
            onClick={() => setTheme('light')}
            className={`rounded-sm border px-3 py-1 font-mono text-[10.5px] tracking-[0.16em] transition ${theme === 'light' ? 'border-[var(--blue)] text-[var(--blue)]' : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]'}`}
          >
            light
          </button>
        </div>
      </section>

      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Voice</h4>
        <div className="rounded-sm border border-[var(--line-bright)] bg-black/30 px-3 py-2 font-mono text-[10.5px]">
          Wake: "hey cosmo" (or "hey jarvis" — both work)
        </div>
      </section>

      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">About</h4>
        <div className="rounded-sm border border-[var(--line-bright)] bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-[var(--text-dim)]">
          <div className="text-[var(--text)]">Cosmo</div>
          <div>Honest, direct, slightly profane. Your partner on the wire.</div>
          <div className="mt-2 text-[var(--text-faint)]">Brain: Hermes Agent · Voice: Piper TTS</div>
        </div>
      </section>

      <section>
        <h4 className="mb-2 font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">Admin</h4>
        <AdminStatusCard />
      </section>
    </div>
  )
}

registerPanelContent('settings', SettingsPanel)
