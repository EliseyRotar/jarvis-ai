/** Cosmo boot helpers — replaces the deleted persona.ts.

There is no persona switching anymore. The voice is unified as Cosmo.
This file just initializes the persona CSS class for any legacy
references in the HTML and provides a default for the store.
*/

export type Persona = 'cosmo'

export function getStoredPersona(): Persona {
  return 'cosmo'
}

export function applyPersonaClass(_p: Persona = 'cosmo'): void {
  const html = document.documentElement
  html.classList.remove('persona-jarvis', 'persona-eli6', 'persona-cosmo')
  html.classList.add('persona-cosmo')
  document.title = 'cosmo'
}

export async function loadPersona(): Promise<Persona> {
  return 'cosmo'
}

export async function savePersona(_p: Persona): Promise<void> {
  // No-op: voice is unified, no remote state to persist.
}

/** Pre-React boot — applies persona class before first paint. */
export function initPersonaEarly(): Persona {
  applyPersonaClass('cosmo')
  return 'cosmo'
}
