import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FolderGit2, ListChecks, Brain, Activity, Settings, X, Plus, AlarmClock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from './ErrorBoundary'

export interface RadialPanel {
  id: string
  label: string
  icon: string
}

const ICONS: Record<string, typeof FolderGit2> = {
  projects: FolderGit2,
  tasks: ListChecks,
  jobs: AlarmClock,
  brain: Brain,
  activity: Activity,
  settings: Settings,
}

const PANEL_CONTENT: Record<string, React.ComponentType> = {}

/** Panels register their COMPONENT (LogsPanel, SettingsPanel, …). They must
 *  be rendered as elements (<Comp />), never invoked as plain functions:
 *  calling LogsPanel() from inside RadialMenu's render put the panel's hooks
 *  on RadialMenu's hook list, so the first open of any hook-using panel
 *  crashed with React #310 ("Rendered more hooks than during the previous
 *  render"). */
export function registerPanelContent(id: string, Comp: React.ComponentType) {
  PANEL_CONTENT[id] = Comp
}

/** Wrap a registered panel in its own ErrorBoundary so a single panel crash
 *  doesn't tear down the whole orb UI. */
function PanelErrorBoundary(props: { id: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary compact label={`panel · ${props.id}`}>
      {props.children}
    </ErrorBoundary>
  )
}

export function RadialMenu({ panels }: { panels: RadialPanel[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // Close panel on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openId = hovered ?? open
  const PanelComp = openId && openId !== '__hub__' ? PANEL_CONTENT[openId] : undefined

  return (
    <>
      {/* The hub button — click to expand into a ring */}
      <div className="relative flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(open ? null : '__hub__')}
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full border-2 backdrop-blur-md transition',
            open
              ? 'border-[var(--blue)] text-[var(--blue)] shadow-[0_0_18px_var(--blue-glow)]'
              : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
          )}
        >
          <Plus size={20} className={cn('transition', open && 'rotate-45')} />
        </button>

        {/* Panel labels (always-visible shortcuts around the hub) */}
        {!open && panels.map((p, i) => {
          const Icon = ICONS[p.icon] ?? Settings
          const angle = (Math.PI / 4) * (i - (panels.length - 1) / 2)
          const r = 86
          const x = Math.sin(angle) * r
          const y = -Math.cos(angle) * r * 0.6  // squish vertical so it fits the bottom strip
          return (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setOpen(p.id)}
              style={{ transform: `translate(${x}px, ${y}px)` }}
              className="absolute flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line-bright)] bg-black/55 text-[var(--text-dim)] backdrop-blur-md transition hover:scale-110 hover:border-[var(--blue)] hover:text-[var(--blue)]"
              title={p.label}
            >
              <Icon size={14} />
            </button>
          )
        })}
      </div>

      {/* Floating panel — renders the requested panel content.
          Portaled to <body>: RadialMenu is mounted inside an absolutely
          positioned ~48px hub wrapper (with a transform), which was BOTH the
          containing block for `absolute h-full` (panel collapsed to one
          button tall) AND, being transformed, would have captured any
          `fixed` child too. The portal escapes both, so `fixed inset-y-0`
          really is full viewport height. */}
      {openId &&
        createPortal(
          <div className="pointer-events-auto fixed inset-y-0 right-0 z-40 h-screen w-full max-w-[80vw] animate-[slide-in-right_0.25s_ease-out] border-l border-[var(--line-bright)] bg-black/85 backdrop-blur-xl sm:w-[420px]">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
                <div className="flex items-center gap-2 font-display text-[12px] uppercase tracking-[0.24em] text-[var(--blue)]">
                  {(() => {
                    const p = panels.find((p) => p.id === openId)
                    if (!p) return <span>menu</span>
                    const Icon = ICONS[p.icon] ?? Settings
                    return <><Icon size={13} /> {p.label}</>
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="rounded-sm border border-[var(--line-bright)] p-1 text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]"
                  title="Close panel (Esc)"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {openId === '__hub__' ? <HubPanel onPick={(id) => setOpen(id)} panels={panels} /> : (
                  <PanelErrorBoundary id={openId}>
                    {PanelComp ? <PanelComp key={openId} /> : <UnknownPanel id={openId} />}
                  </PanelErrorBoundary>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function HubPanel({ panels, onPick }: { panels: RadialPanel[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-1.5 p-3">
      {panels.map((p) => {
        const Icon = ICONS[p.icon] ?? Settings
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="flex w-full items-center gap-3 rounded-sm border border-[var(--line-bright)] bg-black/30 px-3 py-2.5 text-left transition hover:border-[var(--blue)] hover:bg-[rgba(0,200,255,0.06)]"
          >
            <Icon size={14} className="text-[var(--blue)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--text)]">{p.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function UnknownPanel({ id }: { id: string }) {
  return (
    <div className="p-5 text-[var(--text-dim)]">
      <p>Panel "{id}" has no content registered yet.</p>
      <p className="mt-2 text-[10px] text-[var(--text-faint)]">
        Use <code>registerPanelContent(id, render)</code> in the panel module to register.
      </p>
    </div>
  )
}
