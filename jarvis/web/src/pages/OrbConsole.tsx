import { useEffect, useState } from 'react'
import {
  Mic, Square, Send, Cpu, MapPin, FolderGit2, Cloud,
  Activity, Clock, Radio, Plus, Minus,
} from 'lucide-react'
import { useJarvisStore, modelLabel } from '@/store/jarvisStore'
import { useMic } from '@/hooks/useMic'
import { cn } from '@/lib/utils'
import { OrbCanvas } from '@/components/OrbCanvas'
import { TaskOrb } from '@/components/TaskOrb'
import { RadialMenu, type RadialPanel } from '@/components/RadialMenu'

// ── Helpers ───────────────────────────────────────────────────────────────

function cleanCaption(text: string, max = 200): string {
  const t = text
    .replace(/<cosmo:[^>]*>[\s\S]*?<\/cosmo:[^>]*>/g, ' ')
    .replace(/<jarvis:[^>]*>[\s\S]*?<\/jarvis:[^>]*>/g, ' ')
    .replace(/[#*`_>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return '…' + t.slice(t.length - max)
}

function stateWord(speaking: boolean, listening: boolean, thinking: boolean): string {
  if (speaking) return 'speaking'
  if (listening) return 'listening'
  if (thinking) return 'thinking'
  return 'ready'
}

// ── Dashboard widgets ─────────────────────────────────────────────────────

function ClockWidget() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = time.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  return (
    <div className="pointer-events-none select-none rounded-xl border border-[var(--line-bright)] bg-black/35 px-3.5 py-2 font-mono backdrop-blur-md">
      <div className="flex items-baseline gap-2">
        <Clock size={11} className="text-[var(--text-faint)]" />
        <span className="text-[18px] tabular-nums text-[var(--text)]">
          {pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}
        </span>
      </div>
      <div className="text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        {date}
      </div>
    </div>
  )
}

interface HardwareStats {
  cpu_pct: number
  ram_pct: number
  ram_used_gb: number
  ram_total_gb: number
  gpu_pct: number | null
  gpu_name: string | null
}

function SystemStatsWidget({ onClick }: { onClick?: () => void }) {
  const [stats, setStats] = useState<HardwareStats | null>(null)
  useEffect(() => {
    let alive = true
    const fetchStats = async () => {
      try {
        const r = await fetch('/api/hardware')
        const data = await r.json()
        if (!alive) return
        // /api/hardware returns cpu_pct (number), ram (object with percent/used_gb/total_gb),
        // gpu (object), cpu (string name only). Back-compat: also accept old shapes.
        const cpuRaw = data.cpu_pct ?? data.cpu_usage ?? (typeof data.cpu === 'number' ? data.cpu : 0)
        const cpuNum = Number(cpuRaw) || 0
        const ram = data.ram ?? null
        const gpu = data.gpu ?? null
        setStats({
          cpu_pct: cpuNum,
          ram_pct: Number(ram?.percent ?? data.ram_pct ?? 0) || 0,
          ram_used_gb: Number(ram?.used_gb ?? 0) || 0,
          ram_total_gb: Number(ram?.total_gb ?? data.ram_gb ?? 0) || 0,
          gpu_pct: gpu?.utilization_pct ?? null,
          gpu_name: gpu?.name ?? null,
        })
      } catch { /* swallow */ }
    }
    fetchStats()
    const i = setInterval(fetchStats, 4000)
    return () => { alive = false; clearInterval(i) }
  }, [])

  const Bar = ({ pct, color }: { pct: number; color: string }) => (
    <div className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }}
      />
    </div>
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto group rounded-xl border border-[var(--line-bright)] bg-black/35 px-3.5 py-2 font-mono text-left backdrop-blur-md transition hover:border-[var(--blue)] hover:bg-black/55"
    >
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        <Cpu size={11} />
        sys
      </div>
      {stats ? (
        <div className="mt-1 space-y-1 text-[10px]">
          <div className="flex items-center justify-between gap-2 text-[var(--text-dim)]">
            <span>cpu</span>
            <Bar pct={stats.cpu_pct} color="#00c8ff" />
            <span className="tabular-nums text-[var(--text)]">{Number(stats.cpu_pct ?? 0).toFixed(0)}%</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[var(--text-dim)]">
            <span>ram</span>
            <Bar pct={stats.ram_pct} color="#5cdcff" />
            <span className="tabular-nums text-[var(--text)]">{stats.ram_pct.toFixed(0)}%</span>
          </div>
          {stats.gpu_pct !== null && (
            <div className="flex items-center justify-between gap-2 text-[var(--text-dim)]">
              <span>gpu</span>
              <Bar pct={stats.gpu_pct} color="#ff8c5c" />
              <span className="tabular-nums text-[var(--text)]">{stats.gpu_pct.toFixed(0)}%</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">…</div>
      )}
    </button>
  )
}

function WeatherWidget() {
  const [w, setW] = useState<{ temp_c: number; condition: string; city: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    // Open-Meteo: free, no key, IP-based geolocation
    (async () => {
      try {
        const geo = await fetch('https://ipapi.co/json/').then((r) => r.json())
        const lat = geo.latitude, lon = geo.longitude, city = geo.city || 'local'
        const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)
          .then((r) => r.json())
        const code = wx.current?.weather_code ?? 0
        const conditions: Record<number, string> = {
          0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
          45: 'fog', 48: 'fog',
          51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
          61: 'rain', 63: 'rain', 65: 'rain',
          71: 'snow', 73: 'snow', 75: 'snow',
          80: 'showers', 81: 'showers', 82: 'showers',
          95: 'storm', 96: 'storm', 99: 'storm',
        }
        setW({ temp_c: wx.current?.temperature_2m ?? 0, condition: conditions[code] ?? 'unknown', city })
      } catch (e) {
        setErr('weather offline')
      }
    })()
  }, [])
  return (
    <div className="pointer-events-none select-none rounded-xl border border-[var(--line-bright)] bg-black/35 px-3.5 py-2 font-mono backdrop-blur-md">
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        <Cloud size={11} />
        weather
      </div>
      {w ? (
        <div className="mt-1">
          <div className="text-[15px] tabular-nums text-[var(--text)]">
            {w.temp_c.toFixed(0)}°c <span className="text-[10px] text-[var(--text-dim)]">{w.condition}</span>
          </div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">{w.city}</div>
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{err ?? '…'}</div>
      )}
    </div>
  )
}

