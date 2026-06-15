import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ToolCall } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

function stringify(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2)
    if (s && s.length > 4000) return s.slice(0, 4000) + '\n... [truncated]'
    return s ?? String(v)
  } catch {
    return String(v)
  }
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const icon =
    call.status === 'running' ? (
      <Loader2 size={13} className="animate-spin text-[var(--blue)]" />
    ) : call.status === 'done' ? (
      <CheckCircle2 size={13} className="text-[var(--green)]" />
    ) : (
      <XCircle size={13} className="text-[var(--red)]" />
    )

  return (
    <div
      className={cn(
        'mb-2 rounded-sm border-l-2 border bg-[var(--bg-elev-2)] text-xs',
        call.status === 'error'
          ? 'border-l-[var(--red)] border-[var(--line-bright)]'
          : call.status === 'done'
            ? 'border-l-[var(--green)] border-[var(--line-bright)]'
            : 'border-l-[var(--blue)] border-[var(--line-bright)]',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="flex items-center gap-2 overflow-hidden">
          {open ? <ChevronDown size={12} className="shrink-0 text-[var(--text-dim)]" /> : <ChevronRight size={12} className="shrink-0 text-[var(--text-dim)]" />}
          {icon}
          <span className="truncate font-display tracking-[0.15em] text-[var(--blue)]">{call.name}</span>
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-dim)]">
          {call.status === 'running' ? 'running…' : `${((call.elapsedMs || 0) / 1000).toFixed(2)}s`}
        </span>
      </button>
      {open && (
        <div className="border-t border-dashed border-[var(--line)]">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-1.5 text-[11px] text-[#8ab4d0]">
            {stringify(call.args)}
          </pre>
          {call.result !== undefined && (
            <pre
              className={cn(
                'max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-t border-dashed border-[var(--line)] bg-black/20 px-2.5 py-1.5 text-[11px]',
                call.status === 'error' ? 'text-[var(--red)]' : 'text-[var(--text)]',
              )}
            >
              {stringify(call.result)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
