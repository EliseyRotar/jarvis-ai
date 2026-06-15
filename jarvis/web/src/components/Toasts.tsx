import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

const BORDER: Record<string, string> = {
  ok: 'border-l-[var(--green)]',
  warn: 'border-l-[var(--amber)]',
  err: 'border-l-[var(--red)]',
  info: 'border-l-[var(--blue)]',
}

export function Toasts() {
  const toasts = useJarvisStore((s) => s.toasts)
  const dismiss = useJarvisStore((s) => s.dismissToast)
  return (
    <div className="fixed right-4 top-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            'min-w-[180px] max-w-[340px] cursor-pointer rounded-md border border-[var(--line-bright)] border-l-3 bg-[rgba(13,18,24,0.96)] px-3.5 py-2.5 text-xs tracking-[0.03em] text-[var(--text)] shadow-[0_6px_24px_rgba(0,0,0,0.5)]',
            BORDER[t.kind] || BORDER.info,
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
