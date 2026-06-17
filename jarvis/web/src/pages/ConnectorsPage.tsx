import { useEffect, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

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
  category: string
  available_soon: boolean
  fields: ConnectorField[]
  enabled: boolean
  values: Record<string, string>
}

type TelegramStatus = {
  connected: boolean
  username: string
  first_name: string
}

// ── Category display helpers ──────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  communication: 'COMM',
  knowledge: 'KNOWLEDGE',
  developer: 'DEV',
  productivity: 'PRODUCTIVITY',
  lifestyle: 'LIFESTYLE',
  infrastructure: 'INFRA',
}

// ── ConnectorsPage ────────────────────────────────────────────────────────────

export function ConnectorsPage() {
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [tab, setTab] = useState<'sources' | 'channels'>('sources')
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)

  const loadConnectors = () => {
    setLoading(true)
    fetch('/api/connectors')
      .then((r) => r.json())
      .then((data) => setConnectors(data.connectors ?? []))
      .catch(() => pushToast('Failed to load connectors', 'err'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadConnectors()
  }, [])

  const connected = connectors.filter((c) => c.enabled)
  const available = connectors.filter((c) => !c.enabled)

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-3.5">
      {/* Tab bar */}
      <div className="flex gap-2 shrink-0">
        {(['sources', 'channels'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
              tab === t
                ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
                : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
            )}
          >
            {t === 'sources' ? 'DATA SOURCES' : 'CHANNELS'}
          </button>
        ))}
      </div>

      {/* ── DATA SOURCES tab ── */}
      {tab === 'sources' && (
        <>
          {loading && (
            <div className="text-xs text-[var(--text-faint)]">Loading connectors…</div>
          )}

          {/* Connected section */}
          {!loading && connected.length > 0 && (
            <section className="hud-panel shrink-0">
              <div className="hud-panel-head">
                <h3>Connected</h3>
                <span className="rounded-sm border border-[var(--blue)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--blue)]">
                  {connected.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 p-3.5">
                {connected.map((c) => (
                  <ConnectedCard
                    key={c.id}
                    connector={c}
                    pushToast={pushToast}
                    onSaved={loadConnectors}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Available section */}
          {!loading && (
            <section className="hud-panel shrink-0">
              <div className="hud-panel-head">
                <h3>Available</h3>
                <span className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)]">
                  {available.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 p-3.5 sm:grid-cols-2">
                {available.map((c) => (
                  <AvailableCard
                    key={c.id}
                    connector={c}
                    pushToast={pushToast}
                    onSaved={loadConnectors}
                  />
                ))}
                {available.length === 0 && (
                  <div className="col-span-2 text-xs text-[var(--text-faint)]">
                    All connectors are active.
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── CHANNELS tab ── */}
      {tab === 'channels' && <ChannelsTab pushToast={pushToast} />}
    </div>
  )
}

// ── ConnectedCard ─────────────────────────────────────────────────────────────

function ConnectedCard({
  connector,
  pushToast,
  onSaved,
}: {
  connector: Connector
  pushToast: (msg: string, kind?: string) => void
  onSaved: () => void
}) {
  const [disconnecting, setDisconnecting] = useState(false)

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, fields: {} }),
      })
      if (!res.ok) throw new Error(await res.text())
      pushToast(`${connector.label} disconnected`, 'ok')
      onSaved()
    } catch {
      pushToast(`Failed to disconnect ${connector.label}`, 'err')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-sm border border-[var(--line-bright)] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--green,#00ff88)]" />
          <span className="font-display text-[12px] tracking-[0.12em] text-[var(--text)]">
            {connector.label}
          </span>
          <span className="rounded-sm border border-[var(--green,#00ff88)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--green,#00ff88)]">
            CONNECTED
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{connector.description}</div>
      </div>
      <button
        type="button"
        onClick={disconnect}
        disabled={disconnecting}
        className={cn(
          'shrink-0 rounded-sm border border-[var(--line-bright)] px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[var(--red)] hover:text-[var(--red)]',
          disconnecting && 'opacity-50',
        )}
      >
        {disconnecting ? 'REMOVING…' : 'DISCONNECT'}
      </button>
    </div>
  )
}

// ── AvailableCard ─────────────────────────────────────────────────────────────

function AvailableCard({
  connector,
  pushToast,
  onSaved,
}: {
  connector: Connector
  pushToast: (msg: string, kind?: string) => void
  onSaved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const onFieldChange = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }))
  }

  const connect = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, fields: values }),
      })
      if (!res.ok) throw new Error(await res.text())
      pushToast(`${connector.label} connected`, 'ok')
      onSaved()
    } catch {
      pushToast(`Failed to connect ${connector.label}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const catLabel = CATEGORY_LABEL[connector.category] ?? connector.category.toUpperCase()

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-sm border p-3 transition',
        expanded ? 'border-[var(--blue)]' : 'border-[var(--line-bright)]',
        connector.available_soon && 'opacity-60',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-display text-[12px] tracking-[0.12em] text-[var(--text)]">
              {connector.label}
            </span>
            <span className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.06em] text-[var(--text-faint)]">
              {catLabel}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{connector.description}</div>
        </div>

        {connector.available_soon ? (
          <span className="shrink-0 rounded-sm border border-[var(--line-bright)] px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] text-[var(--text-faint)]">
            SOON
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className={cn(
              'shrink-0 rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
              expanded
                ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_8px_var(--blue-glow)]'
                : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
            )}
          >
            {expanded ? 'CANCEL' : '+ ADD'}
          </button>
        )}
      </div>

      {/* Expanded inline form */}
      {expanded && !connector.available_soon && (
        <div className="flex flex-col gap-2 border-t border-[var(--line-bright)] pt-2">
          {connector.fields.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {connector.fields.map((f) => (
                <label
                  key={f.name}
                  className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]"
                >
                  {f.label}
                  {f.required && (
                    <span className="inline text-[var(--red)] opacity-80"> *</span>
                  )}
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
          {connector.fields.length === 0 && (
            <div className="text-[11px] text-[var(--text-faint)]">
              No configuration required — enable to activate.
            </div>
          )}
          <button
            type="button"
            onClick={connect}
            disabled={saving}
            className={cn(
              'self-start rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
              saving && 'opacity-50',
            )}
          >
            {saving ? 'CONNECTING…' : 'CONNECT'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── ChannelsTab ───────────────────────────────────────────────────────────────

function ChannelsTab({ pushToast }: { pushToast: (msg: string, kind?: string) => void }) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[11px] text-[var(--text-dim)]">
        Connect a messaging channel to interact with JARVIS from your phone or desktop.
      </p>
      <TelegramCard pushToast={pushToast} />
      <div className="rounded-sm border border-[var(--line-bright)] px-3 py-2.5 font-mono text-[11px] text-[var(--text-faint)]">
        More channels coming soon — Discord, Slack, SMS…
      </div>
    </div>
  )
}

// ── TelegramCard ──────────────────────────────────────────────────────────────

function TelegramCard({ pushToast }: { pushToast: (msg: string, kind?: string) => void }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const fetchStatus = () => {
    setStatusLoading(true)
    fetch('/api/channels/telegram')
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => pushToast('Failed to load Telegram status', 'err'))
      .finally(() => setStatusLoading(false))
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const connect = async () => {
    if (!token.trim()) return
    setConnecting(true)
    try {
      const res = await fetch('/api/channels/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()
      if (!data.ok) {
        pushToast(`Telegram: ${data.error ?? 'Failed'}`, 'err')
        return
      }
      pushToast(`Telegram bot @${data.username} connected`, 'ok')
      setToken('')
      fetchStatus()
    } catch {
      pushToast('Failed to connect Telegram bot', 'err')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch('/api/channels/telegram/disconnect', { method: 'POST' })
      pushToast('Telegram bot disconnected', 'ok')
      fetchStatus()
    } catch {
      pushToast('Failed to disconnect Telegram bot', 'err')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section className="hud-panel shrink-0">
      <div className="hud-panel-head">
        <h3>Telegram</h3>
        {!statusLoading && (
          <span
            className={cn(
              'hud-tag',
              status?.connected && 'live',
            )}
          >
            {status?.connected ? 'CONNECTED' : 'NOT CONNECTED'}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-3.5">
        {statusLoading && (
          <div className="text-[11px] text-[var(--text-faint)]">Checking status…</div>
        )}

        {!statusLoading && status?.connected && (
          <>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--green,#00ff88)]" />
              <span className="font-mono text-[11px] text-[var(--text)]">
                @{status.username}
                {status.first_name ? ` — ${status.first_name}` : ''}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">
              Bot is active. Chat at{' '}
              <a
                href={`https://t.me/${status.username}`}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--blue)] underline"
              >
                t.me/{status.username}
              </a>
            </div>
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className={cn(
                'self-start rounded-sm border border-[var(--line-bright)] px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[var(--red)] hover:text-[var(--red)]',
                disconnecting && 'opacity-50',
              )}
            >
              {disconnecting ? 'REMOVING…' : 'DISCONNECT'}
            </button>
          </>
        )}

        {!statusLoading && !status?.connected && (
          <>
            <div className="flex flex-col gap-1 rounded-sm border border-[var(--line-bright)] p-3">
              <div className="font-mono text-[10px] tracking-[0.08em] text-[var(--text-dim)]">
                Setup instructions
              </div>
              <ol className="mt-1 flex flex-col gap-1 font-mono text-[10px] text-[var(--text-faint)]">
                <li>1. Open <span className="text-[var(--blue)]">@BotFather</span> on Telegram.</li>
                <li>2. Send <span className="text-[var(--text-dim)]">/newbot</span> and follow the prompts.</li>
                <li>3. Copy the token it gives you and paste it below.</li>
              </ol>
            </div>

            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]">
              Bot Token
              <input
                type="password"
                value={token}
                placeholder="1234567890:AAF..."
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && token.trim()) connect()
                }}
                className="rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none transition focus:border-[var(--blue)]"
              />
            </label>

            <button
              type="button"
              onClick={connect}
              disabled={connecting || !token.trim()}
              className={cn(
                'self-start rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
                (connecting || !token.trim()) && 'opacity-50',
              )}
            >
              {connecting ? 'CONNECTING…' : 'CONNECT'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
