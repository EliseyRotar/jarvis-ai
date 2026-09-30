import { useEffect, useRef, useState } from 'react'
import {
  Terminal, Wrench, FileText, Pencil, Globe, Search, ListTodo,
  Camera, Cpu, Brain, Minus, X, ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { useJarvisStore, type ToolCall } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

// ── helpers ───────────────────────────────────────────────────────────────

const ICONS: Record<string, LucideIcon> = {
  terminal: Terminal,
  process: Terminal,
  run: Terminal,
  write_file: FileText,
  edit_file: Pencil,
  read_file: FileText,
  search: Search,
  web_search: Globe,
  web_fetch: Globe,
  x_search: Globe,
  todo: ListTodo,
  screenshot: Camera,
  attach_screen: Camera,
  ha_get_state: Cpu,
  ha_list_entities: Cpu,
  ha_call_service: Cpu,
  ha_list_services: Cpu,
  memory_search: Brain,
  mem0_search: Brain,
  mem0_add: Brain,
  memory: Brain,
}

function toolIcon(name: string): LucideIcon {
  return ICONS[name] || Wrench
}

function argsPreview(args: unknown, max = 90): string {
  let v = ''
  if (args && typeof args === 'object') {
    const o = args as Record<string, unknown>
    const pick =
      o.command ?? o.cmd ?? o.path ?? o.pattern ?? o.url ?? o.query ??
      o.description ?? o.name ?? o.action
    if (typeof pick === 'string') v = pick
    else {
      try { v = JSON.stringify(args) } catch { v = String(args) }
    }
  } else if (args != null) {
    v = String(args)
  }
  return v.length > max ? v.slice(0, max) + '…' : v
}

function pretty(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function statusDot(status: ToolCall['status']): string {
  if (status === 'error') return 'bg-[var(--red)]'
  if (status === 'done') return 'bg-[var(--green)]'
  return 'bg-[var(--amber)] animate-pulse'
}

// ── one expandable action row ─────────────────────────────────────────────

function ActivityRow({
  tc,
  expanded,
  onToggle,
  now,
}: {
  tc: ToolCall
  expanded: boolean
  onToggle: () => void
  now: number
}) {
  const Icon = toolIcon(tc.name)
  const running = tc.status === 'running'
  const elapsed = tc.elapsedMs != null ? tc.elapsedMs : running ? now - tc.startedAt : 0
  const hasDetail =
    pretty(tc.args).length > 0 || !!tc.output || !!tc.screenshot

  return (
    <li
      className={cn(
        'rounded-md border transition-colors',
        expanded
          ? 'border-[var(--blue)]/50 bg-[rgba(0,140,255,0.05)]'
          : 'border-transparent hover:border-[var(--line)] hover:bg-white/[0.03]',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(tc.status))} />
        <Icon
          size={12}
          className={cn(
            'shrink-0',
            tc.status === 'error' ? 'text-[var(--red)]' : 'text-[var(--blue)]',
          )}
        />
        <span className="shrink-0 font-mono text-[11px] text-[var(--text)]">{tc.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {argsPreview(tc.args)}
        </span>
        <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">
          {running ? `${(elapsed / 1000).toFixed(1)}s…` : elapsed ? fmtMs(elapsed) : ''}
        </span>
        {hasDetail && (
          <ChevronDown
            size={11}
            className={cn(
              'shrink-0 text-[var(--text-faint)] transition-transform',
              expanded && 'rotate-180',
            )}
          />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--line)] px-2.5 py-2">
          {pretty(tc.args) && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
                arguments
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed text-[var(--text-dim)]">
                {pretty(tc.args)}
              </pre>
            </div>
          )}
          <div>
            <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
              output
            </div>
            {tc.output ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2 font-mono text-[10.5px] leading-relaxed text-[var(--text-dim)]">
                {tc.output}
              </pre>
            ) : running ? (
              <div className="flex items-center gap-2 rounded bg-black/40 px-2 py-2 font-mono text-[10px] text-[var(--text-faint)]">
                <span className="h-2 w-2 animate-spin rounded-full border border-[var(--amber)] border-t-transparent" />
                running — output arrives when the command finishes…
              </div>
            ) : (
              <div className="rounded bg-black/40 px-2 py-2 font-mono text-[10px] text-[var(--text-faint)]">
                no output captured for this action
              </div>
            )}
          </div>
          {tc.screenshot && (
            <div>
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
                screen at start
              </div>
              <img
                src={`data:image/jpeg;base64,${tc.screenshot}`}
                alt=""
                className="max-h-40 rounded border border-[var(--line)] object-contain"
              />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// ── the floating activity window ──────────────────────────────────────────

export function ActivityWindow() {
  const open = useJarvisStore((s) => s.activityOpen)
  const setOpen = useJarvisStore((s) => s.setActivityOpen)
  const toolCalls = useJarvisStore((s) => s.toolCalls)
  const turnActive = useJarvisStore((s) => s.turnActive)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [, forceTick] = useState(0)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const anyRunning = toolCalls.some((tc) => tc.status === 'running')

  // live elapsed timers while something is running
  useEffect(() => {
    if (!open || !anyRunning) return
    const t = setInterval(() => forceTick((n) => n + 1), 150)
    return () => clearInterval(t)
  }, [open, anyRunning])

  // dragging by the header
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).closest('[data-aw]')?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const x = Math.max(8, Math.min(window.innerWidth - 120, e.clientX - dragRef.current.dx))
    const y = Math.max(8, Math.min(window.innerHeight - 48, e.clientY - dragRef.current.dy))
    setPos({ x, y })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  if (!open) return null

  const rows = [...toolCalls].reverse()
  const firstAt = toolCalls.length ? Math.min(...toolCalls.map((t) => t.startedAt)) : Date.now()
  const doneCount = toolCalls.filter((t) => t.status !== 'running').length

  // minimized: a small pill that restores the window
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        data-aw
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cn(
          'fixed z-30 flex items-center gap-2 rounded-full border border-[var(--line-bright)] bg-black/85 px-3.5 py-1.5 font-mono text-[10.5px] tracking-wide text-[var(--text-dim)] backdrop-blur-md transition hover:border-[var(--blue)]',
          !pos && 'left-1/2 top-[42%] -translate-x-1/2',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            anyRunning ? 'animate-pulse bg-[var(--amber)]' : 'bg-[var(--green)]',
          )}
        />
        activity · {toolCalls.length} action{toolCalls.length === 1 ? '' : 's'}
      </button>
    )
  }

  return (
    <div
      data-aw
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        'fixed z-30 w-[min(92vw,520px)] animate-[slide-in-right_0.18s_ease-out]',
        !pos && 'left-1/2 top-[34%] -translate-x-1/2',
      )}
    >
      <div className="overflow-hidden rounded-xl border border-[var(--line-bright)] bg-black/88 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
        {/* header — draggable */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-grab items-center gap-2 border-b border-[var(--line)] bg-white/[0.03] px-3 py-2 active:cursor-grabbing"
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              anyRunning || turnActive
                ? 'animate-pulse bg-[var(--amber)] shadow-[0_0_8px_var(--amber-glow)]'
                : 'bg-[var(--green)]',
            )}
          />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--text-dim)]">
            {anyRunning || turnActive ? 'cosmo working' : 'activity'}
          </span>
          <span className="font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">
            {toolCalls.length} action{toolCalls.length === 1 ? '' : 's'}
            {toolCalls.length > 0 && ` · ${fmtMs(Date.now() - firstAt)}`}
            {doneCount > 0 && ` · ${doneCount} done`}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="Minimize"
              onClick={() => setMinimized(true)}
              className="rounded p-1 text-[var(--text-faint)] transition hover:bg-white/10 hover:text-[var(--text)]"
            >
              <Minus size={12} />
            </button>
            <button
              type="button"
              title="Close (reopens when the next action starts)"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-[var(--text-faint)] transition hover:bg-white/10 hover:text-[var(--text)]"
            >
              <X size={12} />
            </button>
          </span>
        </div>

        {/* body */}
        <ul className="max-h-[46vh] space-y-1 overflow-y-auto p-2">
          {rows.length === 0 && (
            <li className="px-2 py-3 font-mono text-[10.5px] text-[var(--text-faint)]">
              watching for actions…
            </li>
          )}
          {rows.map((tc) => (
            <ActivityRow
              key={tc.id}
              tc={tc}
              now={Date.now()}
              expanded={expandedId === tc.id}
              onToggle={() => setExpandedId((cur) => (cur === tc.id ? null : tc.id))}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
