export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'jarvis-theme'

let mediaQuery: MediaQueryList | null = null
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function applyResolved(resolved: 'light' | 'dark') {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
}

export function applyTheme(theme: Theme) {
  // Tear down any previous system-preference listener.
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener)
    mediaQuery = null
    mediaListener = null
  }

  applyResolved(resolveTheme(theme))

  if (theme === 'system') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = (e) => applyResolved(e.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', mediaListener)
  }
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function initTheme() {
  applyTheme(getTheme())
}
