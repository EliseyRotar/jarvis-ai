export type Persona = 'jarvis' | 'eli6'

const STORAGE_KEY = 'jarvis-persona'

export function getStoredPersona(): Persona {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'eli6' ? 'eli6' : 'jarvis'
}

export function applyPersonaClass(p: Persona): void {
  const html = document.documentElement
  html.classList.remove('persona-jarvis', 'persona-eli6')
  html.classList.add(`persona-${p}`)
  document.title = p === 'eli6' ? 'eli6' : 'JARVIS'
}

export async function loadPersona(): Promise<Persona> {
  try {
    const r = await fetch('/api/persona')
    const d = await r.json()
    const p: Persona = d.persona === 'eli6' ? 'eli6' : 'jarvis'
    localStorage.setItem(STORAGE_KEY, p)
    return p
  } catch {
    return getStoredPersona()
  }
}

export async function savePersona(p: Persona): Promise<void> {
  localStorage.setItem(STORAGE_KEY, p)
  applyPersonaClass(p)
  try {
    await fetch('/api/persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: p }),
    })
  } catch {
    /* persisted locally; backend will catch up */
  }
}

/** Pre-React boot — applies persona class before first paint. */
export function initPersonaEarly(): Persona {
  const p = getStoredPersona()
  applyPersonaClass(p)
  return p
}