interface ProjectContext {
  mode: string
  cwd: string | null
  git_branch: string | null
  git_last_commit: string | null
}

function ProjectContextWidget({ onClick }: { onClick?: () => void }) {
  const mode = useJarvisStore((s) => s.mode)
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  useEffect(() => {
    fetch(`/api/mode`).then((r) => r.json()).then((d) => {
      setCtx((c) => ({ ...c, mode: d.mode } as ProjectContext))
    }).catch(() => undefined)
  }, [mode])
  useEffect(() => {
    if (!ctx?.cwd) return
    fetch(`/api/project/context?cwd=${encodeURIComponent(ctx.cwd)}`)
      .then((r) => r.json())
      .then((d) => setCtx((c) => ({ ...c, ...d })))
      .catch(() => undefined)
  }, [ctx?.cwd])
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto group rounded-xl border border-[var(--line-bright)] bg-black/35 px-3.5 py-2 font-mono text-left backdrop-blur-md transition hover:border-[var(--blue)] hover:bg-black/55"
    >
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        <FolderGit2 size={11} />
        project
      </div>
      <div className="mt-1 text-[13px] text-[var(--text)]">
        {ctx?.mode ?? mode}
      </div>
      {ctx?.cwd && (
        <div className="max-w-[180px] truncate text-[9.5px] text-[var(--text-dim)]">
          {ctx.cwd.replace(/^C:\\Users\\[^\\]+\\/, '~/').replace(/^.*?\\Users\\[^\\]+\\/, '~/')}
        </div>
      )}
      {ctx?.git_branch && (
        <div className="flex items-center gap-1 text-[9.5px] text-[var(--amber)]">
          <MapPin size={9} />
          {ctx.git_branch}
        </div>
      )}
    </button>
  )
}

