import { useEffect, useMemo, useState } from 'react'
import { Search, BookOpen } from 'lucide-react'
import { registerPanelContent } from './RadialMenu'

interface Skill {
  name: string
  description?: string
  category?: string
}

function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let dead = false
    fetch('/api/skills')
      .then((r) => r.json())
      .then((d) => {
        if (dead) return
        const list = Array.isArray(d.data) ? d.data : Array.isArray(d.skills) ? d.skills : []
        setSkills(list)
        if (!list.length) setError(d.error || 'no skills returned')
      })
      .catch((e) => !dead && setError((e as Error).message))
    return () => {
      dead = true
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.category || '').toLowerCase().includes(q),
    )
  }, [skills, query])

  const grouped = useMemo(() => {
    const map = new Map<string, Skill[]>()
    for (const s of filtered) {
      const key = s.category || 'other'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <BookOpen size={13} className="shrink-0 text-[var(--blue)]" />
        <span className="font-display text-[11px] uppercase tracking-[0.2em] text-[var(--blue)]">
          skills · {skills.length}
        </span>
      </div>

      <div className="flex items-center gap-1.5 rounded-sm border border-[var(--line)] bg-black/30 px-2 py-1">
        <Search size={12} className="shrink-0 text-[var(--text-faint)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search skills…"
          className="w-full bg-transparent font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </div>

      {error && <div className="text-[11px] text-[var(--red)]">{error}</div>}

      {grouped.map(([cat, list]) => (
        <section key={cat}>
          <h4 className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--amber)]">
            {cat}
          </h4>
          <ul className="m-0 list-none space-y-1 p-0">
            {list.map((s) => (
              <li key={s.name} className="rounded-sm border border-[var(--line)] bg-black/30 p-2">
                <div className="font-mono text-[10.5px] text-[var(--text-dim)]">{s.name}</div>
                {s.description && (
                  <div className="mt-0.5 text-[10px] leading-snug text-[var(--text-faint)]">
                    {s.description}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

registerPanelContent('skills', SkillsPanel)
