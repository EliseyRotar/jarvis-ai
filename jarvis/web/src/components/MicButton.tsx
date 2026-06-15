import { Mic } from 'lucide-react'
import { useMic } from '@/hooks/useMic'
import { cn } from '@/lib/utils'

export function MicButton() {
  const { recording, start, stop } = useMic()
  return (
    <button
      type="button"
      onMouseDown={start}
      onTouchStart={start}
      onMouseUp={stop}
      onTouchEnd={stop}
      onMouseLeave={stop}
      title="Hold to talk"
      className={cn(
        'flex items-center gap-1.5 rounded-sm border px-3 py-1.5 font-display text-[11px] tracking-[0.2em] transition',
        recording
          ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--bg)] shadow-[0_0_14px_var(--amber-glow)]'
          : 'border-[var(--blue)] text-[var(--blue)] hover:bg-[rgba(0,200,255,0.1)] hover:shadow-[0_0_12px_var(--blue-glow)]',
      )}
    >
      <Mic size={13} />
      {recording ? 'REC' : 'MIC'}
    </button>
  )
}
