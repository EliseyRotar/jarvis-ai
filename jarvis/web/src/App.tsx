import { useEffect, useState } from 'react'
import { connectWebSocket, useJarvisStore } from '@/store/jarvisStore'
import { BootSplash } from '@/components/BootSplash'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OrbConsole } from '@/pages/OrbConsole'
import { initPersonaEarly } from '@/lib/cosmo'
import '@/components/ProjectsPanel'
import '@/components/SubagentsPanel'
import '@/components/TasksPanel'
import '@/components/LogsPanel'
import '@/components/SettingsPanel'

function App() {
  const [booted, setBooted] = useState(false)
  const setPersona = useJarvisStore((s) => s.setPersona)

  useEffect(() => {
    const persona = initPersonaEarly()
    setPersona(persona)
    connectWebSocket()
  }, [setPersona])

  return (
    <ErrorBoundary>
      {!booted && <BootSplash onDone={() => setBooted(true)} />}
      <OrbConsole />
    </ErrorBoundary>
  )
}

export default App
