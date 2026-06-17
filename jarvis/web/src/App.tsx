import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router'
import { connectWebSocket, useJarvisStore } from '@/store/jarvisStore'
import { loadPersona, applyPersonaClass } from '@/lib/persona'
import { Layout } from '@/components/Layout'
import { BootSplash } from '@/components/BootSplash'
import { ChatPage } from '@/pages/ChatPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { TasksPage } from '@/pages/TasksPage'
import { MemoryPage } from '@/pages/MemoryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { LogsPage } from '@/pages/LogsPage'
import { ConnectorsPage } from '@/pages/ConnectorsPage'

function App() {
  const [booted, setBooted] = useState(false)
  const setPersona = useJarvisStore((s) => s.setPersona)

  useEffect(() => {
    connectWebSocket()
    loadPersona().then((p) => {
      applyPersonaClass(p)
      setPersona(p)
    })
  }, [setPersona])

  return (
    <>
      {!booted && <BootSplash onDone={() => setBooted(true)} />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ChatPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="connectors" element={<ConnectorsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  )
}

export default App
