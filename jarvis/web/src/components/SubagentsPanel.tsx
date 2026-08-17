import { useEffect, useState } from 'react'
import { Search, Code, Mail, Pencil, Loader2 } from 'lucide-react'
import { useJarvisStore } from '@/store/jarvisStore'
import { registerPanelContent } from './RadialMenu'

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

function SubagentsPanel() {
  const pushToast = useJarvisStore((s) => s.pushToast)
  const [subagents, setSubagents] = useState<Subagent[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

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
        setResults((r) => ({ ...r, [sub.name]: data.final_text || '(no output)' }))
        pushToast(`${sub.label}: done`, 'ok')
      } else {
        pushToast(`${sub.label}: ${data.error || 'failed'}`, 'err')
      }
    } catch (e) {
      pushToast(`${sub.label}: ${(e as Error).message}`, 'err')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-2 p-3">
      {subagents.length === 0 && (
        <div className="py-4 text-center text-[var(--text-dim)]">No subagents registered.</div>
      )}
      {subagents.map((s) => {
        const Icon = ICONS[s.icon] ?? Search
        const isRunning = running === s.name
        const result = results[s.name]
        return (
          <div key={s.name} className="rounded-sm border border-[var(--line-bright)] bg-black/30 p-2.5">
            <button
              type="button"
              disabled={!!running}
              onClick={() => launch(s)}
              className="flex w-full items-center gap-2 disabled:opacity-40"
            >
              {isRunning ? <Loader2 size={13} className="animate-spin text-[var(--blue)]" /> : <Icon size={13} className="text-[var(--blue)]" />}
              <div className="flex-1 text-left">
                <div className="font-mono text-[11px] tracking-[0.14em] text-[var(--text)]">{s.label}</div>
                <div className="font-mono text-[9.5px] text-[var(--text-faint)]">{s.slash_command}</div>
              </div>
              <span className="font-mono text-[9px] text-[var(--text-faint)]">run</span>
            </button>
            <div className="mt-1 text-[9.5px] leading-snug text-[var(--text-dim)]">{s.description}</div>
            {result && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-sm border border-[var(--line)] bg-black/40 p-2 font-mono text-[10.5px] leading-snug text-[var(--text)]">
                {result}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

registerPanelContent('subagents', SubagentsPanel)
