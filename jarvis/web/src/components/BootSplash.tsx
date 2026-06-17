import { useEffect, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'

const BOOT_LINES = [
  'INITIALIZING CORE SYSTEMS…',
  'CALIBRATING REACTOR…',
  'LOADING NEURAL INTERFACE…',
  'ESTABLISHING UPLINK…',
  'ALL SYSTEMS NOMINAL',
]

const ELI6_BOOT_LINES = [
  'eli6 v0.1.0',
  'loading personality... ok',
  'linking audio........ ok',
  'connecting model..... ok',
  'ready.',
]

export function BootSplash({ onDone }: { onDone: () => void }) {
  const ready = useJarvisStore((s) => s.ready)
  const connected = useJarvisStore((s) => s.connected)
  const persona = useJarvisStore((s) => s.persona)
  const [lineIdx, setLineIdx] = useState(0)
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), 2200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const max = persona === 'eli6' ? ELI6_BOOT_LINES.length - 1 : BOOT_LINES.length - 1
    const i = setInterval(() => {
      setLineIdx((n) => Math.min(n + 1, max))
    }, 450)
    return () => clearInterval(i)
  }, [persona])

  useEffect(() => {
    if ((ready || connected) && minTimeElapsed) {
      setFading(true)
      const t = setTimeout(onDone, 500)
      return () => clearTimeout(t)
    }
  }, [ready, connected, minTimeElapsed, onDone])

  if (persona === 'eli6') {
    return (
      <div
        className={`fixed inset-0 z-50 flex flex-col items-start justify-center bg-black px-12 transition-opacity duration-500 ${
          fading ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ fontFamily: 'var(--mono)' }}
      >
        <div className="space-y-1 text-[15px] text-[var(--text)]">
          {ELI6_BOOT_LINES.slice(0, lineIdx + 1).map((ln, i) => (
            <div key={i}>{ln}</div>
          ))}
          <div className="pt-1"><span className="crt-cursor">█</span></div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--bg)] transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="relative mb-8 flex h-44 w-44 items-center justify-center">
        <div className="absolute h-full w-full rounded-full opacity-55" style={{ border: '1px solid var(--blue-dim)' }} />
        <div
          className="absolute h-32 w-32 rounded-full border-dashed opacity-50"
          style={{ border: '1px dashed var(--blue-dim)', animation: 'rotate 18s linear infinite' }}
        />
        <div
          className="absolute h-20 w-20 rounded-full opacity-80"
          style={{ border: '1px solid var(--blue)', boxShadow: '0 0 24px var(--blue-glow) inset', animation: 'rotate 9s linear infinite reverse' }}
        />
        <div className="font-display text-2xl font-bold tracking-[0.5em] text-[var(--blue)]" style={{ textShadow: '0 0 24px var(--blue-glow)' }}>
          J
        </div>
      </div>
      <div className="font-display text-3xl font-bold tracking-[0.6em] text-[var(--blue)]" style={{ textShadow: '0 0 24px var(--blue-glow)' }}>
        JARVIS
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.3em] text-[var(--text-dim)]">
        Just A Rather Very Intelligent System
      </div>
      <div className="mt-8 h-5 font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--text-dim)]">
        {BOOT_LINES[lineIdx]}
        <span className="hud-caret" />
      </div>
    </div>
  )
}
