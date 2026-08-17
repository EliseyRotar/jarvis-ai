import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router'
import { useJarvisStore } from '@/store/jarvisStore'
import { CommandPalette } from './CommandPalette'
import { Toasts } from './Toasts'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'chat', end: true },
  { to: '/dashboard', label: 'dashboard', end: false },
  { to: '/tasks', label: 'tasks', end: false },
  { to: '/memory', label: 'memory', end: false },
  { to: '/logs', label: 'logs', end: false },
  { to: '/connectors', label: 'connectors', end: false },
  { to: '/settings', label: 'settings', end: false },
]

function Uptime({ start }: { start: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  const s = Math.floor((now - start) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return <span>{h > 0 ? `${h}h${pad(m)}m` : `${pad(m)}:${pad(sec)}`}</span>
}

export function TerminalLayout() {
  const connected = useJarvisStore((s) => s.connected)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const speaking = useJarvisStore((s) => s.speaking)
  const setUiMode = useJarvisStore((s) => s.setUiMode)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [startedAt] = useState(() => Date.now())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const state = !connected ? 'OFFLINE' : speaking ? 'SPEAKING' : turnActive ? 'THINKING' : 'READY'
  const stateColor =
    state === 'READY' ? 'text-[var(--text)]' :
    state === 'THINKING' ? 'text-[var(--amber)]' :
    state === 'SPEAKING' ? 'text-[var(--text)]' :
    'text-[var(--red)]'

  const shortModel = activeModel ? activeModel.replace('claude-', '').replace(/:.*$/, '') : '—'

  return (
    <div className="flex h-full w-full flex-col bg-black text-[var(--text)]" style={{ fontFamily: 'var(--mono)' }}>
      <div className="scanlines" />
      <div className="vignette" />

      {/* Top bar: wordmark + plain-text nav */}
      <header className="flex shrink-0 items-baseline gap-6 border-b border-[var(--line)] px-4 py-2">
        <span style={{ fontFamily: 'var(--display)', fontSize: '28px', lineHeight: 1 }} className="text-[var(--text)]">
          eli6
        </span>
        <nav className="flex flex-wrap gap-4 text-[13px]">
          {NAV.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'transition',
                  isActive
                    ? 'text-[var(--text)] underline underline-offset-4'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]',
                )
              }
            >
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setUiMode('orb')}
            className="text-[var(--text-dim)] transition hover:text-[var(--text)]"
            title="Switch to the Orb console"
          >
            ◉ orb
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Bottom status bar */}
      <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] px-4 py-1 text-[12px] text-[var(--text-dim)]">
        <span className={cn('font-semibold', stateColor)}>{state}</span>
        <span>·</span>
        <span>model {shortModel}</span>
        <span>·</span>
        <span>uptime <Uptime start={startedAt} /></span>
        <span className="ml-auto">
          <span className="crt-cursor text-[var(--text)]">█</span>
        </span>
      </footer>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
    </div>
  )
}
