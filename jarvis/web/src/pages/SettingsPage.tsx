import { useEffect, useState } from 'react'
import { Download, Power, RotateCcw, Square } from 'lucide-react'
import { useJarvisStore, loadModels, setModel, modelLabel } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'
import { getTheme, setTheme, type Theme } from '@/lib/theme'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'LIGHT' },
  { value: 'dark', label: 'DARK' },
  { value: 'system', label: 'SYSTEM' },
]

// ──────────────────────────────────────────────────────────────────────────
// Types for the hardware / Ollama API responses
// ──────────────────────────────────────────────────────────────────────────

interface GpuInfo {
  name: string
  vram_gb: number
}

interface RecommendedModel {
  name: string
  params_b: number
  vram_q4_gb: number
  desc: string
  fits_vram: boolean
  fits_with_offload: boolean
  recommended: boolean
}

interface HardwareInfo {
  ok: boolean
  cpu: string
  ram_gb: number
  gpu: GpuInfo
  ollama_running: boolean
  installed_models: string[]
  recommended_models: RecommendedModel[]
}

// ──────────────────────────────────────────────────────────────────────────
// OllamaSection
// ──────────────────────────────────────────────────────────────────────────

function OllamaSection() {
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [_loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('available')
  const [activeOllamaModel, setActiveOllamaModel] = useState<string | null>(null)

  // Pull state keyed by model name
  const [pulling, setPulling] = useState<Record<string, { pct: number; status: string }>>({})

  // Custom model input
  const [customModel, setCustomModel] = useState('')

  const fetchHardware = () => {
    setLoading(true)
    fetch('/api/hardware')
      .then((r) => r.json())
      .then((data: HardwareInfo) => {
        setHw(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    fetchHardware()
  }, [])

  const startPull = async (modelName: string) => {
    if (pulling[modelName]) return
    setPulling((p) => ({ ...p, [modelName]: { pct: 0, status: 'Starting…' } }))
    try {
      const resp = await fetch('/api/ollama/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      })
      if (!resp.body) throw new Error('No body')
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const obj = JSON.parse(trimmed) as {
              status?: string
              total?: number
              completed?: number
              error?: string
            }
            if (obj.error) {
              setPulling((p) => ({ ...p, [modelName]: { pct: 0, status: `Error: ${obj.error}` } }))
              return
            }
            const pct =
              obj.total && obj.completed
                ? Math.round((obj.completed / obj.total) * 100)
                : pulling[modelName]?.pct ?? 0
            setPulling((p) => ({
              ...p,
              [modelName]: { pct, status: obj.status ?? '' },
            }))
          } catch {
            // non-JSON line, skip
          }
        }
      }
      // Done — mark 100% then refresh hw info
      setPulling((p) => ({ ...p, [modelName]: { pct: 100, status: 'Done' } }))
      setTimeout(() => {
        setPulling((p) => {
          const next = { ...p }
          delete next[modelName]
          return next
        })
        fetchHardware()
      }, 1500)
    } catch (err) {
      setPulling((p) => ({ ...p, [modelName]: { pct: 0, status: `Failed: ${err}` } }))
    }
  }

  const switchModel = async (modelName: string) => {
    await fetch('/api/ollama/set_model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName }),
    })
    setActiveOllamaModel(modelName)
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderFitChip = (m: RecommendedModel) => {
    if (m.fits_vram) {
      return (
        <span className="rounded-sm border border-[var(--blue)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--blue)]">
          FITS
        </span>
      )
    }
    if (m.fits_with_offload) {
      return (
        <span className="rounded-sm border border-[var(--amber)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--amber)]">
          OFFLOAD
        </span>
      )
    }
    return (
      <span className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--text-faint)]">
        TOO LARGE
      </span>
    )
  }

  const renderPullRow = (modelName: string, _isCustom = false) => {
    const pullState = pulling[modelName]
    if (!pullState) return null
    const isDone = pullState.status === 'Done'
    return (
      <div className="mt-1.5 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-[var(--text-dim)]">{pullState.status}</span>
          <span className="font-mono text-[10px] text-[var(--text-dim)]">{pullState.pct}%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--line-bright)]">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              isDone ? 'bg-[var(--green,#00ff88)]' : 'bg-[var(--blue)]',
            )}
            style={{ width: `${pullState.pct}%` }}
          />
        </div>
      </div>
    )
  }

  // ── Hardware summary ─────────────────────────────────────────────────────

  const hwSummary = hw ? (
    <div className="font-mono text-[10px] text-[var(--text-dim)]">
      CPU: {hw.cpu} &nbsp;|&nbsp; RAM: {hw.ram_gb} GB
      {hw.gpu.name !== 'Unknown' && (
        <> &nbsp;|&nbsp; GPU: {hw.gpu.name} ({hw.gpu.vram_gb} GB VRAM)</>
      )}
    </div>
  ) : (
    <div className="font-mono text-[10px] text-[var(--text-faint)]">Detecting hardware…</div>
  )

  const ollamaTag = hw ? (
    <span className={cn('hud-tag', hw.ollama_running && 'live')}>
      OLLAMA: {hw.ollama_running ? 'ONLINE' : 'OFFLINE'}
    </span>
  ) : (
    <span className="hud-tag">OLLAMA: —</span>
  )

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <section className="hud-panel shrink-0">
      <div className="hud-panel-head">
        <h3>Local AI — Ollama</h3>
        {ollamaTag}
      </div>

      <div className="flex flex-col gap-3 p-3.5">
        {/* Hardware summary */}
        {hwSummary}

        {/* Offline notice */}
        {hw && !hw.ollama_running && (
          <div className="text-xs text-[var(--text-dim)]">
            Install Ollama at{' '}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--blue)] underline"
            >
              ollama.com
            </a>{' '}
            to use local models.
          </div>
        )}

        {/* Main content when Ollama is online */}
        {hw && hw.ollama_running && (
          <>
            {/* Tab switcher */}
            <div className="flex gap-2">
              {(['installed', 'available'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'rounded-sm border px-3 py-1 font-mono text-[10px] tracking-[0.12em] transition',
                    activeTab === tab
                      ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_8px_var(--blue-glow)]'
                      : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                  )}
                >
                  {tab === 'installed' ? 'INSTALLED' : 'AVAILABLE'}
                  {tab === 'installed' && hw.installed_models.length > 0 && (
                    <span className="ml-1.5 opacity-60">({hw.installed_models.length})</span>
                  )}
                </button>
              ))}
            </div>

            {/* Installed tab */}
            {activeTab === 'installed' && (
              <div className="flex flex-col gap-1.5">
                {hw.installed_models.length === 0 ? (
                  <div className="text-xs text-[var(--text-faint)]">No models pulled yet.</div>
                ) : (
                  hw.installed_models.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchModel(m)}
                      className={cn(
                        'flex items-center justify-between rounded-sm border px-3 py-1.5 text-left transition',
                        activeOllamaModel === m
                          ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_8px_var(--blue-glow)]'
                          : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                      )}
                    >
                      <span className="font-mono text-[11px]">{m}</span>
                      {activeOllamaModel === m && (
                        <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--blue)]">
                          ACTIVE
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Available tab */}
            {activeTab === 'available' && (
              <div className="flex flex-col gap-2">
                {hw.recommended_models.map((m) => {
                  const isInstalled = hw.installed_models.includes(m.name)
                  const pullState = pulling[m.name]
                  return (
                    <div
                      key={m.name}
                      className={cn(
                        'flex flex-col gap-1 rounded-sm border px-3 py-2',
                        m.recommended
                          ? 'border-[var(--blue)]'
                          : m.fits_vram
                            ? 'border-[var(--line-bright)]'
                            : 'border-[var(--line-dim,rgba(255,255,255,0.06))]',
                      )}
                    >
                      {/* Row 1: name + badges */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'font-mono text-[11px]',
                            m.fits_vram || m.fits_with_offload
                              ? 'text-[var(--text-bright,var(--text-dim))]'
                              : 'text-[var(--text-faint)]',
                          )}
                        >
                          {m.name}
                        </span>
                        {m.recommended && (
                          <span className="rounded-sm bg-[var(--blue)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-black">
                            RECOMMENDED
                          </span>
                        )}
                        {isInstalled && (
                          <span className="rounded-sm border border-[var(--blue)] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-[var(--blue)]">
                            INSTALLED
                          </span>
                        )}
                        {renderFitChip(m)}
                      </div>

                      {/* Row 2: description + param/VRAM info */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--text-dim)]">{m.desc}</span>
                        <span className="shrink-0 font-mono text-[9px] text-[var(--text-faint)]">
                          {m.params_b}B · {m.vram_q4_gb} GB
                        </span>
                      </div>

                      {/* Pull progress */}
                      {pullState && renderPullRow(m.name)}

                      {/* Action row */}
                      <div className="flex gap-1.5 pt-0.5">
                        {!isInstalled && !pullState && (
                          <button
                            type="button"
                            onClick={() => startPull(m.name)}
                            className="flex items-center gap-1 rounded-sm border border-[var(--line-bright)] px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] text-[var(--text-dim)] transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
                          >
                            <Download size={10} />
                            PULL
                          </button>
                        )}
                        {isInstalled && (
                          <button
                            type="button"
                            onClick={() => switchModel(m.name)}
                            className={cn(
                              'rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] transition',
                              activeOllamaModel === m.name
                                ? 'border-[var(--blue)] text-[var(--blue)]'
                                : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                            )}
                          >
                            {activeOllamaModel === m.name ? 'ACTIVE' : 'USE'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Custom model input — always visible when Ollama is online */}
        {hw && hw.ollama_running && (
          <div className="flex flex-col gap-1.5 border-t border-[var(--line-bright)] pt-3">
            <div className="text-xs text-[var(--text-dim)]">Custom model</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customModel.trim()) startPull(customModel.trim())
                }}
                placeholder="e.g. llama3.1:70b-instruct-q2_K"
                className="flex-1 rounded-sm border border-[var(--line-bright)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text-dim)] placeholder-[var(--text-faint)] focus:border-[var(--blue)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!customModel.trim() || Boolean(pulling[customModel.trim()])}
                onClick={() => {
                  const m = customModel.trim()
                  if (m) startPull(m)
                }}
                className="flex items-center gap-1 rounded-sm border border-[var(--line-bright)] px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-[var(--text-dim)] transition hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-40"
              >
                <Download size={10} />
                PULL
              </button>
            </div>
            {customModel.trim() && pulling[customModel.trim()] && renderPullRow(customModel.trim(), true)}
          </div>
        )}

        {/* Restart note */}
        {hw && hw.ollama_running && (
          <div className="text-[10px] text-[var(--text-faint)]">
            Switching to a local model requires restarting JARVIS.
          </div>
        )}
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// SettingsPage
// ──────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const connected = useJarvisStore((s) => s.connected)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const reset = useJarvisStore((s) => s.reset)
  const stop = useJarvisStore((s) => s.stop)
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [theme, setThemeState] = useState<Theme>(() => getTheme())

  const chooseTheme = (t: Theme) => {
    setTheme(t)
    setThemeState(t)
  }

  useEffect(() => {
    loadModels()
  }, [])

  const doReset = () => {
    if (!confirm('Reset the current conversation? This clears chat history and memory of this session.')) return
    reset()
    fetch('/reset', { method: 'POST' }).catch(() => {})
    pushToast('Conversation reset', 'ok')
  }

  const doShutdown = () => {
    if (!confirm('Shut down JARVIS completely?')) return
    fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
  }

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto p-3.5">
      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>Model</h3>
          <span className={cn('hud-tag', connected && 'live')}>{connected ? 'link' : 'offline'}</span>
        </div>
        <div className="flex flex-col gap-2 p-3.5">
          <div className="text-xs text-[var(--text-dim)]">Active model</div>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                className={cn(
                  'rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
                  m === activeModel
                    ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
                    : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                )}
              >
                {modelLabel(m)}
              </button>
            ))}
            {models.length === 0 && <div className="text-xs text-[var(--text-faint)]">Loading models…</div>}
          </div>
        </div>
      </section>

      <OllamaSection />

      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>Appearance</h3>
        </div>
        <div className="flex flex-col gap-2 p-3.5">
          <div className="text-xs text-[var(--text-dim)]">Theme</div>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => chooseTheme(opt.value)}
                className={cn(
                  'rounded-sm border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition',
                  opt.value === theme
                    ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
                    : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>Session Controls</h3>
        </div>
        <div className="flex flex-wrap gap-3 p-3.5">
          <button
            type="button"
            onClick={() => stop()}
            disabled={!turnActive}
            className={cn(
              'flex items-center gap-1.5 rounded-sm border border-[var(--amber)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--amber)] transition hover:bg-[rgba(255,179,0,0.1)] hover:shadow-[0_0_12px_var(--amber-glow)]',
              !turnActive && 'opacity-35',
            )}
          >
            <Square size={12} />
            STOP TURN
          </button>
          <button
            type="button"
            onClick={doReset}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--blue)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]"
          >
            <RotateCcw size={12} />
            RESET CONVERSATION
          </button>
          <button
            type="button"
            onClick={doShutdown}
            className="flex items-center gap-1.5 rounded-sm border border-[var(--red)] px-3 py-1.5 font-display text-[11px] tracking-[0.2em] text-[var(--red)] transition hover:bg-[rgba(255,71,111,0.12)] hover:shadow-[0_0_12px_var(--red-glow)]"
          >
            <Power size={12} />
            SHUT DOWN
          </button>
        </div>
      </section>

      <section className="hud-panel shrink-0">
        <div className="hud-panel-head">
          <h3>About</h3>
        </div>
        <div className="space-y-1.5 p-3.5 text-xs text-[var(--text-dim)]">
          <div>JARVIS — Just A Rather Very Intelligent System</div>
          <div>Web UI v2 — React 19 / Vite / Tailwind 4</div>
          <div>
            Keyboard shortcut: <kbd className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 text-[10px]">Ctrl/Cmd+K</kbd> opens the command palette.
          </div>
        </div>
      </section>
    </div>
  )
}
