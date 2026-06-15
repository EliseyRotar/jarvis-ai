import { NavLink } from 'react-router'
import { MessageSquare, LayoutDashboard, ListChecks, Database, Settings, ScrollText, Power } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Chat', icon: MessageSquare },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/memory', label: 'Memory', icon: Database },
  { to: '/logs', label: 'Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const connected = useJarvisStore((s) => s.connected)

  const shutdown = async () => {
    if (!confirm('Shut down JARVIS completely?')) return
    try {
      await fetch('/api/shutdown', { method: 'POST' })
    } catch {
      /* noop */
    }
  }

  return (
    <aside className="flex h-full w-[200px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--bg-elev)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-4">
        <span className="font-display text-base font-bold tracking-[0.4em] text-[var(--blue)]" style={{ textShadow: '0 0 18px var(--blue-glow)' }}>
          JARVIS
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-sm px-3 py-2 font-display text-[11px] uppercase tracking-[0.2em] transition',
                isActive
                  ? 'border border-[var(--blue)] bg-[rgba(0,200,255,0.08)] text-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]'
                  : 'border border-transparent text-[var(--text-dim)] hover:border-[var(--line-bright)] hover:text-[var(--text)]',
              )
            }
            end={to === '/'}
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-2 border-t border-[var(--line)] p-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)]">
          <span
            className={cn('h-2 w-2 rounded-full', connected ? 'bg-[var(--blue)] shadow-[0_0_10px_var(--blue-glow)]' : 'bg-[var(--red)] shadow-[0_0_8px_var(--red-glow)]')}
          />
          {connected ? 'LINK' : 'OFFLINE'}
        </div>
        <button
          type="button"
          onClick={shutdown}
          className="flex w-full items-center gap-2 rounded-sm border border-[var(--red)] px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.22em] text-[var(--red)] opacity-60 transition hover:opacity-100 hover:bg-[rgba(255,71,111,0.12)] hover:shadow-[0_0_14px_var(--red-glow)]"
        >
          <Power size={12} />
          Shutdown
        </button>
      </div>
    </aside>
  )
}
