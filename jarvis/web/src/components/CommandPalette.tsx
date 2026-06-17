import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  MessageSquare,
  LayoutDashboard,
  ListChecks,
  Database,
  Settings,
  ScrollText,
  RotateCcw,
  Square,
  Power,
  Cpu,
  Plug,
} from 'lucide-react'
import { useJarvisStore, loadModels, setModel, modelLabel } from '@/store/jarvisStore'

type Cmd = {
  id: string
  label: string
  group: string
  icon: React.ComponentType<{ size?: number }>
  action: () => void
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const reset = useJarvisStore((s) => s.reset)
  const stop = useJarvisStore((s) => s.stop)

  useEffect(() => {
    if (open) loadModels()
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const commands: Cmd[] = useMemo(() => {
    const nav = [
      { id: 'nav-chat', label: 'Go to Chat', group: 'Navigate', icon: MessageSquare, action: () => navigate('/') },
      { id: 'nav-dash', label: 'Go to Dashboard', group: 'Navigate', icon: LayoutDashboard, action: () => navigate('/dashboard') },
      { id: 'nav-tasks', label: 'Go to Tasks', group: 'Navigate', icon: ListChecks, action: () => navigate('/tasks') },
      { id: 'nav-memory', label: 'Go to Memory', group: 'Navigate', icon: Database, action: () => navigate('/memory') },
      { id: 'nav-logs', label: 'Go to Logs', group: 'Navigate', icon: ScrollText, action: () => navigate('/logs') },
      { id: 'nav-connectors', label: 'Go to Connectors', group: 'Navigate', icon: Plug, action: () => navigate('/connectors') },
      { id: 'nav-settings', label: 'Go to Settings', group: 'Navigate', icon: Settings, action: () => navigate('/settings') },
    ]
    const actions = [
      { id: 'act-reset', label: 'Reset conversation', group: 'Actions', icon: RotateCcw, action: () => reset() },
      { id: 'act-stop', label: 'Stop current turn', group: 'Actions', icon: Square, action: () => stop() },
      {
        id: 'act-shutdown',
        label: 'Shut down JARVIS',
        group: 'Actions',
        icon: Power,
        action: () => {
          if (confirm('Shut down JARVIS completely?')) fetch('/api/shutdown', { method: 'POST' }).catch(() => {})
        },
      },
    ]
    const modelCmds = models.map((m) => ({
      id: `model-${m}`,
      label: `Switch model → ${modelLabel(m)}${m === activeModel ? ' (active)' : ''}`,
      group: 'Model',
      icon: Cpu,
      action: () => setModel(m),
    }))
    return [...nav, ...actions, ...modelCmds]
  }, [models, activeModel, navigate, reset, stop])

  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]" onClick={onClose}>
      <div
        className="hud-panel w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter' && filtered[0]) {
              filtered[0].action()
              onClose()
            }
          }}
          placeholder="Type a command…"
          className="w-full border-b border-[var(--line)] bg-transparent px-4 py-3 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-[var(--text-dim)]">No matching commands</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                c.action()
                onClose()
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[rgba(0,200,255,0.08)] hover:text-[var(--blue)]"
            >
              <c.icon size={14} />
              <span className="flex-1">{c.label}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
