import { useEffect, useRef, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'
import type { OrbSceneApi } from '@/lib/orbScene'
import type { TrackerStatus } from '@/lib/handTracker'

/**
 * Holographic wireframe orb (Three.js) — ported from the ULTRON orb UI and
 * wired to JARVIS's live state. Reads the Zustand store inside the rAF loop
 * (never via React props) so it animates at 60fps without re-rendering.
 *
 * three.js + MediaPipe are lazy-loaded (dynamic import) so the classic HUD
 * never pays the ~1MB cost of the orb stack.
 *
 * Controls:
 *   - Mouse drag = spin, scroll = zoom (OrbitControls)
 *   - Webcam hand gestures (toggle with G or the button): pinch one hand to
 *     spin, pinch both hands and spread/close to zoom
 */

export function OrbCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<OrbSceneApi | null>(null)
  const trackerRef = useRef<{ stop(): void } | null>(null)
  const [gestures, setGestures] = useState(false)
  const [gestureStatus, setGestureStatus] = useState<TrackerStatus>({ hands: 0, mode: 'idle' })
  const [gestureError, setGestureError] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let scene: OrbSceneApi | null = null

    import('@/lib/orbScene').then(({ createOrbScene }) => {
      if (disposed || !container) return
      scene = createOrbScene(container, () => {
        const s = useJarvisStore.getState()
        return {
          speaking: s.speaking,
          listening: s.listening,
          thinking: s.turnActive && !s.speaking,
          micLevel: s.micLevel,
          mode: s.mode,
          wakeFlash: s.wakeFlash,
        }
      })
      sceneRef.current = scene
    })

    return () => {
      disposed = true
      trackerRef.current?.stop()
      trackerRef.current = null
      scene?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!gestures) {
      trackerRef.current?.stop()
      trackerRef.current = null
      setGestureStatus({ hands: 0, mode: 'idle' })
      setGestureError('')
      return
    }
    const video = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay) return

    let cancelled = false
    let tracker: { start(): Promise<void>; stop(): void } | null = null

    import('@/lib/handTracker').then(({ HandTracker }) => {
      if (cancelled || !sceneRef.current) return
      tracker = new HandTracker(video, overlay, {
        onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
        onZoom: (f) => sceneRef.current?.zoomBy(f),
        onStatus: (st) => setGestureStatus(st),
      })
      trackerRef.current = tracker
      tracker
        .start()
        .then(() => {
          if (cancelled) tracker?.stop()
        })
        .catch((err: unknown) => {
          setGestureError(err instanceof Error ? err.message : String(err))
          setGestures(false)
        })
    })

    return () => {
      cancelled = true
      tracker?.stop()
      trackerRef.current = null
    }
  }, [gestures])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'g' || e.key === 'G') setGestures((v) => !v)
      if (e.key === 'r' || e.key === 'R') sceneRef.current?.resetView()
      if (e.key === '+') sceneRef.current?.zoomIn()
      if (e.key === '-') sceneRef.current?.zoomOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Hidden webcam feed for hand tracking */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={overlayRef} width={640} height={480} className="hidden" />

      {/* Gesture controls */}
      <div className="absolute right-5 top-16 z-10 flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={() => setGestures((v) => !v)}
          className={gestures
            ? 'rounded-full border border-[var(--amber)] bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--amber)] backdrop-blur transition hover:opacity-80'
            : 'rounded-full border border-[var(--line-bright)] bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)] backdrop-blur transition hover:border-[var(--blue)] hover:text-[var(--blue)]'}
        >
          {gestures ? 'gestures on' : 'gestures off'}
        </button>
        {gestures && !gestureError && (
          <span className="font-mono text-[9px] tracking-[0.15em] text-[var(--text-faint)]">
            {gestureStatus.mode === 'spin' && 'pinch to spin'}
            {gestureStatus.mode === 'zoom' && 'two hands to zoom'}
            {gestureStatus.mode === 'idle' && 'waiting for hands…'}
          </span>
        )}
        {gestureError && (
          <span className="font-mono text-[9px] tracking-[0.15em] text-[var(--red)]">
            camera unavailable
          </span>
        )}
      </div>
    </div>
  )
}
