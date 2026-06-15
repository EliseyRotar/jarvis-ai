import { useJarvisStore } from '@/store/jarvisStore'

export function SystemPulse() {
  const connected = useJarvisStore((s) => s.connected)
  const reactor = useJarvisStore((s) => s.reactor)
  const speaking = useJarvisStore((s) => s.speaking)
  const turnActive = useJarvisStore((s) => s.turnActive)

  let color = 'var(--blue)'
  let glow = 'var(--blue-glow)'
  if (!connected || reactor === 'OFFLINE' || reactor === 'HALT') {
    color = 'var(--red)'
    glow = 'var(--red-glow)'
  } else if (speaking) {
    color = 'var(--green)'
    glow = 'var(--green)'
  } else if (turnActive || reactor === 'THINK') {
    color = 'var(--amber)'
    glow = 'var(--amber-glow)'
  }

  return (
    <div
      className="system-pulse"
      style={{
        background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        boxShadow: `0 0 8px ${glow}`,
      }}
    />
  )
}
