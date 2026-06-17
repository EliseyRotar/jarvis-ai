import { useEffect, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

type ConnectorField = {
  name: string
  label: string
  type: 'text' | 'password'
  required: boolean
  placeholder?: string
}

type Connector = {
  id: string
  label: string
  description: string
  fields: ConnectorField[]
  enabled: boolean
  values: Record<string, string>
}

export function ConnectorsPage() {
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connectorsLoading, setConnectorsLoading] = useState(true)

  const loadConnectors = () => {
    setConnectorsLoading(true)
    fetch('/api/connectors')
      .then((r) => r.json())
      .then((data) => setConnectors(data.connectors ?? []))
      .catch(() => pushToast('Failed to load connectors', 'err'))
      .finally(() => setConnectorsLoading(false))
  }

  useEffect(() => {
    loadConnectors()
  }, [])

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-3.5">
      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>Connectors</h3>
        </div>
        <div className="flex flex-col gap-2 p-3.5">
          <div className="rounded-sm border border-[var(--amber)] px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-[var(--amber)]">
            Changes to connectors require restarting JARVIS to take effect.
          </div>
          {connectorsLoading && <div className="text-xs text-[var(--text-faint)]">Loading connectors…</div>}
          {!connectorsLoading && connectors.length === 0 && (
            <div className="text-xs text-[var(--text-faint)]">No connectors available.</div>
          )}
          {connectors.map((c) => (
            <ConnectorCard key={c.id} connector={c} pushToast={pushToast} onSaved={loadConnectors} />
          ))}
        </div>
      </section>
    </div>
  )
}

function ConnectorCard({
  connector,
  pushToast,
  onSaved,
}: {
  connector: Connector
  pushToast: (message: string, kind?: string) => void
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(connector.enabled)
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...connector.values }))
  const [edited, setEdited] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(connector.enabled)
    setValues({ ...connector.values })
    setEdited({})
  }, [connector])

  const onFieldChange = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }))
    setEdited((e) => ({ ...e, [name]: true }))
  }

  const save = async () => {
    setSaving(true)
    const fields: Record<string, string> = {}
    for (const f of connector.fields) {
      if (edited[f.name]) fields[f.name] = values[f.name] ?? ''
    }
    try {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, fields }),
      })
      if (!res.ok) throw new Error(await res.text())
      pushToast(`${connector.label} connector saved`, 'ok')
      onSaved()
    } catch {
      pushToast(`Failed to save ${connector.label} connector`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-sm border border-[var(--line-bright)] p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[12px] tracking-[0.12em] text-[var(--text)]">{connector.label}</div>
          <div className="text-[11px] text-[var(--text-dim)]">{connector.description}</div>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((e) => !e)}
          className={cn(
            'shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
            enabled
              ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
              : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
          )}
        >
          {enabled ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      {connector.fields.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {connector.fields.map((f) => (
            <label key={f.name} className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]">
              {f.label}
              <input
                type={f.type === 'password' ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => onFieldChange(f.name, e.target.value)}
                className="rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none transition focus:border-[var(--blue)]"
              />
            </label>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={cn(
            'rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
            saving && 'opacity-50',
          )}
        >
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
    </div>
  )
}
