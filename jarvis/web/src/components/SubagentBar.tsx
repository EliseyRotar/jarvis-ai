import { useEffect, useState } from 'react'
import { Search, Code, Mail, Pencil, Loader2 } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { cn } from '@/lib/utils'

interface Subagent {
  name: string
  label: string
  description: string
  slash_command: string
  icon: string
}

const ICONS: Record<string, typeof Search> = {
  search: Search,
  code: Code,
  mail: Mail,
  pencil: Pencil,
}

export function SubagentBar() {
  const sendText = useJarvisStore((s) => s.sendText)
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [subagents, setSubagents] = useState<Subagent[]>([])
  const [running, setRunning] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/subagents')
      .then((r) => r.json())
      .then((data: { ok: boolean; subagents: Subagent[] }) => {
        if (data.ok) setSubagents(data.subagents)
      })
      .catch(() => undefined)
  }, [])

  const launch = async (sub: Subagent) => {
    const prompt = window.prompt(`${sub.label} — what do you want?`)
    if (!prompt || !prompt.trim()) return
    setRunning(sub.name)
    try {
      const r = await fetch(`/api/subagent/${sub.name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      })
      const data = await r.json()
      if (data.ok) {
        pushToast(`${sub.label}: done — see chat for the answer`, 'ok')
        // Forward to the chat by injecting the subagent reply as an assistant message
        sendText(`${sub.slash_command} ${prompt.trim()}`, false)
        // The synchronous endpoint already ran; the slash command will re-run it
        // via Hermes (cost: 2x tokens). Acceptable for v1 — better UX is to
        // stream it directly via WS, which is the next step.
      } else {
        pushToast(`${sub.label}: ${data.error || 'failed'}`, 'err')
      }
    } catch (e) {
      pushToast(`${sub.label}: ${(e as Error).message}`, 'err')
    } finally {
      setRunning(null)
    }
  }

  if (subagents.length === 0) return null

  return (
    <div className="pointer-events-auto flex flex-col gap-1.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.32em] text-[var(--text-faint)]">
        subagents
      </div>
      {subagents.map((s) => {
        const Icon = ICONS[s.icon] || Search
        const isRunning = running === s.name
        return (
          <button
            key={s.name}
            type="button"
            disabled={!!running}
            onClick={() => launch(s)}
            title={`${s.description} (slash: ${s.slash_command})`}
            className={cn(
              'flex items-center gap-2 rounded-full border border-[var(--line-bright)] bg-black/40 px-3 py-1.5 backdrop-blur transition',
              running && !isRunning ? 'opacity-40' : 'hover:border-[var(--blue)] hover:shadow-[0_0_10px_var(--blue-glow)]',
            )}
          >
            {isRunning ? (
              <Loader2 size={11} className="animate-spin text-[var(--blue)]" />
            ) : (
              <Icon size={11} className="text-[var(--blue)]" />
            )}
            <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--text)]">
              {s.slash_command}
            </span>
            <span className="font-mono text-[9px] tracking-[0.12em] text-[var(--text-faint)]">
              {s.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
