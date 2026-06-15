import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'
import { CommandPalette } from './CommandPalette'
import { Toasts } from './Toasts'
import { useJarvisStore, loadModels, setModel, modelLabel } from '@/store/jarvisStore'

function Clock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="hud-label font-mono tabular-nums text-[var(--text-dim)]">
      {pad(time.getHours())}:{pad(time.getMinutes())}:{pad(time.getSeconds())}
    </span>
  )
}

function TopBar() {
  const connected = useJarvisStore((s) => s.connected)
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)

  useEffect(() => {
    loadModels()
  }, [])

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] bg-gradient-to-b from-[rgba(0,200,255,0.04)] to-transparent px-5">
      <div className="flex items-baseline gap-3.5">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)]">JUST A RATHER VERY INTELLIGENT SYSTEM</span>
      </div>
      <div className="flex items-center gap-4">
        <span
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-dim)]"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: connected ? 'var(--blue)' : 'var(--red)',
              boxShadow: connected ? '0 0 10px var(--blue-glow)' : '0 0 8px var(--red-glow)',
            }}
          />
          {connected ? 'LINK' : 'OFFLINE'}
        </span>
        <select
          value={activeModel}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-sm border border-[var(--line-bright)] bg-transparent px-1.5 py-1 font-mono text-[11px] tracking-[0.12em] text-[var(--text-dim)] outline-none hover:border-[var(--blue)] hover:text-[var(--blue)]"
        >
          {models.map((m) => (
            <option key={m} value={m} className="bg-[#0d1218] text-[var(--text)]">
              {modelLabel(m)}
            </option>
          ))}
        </select>
        <Clock />
        <kbd className="rounded-sm border border-[var(--line-bright)] px-1.5 py-0.5 text-[10px] text-[var(--text-dim)]">
          {navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </div>
    </header>
  )
}

export function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full w-full">
      <div className="scanlines" />
      <div className="vignette" />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
    </div>
  )
}