function ActivityWidget() {
  const [items, setItems] = useState<{ time: number; text: string }[]>([])
  useEffect(() => {
    // Pull from /api/history or maintain a rolling list as turns complete
    let alive = true
    const fetchHistory = async () => {
      try {
        const r = await fetch('/api/history')
        const data = await r.json()
        if (!alive || !data?.messages) return
        const turns = data.messages
          .filter((m: { role: string }) => m.role === 'user')
          .slice(-5)
          .map((m: { content: string; ts?: number }) => ({
            time: Date.now() - Math.random() * 60000,
            text: (m.content || '').slice(0, 60),
          }))
        setItems(turns)
      } catch { /* noop */ }
    }
    fetchHistory()
    const i = setInterval(fetchHistory, 8000)
    return () => { alive = false; clearInterval(i) }
  }, [])
  return (
    <div className="pointer-events-none rounded-xl border border-[var(--line-bright)] bg-black/35 px-3.5 py-2 font-mono backdrop-blur-md">
      <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        <Activity size={11} />
        recent
      </div>
      <ul className="mt-1 space-y-0.5 text-[10px]">
        {items.length === 0 && (
          <li className="text-[var(--text-faint)]">no turns yet</li>
        )}
        {items.slice(0, 4).map((it, i) => (
          <li key={i} className="truncate text-[var(--text-dim)]">
            <span className="text-[var(--text-faint)]">·</span> {it.text || '…'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function WakeIndicator({ listening }: { listening: boolean }) {
  return (
    <div className={cn(
      'pointer-events-none rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.2em] backdrop-blur-md transition',
      listening
        ? 'border-[var(--amber)] text-[var(--amber)] shadow-[0_0_10px_var(--amber-glow)]'
        : 'border-[var(--line-bright)] text-[var(--text-faint)]',
    )}>
      <Radio size={10} className="mr-1.5 inline align-[-1px]" />
      {listening ? 'listening' : 'standby'}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function OrbConsole() {
  const connected = useJarvisStore((s) => s.connected)
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const mode = useJarvisStore((s) => s.mode)
  const setMode = useJarvisStore((s) => s.setMode)
  const transcript = useJarvisStore((s) => s.transcript)
  const responseLive = useJarvisStore((s) => s.responseLive)
  const responseTurns = useJarvisStore((s) => s.responseTurns)
  const speaking = useJarvisStore((s) => s.speaking)
  const listening = useJarvisStore((s) => s.listening)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const sendText = useJarvisStore((s) => s.sendText)
  const stop = useJarvisStore((s) => s.stop)
  const task = useJarvisStore((s) => s.task)

  const { recording, start, stop: micStop } = useMic()
  const [text, setText] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [orbBrightness, setOrbBrightness] = useState(0.45)  // 30% lower than the 0.65 default

  const thinking = turnActive && !speaking

  const lastUser = transcript.length ? transcript[transcript.length - 1].text : ''
  const userCaption = recording || listening ? 'listening…' : cleanCaption(lastUser, 140)
  const assistantText = responseLive || (responseTurns.length ? responseTurns[responseTurns.length - 1].text : '')
  const assistantCaption = cleanCaption(assistantText, 320)

  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendText(t, false)
    setText('')
  }

  const panels: RadialPanel[] = [
    { id: 'projects', label: 'projects', icon: 'projects' },
    { id: 'tasks', label: 'tasks', icon: 'tasks' },
    { id: 'subagents', label: 'subagents', icon: 'brain' },
    { id: 'logs', label: 'logs', icon: 'activity' },
    { id: 'settings', label: 'settings', icon: 'settings' },
  ]

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Orb — brightness reduced 30% (from ~0.65 to 0.45) for less retinal burnout */}
      <div className="absolute inset-0" style={{ filter: `brightness(${orbBrightness})` }}>
        <OrbCanvas />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,0.82) 100%)' }}
      />

      {/* Top-left: name + status */}
      <div className="pointer-events-none absolute left-5 top-4 z-10 flex items-center gap-2.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: connected ? 'var(--blue)' : 'var(--red)',
            boxShadow: connected ? '0 0 10px var(--blue-glow)' : '0 0 8px var(--red-glow)',
          }}
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.34em] text-[var(--text-dim)]">
          cosmo
        </span>
        <WakeIndicator listening={listening || recording} />
      </div>

      {/* Top-right: clock */}
      <div className="absolute right-5 top-4 z-10">
        <ClockWidget />
      </div>

      {/* Upper-left rail: project + system stats */}
      <div className="absolute left-5 top-20 z-10 flex flex-col gap-2.5">
        <ProjectContextWidget />
        <SystemStatsWidget />
      </div>

      {/* Upper-right rail: weather */}
      <div className="absolute right-5 top-20 z-10 flex flex-col gap-2.5">
        <WeatherWidget />
      </div>

      {/* Lower-left: activity feed */}
      <div className="absolute left-5 top-[60%] z-10 w-[220px] -translate-y-1/2">
        <ActivityWidget />
      </div>

      {/* Radial menu (right-center) — opens panels */}
      <div className="absolute right-5 top-1/2 z-20 -translate-y-1/2">
        <RadialMenu panels={panels} />
      </div>

      {/* Task panel (left-center, mid-low) */}
      {task && (
        <div className="pointer-events-none absolute left-5 bottom-32 z-10">
          <TaskOrb plan={task} />
        </div>
      )}

      {/* User caption (upper-center, below clock) */}
      <div className="pointer-events-none absolute inset-x-0 top-[18%] z-10 flex justify-center px-8">
        <div
          className={cn(
            'max-w-2xl text-center font-mono text-[13px] leading-relaxed tracking-wide transition-opacity duration-300',
            recording || listening ? 'text-[var(--amber)] opacity-90' : 'text-[var(--text-dim)] opacity-70',
          )}
        >
          {userCaption && <span className="opacity-60">you · </span>}
          {userCaption}
        </div>
      </div>

      {/* Assistant caption (lower-center, above controls) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[24%] z-10 flex flex-col items-center gap-3 px-8">
        <div
          className="text-[10px] uppercase tracking-[0.4em] transition-colors"
          style={{
            color: speaking ? 'var(--blue)' : 'var(--text-faint)',
            textShadow: speaking ? '0 0 14px var(--blue-glow)' : 'none',
          }}
        >
          {stateWord(speaking, recording || listening, thinking)}
        </div>
        <div
          className={cn(
            'max-w-3xl text-center text-[15px] leading-relaxed transition-opacity duration-300',
            assistantCaption ? 'opacity-100' : 'opacity-0',
          )}
          style={{ color: 'var(--text)', textShadow: '0 0 18px rgba(0,200,255,0.18)' }}
        >
          {assistantCaption}
          {responseLive && <span className="crt-cursor ml-0.5">▍</span>}
        </div>
      </div>

      {/* Controls (bottom-center) */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-5 pb-6">
        {showInput && (
          <div className="flex w-full max-w-md items-center gap-2">
            <input
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  setShowInput(false)
                }
              }}
              placeholder="type a message…"
              className="flex-1 rounded-full border border-[var(--line-bright)] bg-black/50 px-4 py-2 font-mono text-[13px] text-[var(--text)] outline-none backdrop-blur transition focus:border-[var(--blue)] focus:shadow-[0_0_14px_var(--blue-glow)]"
            />
            <button
              type="button"
              onClick={submit}
              className="rounded-full border border-[var(--blue)] p-2 text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.12)]"
            >
              <Send size={15} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowInput((v) => !v)}
            title="Type instead"
            className="font-mono text-[11px] tracking-[0.2em] text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
          >
            {showInput ? 'hide' : 'type'}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'wwf' ? 'default' : 'wwf')}
            title={mode === 'wwf' ? 'Switch to normal mode' : 'Switch to WWF work mode'}
            className={cn(
              'rounded-full border bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] backdrop-blur transition',
              mode === 'wwf'
                ? 'border-[var(--amber)] text-[var(--amber)] shadow-[0_0_12px_var(--amber-glow)]'
                : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
            )}
          >
            {mode === 'wwf' ? 'wwf' : 'normal'}
          </button>

          {/* Push-to-talk mic */}
          <button
            type="button"
            onMouseDown={start}
            onMouseUp={micStop}
            onMouseLeave={micStop}
            onTouchStart={start}
            onTouchEnd={micStop}
            title="Hold to talk"
            className={cn(
              'relative flex h-16 w-16 items-center justify-center rounded-full border transition',
              recording
                ? 'border-[var(--amber)] text-[var(--amber)] shadow-[0_0_28px_var(--amber-glow)]'
                : 'border-[var(--blue)] text-[var(--blue)] hover:shadow-[0_0_22px_var(--blue-glow)]',
            )}
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
          >
            <Mic size={22} />
            {recording && (
              <span
                className="absolute inset-0 rounded-full border border-[var(--amber)]"
                style={{ animation: 'orb-ping 1.1s ease-out infinite' }}
              />
            )}
          </button>

          <button
            type="button"
            onClick={stop}
            title="Interrupt"
            disabled={!turnActive && !speaking}
            className={cn(
              'flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] transition',
              turnActive || speaking ? 'text-[var(--red)] opacity-100 hover:opacity-80' : 'text-[var(--text-faint)] opacity-40',
            )}
          >
            <Square size={11} />
            stop
          </button>

          {/* Model selector */}
          <select
            value={activeModel}
            onChange={(e) => useJarvisStore.getState().send({ type: 'set_model', model: e.target.value })}
            className="rounded-full border border-[var(--line-bright)] bg-black/40 px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--text-dim)] outline-none backdrop-blur hover:border-[var(--blue)] hover:text-[var(--blue)]"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#0d1218] text-[var(--text)]">
                {modelLabel(m)}
              </option>
            ))}
          </select>
        </div>

        {/* Brightness slider */}
        <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
          <Minus size={9} />
          <input
            type="range"
            min="0.25"
            max="1.0"
            step="0.05"
            value={orbBrightness}
            onChange={(e) => setOrbBrightness(Number(e.target.value))}
            className="w-24 accent-[var(--blue)]"
            title="Orb brightness"
          />
          <Plus size={9} />
          <span className="w-8 tabular-nums text-[var(--text-dim)]">
            {(orbBrightness * 100).toFixed(0)}%
          </span>
        </div>

        <div className="text-center font-mono text-[10px] tracking-[0.18em] text-[var(--text-faint)]">
          say "hey cosmo" to interrupt · hold the orb to talk
        </div>
      </div>
    </div>
  )
}
