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

type HAInfo = {
  version: string
  location: string
  timezone: string
  unit_system: string
  entity_count: number
}

type HAEntity = {
  entity_id: string
  state: string
  friendly_name: string
  domain: string
}

type HAArea = {
  id: string
  name: string
  entity_count: number
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
  const [tab, setTab] = useState<'sources' | 'ha' | 'channels'>('sources')
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

  // Exclude home-assistant from data sources (it has its own tab)
  const connected = connectors.filter((c) => c.enabled && c.id !== 'home-assistant')
  const available = connectors.filter((c) => !c.enabled && c.id !== 'home-assistant')

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-3.5">
      {/* Tab bar */}
      <div className="flex gap-2 shrink-0">
        {([
          ['sources', 'DATA SOURCES'],
          ['ha', 'HOME ASSISTANT'],
          ['channels', 'CHANNELS'],
        ] as const).map(([t, label]) => (
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
            {label}
          </button>
        ))}
      </div>

      {/* ── DATA SOURCES tab ── */}
      {tab === 'sources' && (
        <>
          {loading && (
            <div className="text-xs text-[var(--text-faint)]">Loading connectors…</div>
          )}

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

      {/* ── HOME ASSISTANT tab ── */}
      {tab === 'ha' && <HomeAssistantTab pushToast={pushToast} />}

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
          {connector.category && (
            <span className="rounded-sm border border-[var(--line-bright)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-faint)]">
              {CATEGORY_LABEL[connector.category] ?? connector.category.toUpperCase()}
            </span>
          )}
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
      setExpanded(false)
      onSaved()
    } catch {
      pushToast(`Failed to connect ${connector.label}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-sm border p-3 transition',
        connector.available_soon
          ? 'border-[var(--line)] opacity-60'
          : 'border-[var(--line-bright)]',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-[12px] tracking-[0.12em] text-[var(--text)]">
              {connector.label}
            </span>
            {connector.available_soon && (
              <span className="rounded-sm border border-[var(--amber)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--amber)]">
                SOON
              </span>
            )}
            {connector.category && !connector.available_soon && (
              <span className="rounded-sm border border-[var(--line-bright)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-faint)]">
                {CATEGORY_LABEL[connector.category] ?? connector.category.toUpperCase()}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">{connector.description}</div>
        </div>
        {!connector.available_soon && (
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

// ── HomeAssistantTab ──────────────────────────────────────────────────────────

function HomeAssistantTab({ pushToast }: { pushToast: (msg: string, kind?: string) => void }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [haInfo, setHaInfo] = useState<HAInfo | null>(null)
  const [haError, setHaError] = useState('')
  const [_configLoaded, setConfigLoaded] = useState(false)

  // Entity browser
  const [entities, setEntities] = useState<HAEntity[]>([])
  const [entitySearch, setEntitySearch] = useState('')
  const [entityDomain, setEntityDomain] = useState('all')
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({})
  const [loadingEntities, setLoadingEntities] = useState(false)

  // Areas
  const [areas, setAreas] = useState<HAArea[]>([])
  const [loadingAreas, setLoadingAreas] = useState(false)

  const [innerTab, setInnerTab] = useState<'entities' | 'areas'>('entities')

  // Load stored config on mount
  useEffect(() => {
    fetch('/api/home-assistant/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.url) setUrl(data.url)
        if (data.token_masked) setToken(data.token_masked)
        setConfigLoaded(true)
        if (data.configured) {
          // Auto-load entities and test connection
          loadEntities()
          loadAreas()
          testStored()
        }
      })
      .catch(() => setConfigLoaded(true))
  }, [])

  const testStored = async () => {
    const r = await fetch('/api/home-assistant/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await r.json()
    if (data.ok) setHaInfo(data)
    else setHaError(data.error ?? 'Connection failed')
  }

  const handleTest = async () => {
    if (!url || !token) return
    setTesting(true)
    setHaInfo(null)
    setHaError('')
    try {
      const r = await fetch('/api/home-assistant/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      })
      const data = await r.json()
      if (data.ok) {
        setHaInfo(data)
        setHaError('')
      } else {
        setHaError(data.error ?? 'Connection failed')
      }
    } catch {
      setHaError('Network error')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!url || !token) return
    setSaving(true)
    try {
      const r = await fetch('/api/home-assistant/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, token }),
      })
      const data = await r.json()
      if (data.ok) {
        setHaInfo(data)
        setHaError('')
        pushToast('Home Assistant connected and saved', 'ok')
        loadEntities()
        loadAreas()
      } else {
        setHaError(data.error ?? 'Failed to save')
        pushToast(`HA: ${data.error ?? 'Failed'}`, 'err')
      }
    } catch {
      pushToast('Failed to save Home Assistant config', 'err')
    } finally {
      setSaving(false)
    }
  }

  const loadEntities = async () => {
    setLoadingEntities(true)
    try {
      const r = await fetch('/api/home-assistant/states')
      const data = await r.json()
      if (data.ok) {
        setEntities(data.entities ?? [])
        setDomainCounts(data.domain_counts ?? {})
      }
    } catch {
      // silently fail
    } finally {
      setLoadingEntities(false)
    }
  }

  const loadAreas = async () => {
    setLoadingAreas(true)
    try {
      const r = await fetch('/api/home-assistant/areas')
      const data = await r.json()
      if (data.ok) setAreas(data.areas ?? [])
    } catch {
      // silently fail
    } finally {
      setLoadingAreas(false)
    }
  }

  const isConnected = !!haInfo
  const tokenIsPlaceholder = token.startsWith('*')

  const filteredEntities = entities.filter((e) => {
    const matchDomain = entityDomain === 'all' || e.domain === entityDomain
    const matchSearch =
      !entitySearch ||
      e.entity_id.toLowerCase().includes(entitySearch.toLowerCase()) ||
      e.friendly_name.toLowerCase().includes(entitySearch.toLowerCase())
    return matchDomain && matchSearch
  })

  const STATE_COLOR: Record<string, string> = {
    on: 'text-[var(--green,#00ff88)]',
    off: 'text-[var(--text-faint)]',
    unavailable: 'text-[var(--red)]',
    unknown: 'text-[var(--text-faint)]',
  }

  return (
    <div className="flex flex-col gap-3.5">

      {/* ── Connection card ── */}
      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>Connection</h3>
          <span className={cn('hud-tag', isConnected && 'live')}>
            {isConnected ? 'CONNECTED' : 'NOT CONNECTED'}
          </span>
        </div>

        <div className="flex flex-col gap-3 p-3.5">
          {/* URL + Token */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]">
              Home Assistant URL
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://homeassistant.local:8123"
                className="rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none transition focus:border-[var(--blue)] focus:shadow-[0_0_8px_var(--blue-glow)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]">
              Long-Lived Access Token
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="eyJ..."
                className="rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none transition focus:border-[var(--blue)] focus:shadow-[0_0_8px_var(--blue-glow)]"
              />
            </label>
          </div>

          {/* Token help text */}
          <div className="rounded-sm border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-faint)]">
            Generate a token in HA: Profile (bottom-left avatar) → Security → Long-Lived Access Tokens → Create Token
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !url || !token || tokenIsPlaceholder}
              className={cn(
                'rounded-sm border border-[var(--line-bright)] px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]',
                (testing || !url || !token || tokenIsPlaceholder) && 'opacity-40',
              )}
            >
              {testing ? 'TESTING…' : 'TEST'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !url || !token || tokenIsPlaceholder}
              className={cn(
                'rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
                (saving || !url || !token || tokenIsPlaceholder) && 'opacity-40',
              )}
            >
              {saving ? 'SAVING…' : 'SAVE & CONNECT'}
            </button>
            {isConnected && (
              <button
                type="button"
                onClick={() => { loadEntities(); loadAreas() }}
                className="rounded-sm border border-[var(--line-bright)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-dim)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
              >
                ↺ REFRESH
              </button>
            )}
          </div>

          {/* Error */}
          {haError && (
            <div className="rounded-sm border border-[var(--red)] px-3 py-2 font-mono text-[11px] text-[var(--red)]">
              ✗ {haError}
            </div>
          )}

          {/* Connection info */}
          {haInfo && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-sm border border-[var(--green,#00ff88)] bg-[var(--bg-elev)] px-3 py-2.5 sm:grid-cols-4">
              {haInfo.version && (
                <div>
                  <div className="font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)] uppercase">Version</div>
                  <div className="font-mono text-[12px] text-[var(--text)]">{haInfo.version}</div>
                </div>
              )}
              {haInfo.location && (
                <div>
                  <div className="font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)] uppercase">Location</div>
                  <div className="font-mono text-[12px] text-[var(--text)]">{haInfo.location}</div>
                </div>
              )}
              <div>
                <div className="font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)] uppercase">Entities</div>
                <div className="font-mono text-[12px] text-[var(--text)]">{haInfo.entity_count}</div>
              </div>
              {haInfo.timezone && (
                <div>
                  <div className="font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)] uppercase">Timezone</div>
                  <div className="font-mono text-[12px] text-[var(--text)]">{haInfo.timezone}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Capabilities card ── */}
      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>JARVIS Capabilities</h3>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { name: 'ha_get_states', desc: 'Read all entity states, filter by domain or room' },
            { name: 'ha_call_service', desc: 'Control any device (lights, climate, switches, media)' },
            { name: 'ha_search_entities', desc: 'Find entity IDs by name or partial match' },
            { name: 'ha_get_areas', desc: 'List all rooms / areas with entity counts' },
            { name: 'ha_render_template', desc: 'Run Jinja2 templates for complex queries' },
          ].map((cap) => (
            <div
              key={cap.name}
              className="rounded-sm border border-[var(--line-bright)] px-3 py-2"
            >
              <div className="font-mono text-[11px] text-[var(--blue)]">{cap.name}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{cap.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Entity browser + Areas (only when data loaded) ── */}
      {(entities.length > 0 || areas.length > 0) && (
        <section className="hud-panel shrink-0">
          <div className="hud-panel-head">
            <h3>Browser</h3>
            <div className="flex gap-1.5">
              {(['entities', 'areas'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInnerTab(t)}
                  className={cn(
                    'rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] transition',
                    innerTab === t
                      ? 'border-[var(--blue)] text-[var(--blue)]'
                      : 'border-[var(--line-bright)] text-[var(--text-faint)] hover:text-[var(--text-dim)]',
                  )}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* ENTITIES inner tab */}
          {innerTab === 'entities' && (
            <div className="flex flex-col gap-2 p-3.5">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={entitySearch}
                  onChange={(e) => setEntitySearch(e.target.value)}
                  placeholder="search entities…"
                  className="flex-1 min-w-[160px] rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none transition focus:border-[var(--blue)]"
                />
                <select
                  value={entityDomain}
                  onChange={(e) => setEntityDomain(e.target.value)}
                  className="rounded-sm border border-[var(--line-bright)] bg-[var(--bg)] px-2 py-1 font-mono text-[11px] text-[var(--text)] outline-none transition focus:border-[var(--blue)]"
                >
                  <option value="all">all domains ({entities.length})</option>
                  {Object.entries(domainCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([d, count]) => (
                      <option key={d} value={d}>
                        {d} ({count})
                      </option>
                    ))}
                </select>
              </div>

              {/* Entity list */}
              {loadingEntities ? (
                <div className="text-[11px] text-[var(--text-faint)]">Loading entities…</div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto rounded-sm border border-[var(--line)]">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-[var(--bg-elev)] font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)]">
                      <tr>
                        <th className="px-2 py-1.5 text-left">ENTITY ID</th>
                        <th className="px-2 py-1.5 text-left">STATE</th>
                        <th className="px-2 py-1.5 text-left">NAME</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntities.slice(0, 200).map((e) => (
                        <tr
                          key={e.entity_id}
                          className="border-t border-[var(--line)] hover:bg-[var(--bg-elev)]"
                        >
                          <td className="px-2 py-1 font-mono text-[10px] text-[var(--blue)]">
                            {e.entity_id}
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1 font-mono text-[10px]',
                              STATE_COLOR[e.state] ?? 'text-[var(--amber)]',
                            )}
                          >
                            {e.state}
                          </td>
                          <td className="px-2 py-1 text-[10px] text-[var(--text-dim)]">
                            {e.friendly_name}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredEntities.length > 200 && (
                    <div className="px-2 py-1.5 text-[10px] text-[var(--text-faint)]">
                      Showing 200 of {filteredEntities.length} — refine the filter to see more
                    </div>
                  )}
                  {filteredEntities.length === 0 && !loadingEntities && (
                    <div className="px-2 py-2 text-[11px] text-[var(--text-faint)]">
                      No entities match your filter.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* AREAS inner tab */}
          {innerTab === 'areas' && (
            <div className="p-3.5">
              {loadingAreas ? (
                <div className="text-[11px] text-[var(--text-faint)]">Loading areas…</div>
              ) : areas.length === 0 ? (
                <div className="text-[11px] text-[var(--text-faint)]">
                  No areas found. Create areas in Home Assistant under Settings → Areas.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {areas.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-sm border border-[var(--line-bright)] px-3 py-2"
                    >
                      <div className="font-display text-[12px] tracking-[0.08em] text-[var(--text)]">
                        {a.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">
                          {a.entity_count} entities
                        </span>
                        <span className="font-mono text-[9px] text-[var(--text-faint)]">
                          · id: {a.id}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* MCP server note */}
      <div className="rounded-sm border border-[var(--line)] px-3 py-2.5 text-[10px] leading-relaxed text-[var(--text-faint)]">
        <span className="font-mono text-[var(--text-dim)]">MCP Server (optional): </span>
        Home Assistant 2024.11+ includes a built-in MCP server. Enable it under HA Settings → Integrations → Model Context Protocol, then switch to the Data Sources tab to wire it up as an MCP connector for additional tool coverage.
      </div>
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
          <span className={cn('hud-tag', status?.connected && 'live')}>
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
