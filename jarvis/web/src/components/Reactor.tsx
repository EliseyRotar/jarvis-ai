import { useEffect, useRef } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'

export function Reactor() {
  const reactor = useJarvisStore((s) => s.reactor)
  const speaking = useJarvisStore((s) => s.speaking)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRef = useRef(0.05)

  useEffect(() => {
    if (reactor === 'SPEAK' || speaking) targetRef.current = 0.92
    else if (reactor === 'THINK') targetRef.current = 0.18
    else if (reactor === 'HALT' || reactor === 'OFFLINE') targetRef.current = 0
    else targetRef.current = 0.05
  }, [reactor, speaking])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let amp = 0
    let phase = 0
    let raf: number
    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      amp += (targetRef.current - amp) * 0.12
      ctx.lineWidth = 1.4
      for (let layer = 0; layer < 3; layer++) {
        ctx.beginPath()
        const baseAmp = amp * (1 - layer * 0.25)
        ctx.strokeStyle =
          layer === 0 ? 'rgba(0, 200, 255, 0.85)' : `rgba(0, 200, 255, ${0.35 - layer * 0.1})`
        for (let x = 0; x < w; x++) {
          const t = (x / w) * Math.PI * 4 + phase + layer * 0.7
          const noise = (Math.sin(x * 0.21 + phase * 2.3) + Math.sin(x * 0.07 + phase * 1.1)) * 0.5
          const y = h / 2 + Math.sin(t) * baseAmp * h * 0.35 + noise * baseAmp * h * 0.15
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      phase += 0.07 + amp * 0.15
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="relative flex h-56 items-center justify-center overflow-hidden border-b border-[var(--line)] bg-[radial-gradient(circle_at_50%_50%,rgba(0,200,255,0.06)_0%,transparent_70%)]">
      <div
        className="pointer-events-none absolute rounded-full opacity-55"
        style={{ width: 180, height: 180, border: '1px solid var(--blue-dim)' }}
      />
      <div
        className="pointer-events-none absolute rounded-full border-dashed opacity-45"
        style={{ width: 130, height: 130, border: '1px dashed var(--blue-dim)', animation: 'rotate 24s linear infinite' }}
      />
      <div
        className="pointer-events-none absolute rounded-full opacity-70"
        style={{
          width: 85,
          height: 85,
          border: '1px solid var(--blue)',
          boxShadow: speaking ? '0 0 32px var(--blue), 0 0 50px var(--blue-glow) inset' : '0 0 18px var(--blue-glow) inset',
          animation: 'rotate 14s linear infinite reverse',
        }}
      />
      <div
        className="font-display text-sm font-bold tracking-[0.3em] text-[var(--blue)]"
        style={{
          textShadow: speaking ? '0 0 32px var(--blue), 0 0 60px var(--blue-glow)' : '0 0 18px var(--blue-glow)',
          animation: speaking ? 'pulse 0.9s ease-in-out infinite alternate' : 'none',
          zIndex: 2,
          position: 'relative',
        }}
      >
        {reactor}
      </div>
      <canvas
        ref={canvasRef}
        width={320}
        height={90}
        className="absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 opacity-85"
      />
    </div>
  )
}
