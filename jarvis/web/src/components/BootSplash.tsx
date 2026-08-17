import { useEffect, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'

const BOOT_LINES = [
  'INITIALIZING…',
  'LOADING cosmo v1.0',
  'PROBING audio device... ok',
  'LINKING to hermes...',
  'ONLINE. what do you actually need?',
]

export function BootSplash({ onDone }: { onDone: () => void }) {
  const ready = useJarvisStore((s) => s.ready)
  const connected = useJarvisStore((s) => s.connected)
  const [lineIdx, setLineIdx] = useState(0)
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const max = BOOT_LINES.length - 1
    const i = setInterval(() => setLineIdx((n) => Math.min(n + 1, max)), 380)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    if ((ready || connected) && minTimeElapsed) {
      setFading(true)
      const t = setTimeout(onDone, 400)
      return () => clearTimeout(t)
    }
  }, [ready, connected, minTimeElapsed, onDone])

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-start justify-center bg-black px-12 font-mono transition-opacity duration-400 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="space-y-1 text-[14px] text-[var(--text)]">
        {BOOT_LINES.slice(0, lineIdx + 1).map((ln, i) => (
          <div key={i} className={i === lineIdx ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}>
            {ln}
          </div>
        ))}
        {lineIdx === BOOT_LINES.length - 1 && (
          <div className="pt-2 text-[var(--text-faint)]"><span className="crt-cursor">█</span></div>
        )}
      </div>
    </div>
  )
}
