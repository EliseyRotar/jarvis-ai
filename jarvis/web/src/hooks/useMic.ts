import { useCallback, useRef, useState } from 'react'
import { useJarvisStore } from '@/store/jarvisStore'

function resampleTo16kMonoPCM16(audioBuf: AudioBuffer): Int16Array {
  const targetRate = 16000
  const ch0 = audioBuf.getChannelData(0)
  const ratio = audioBuf.sampleRate / targetRate
  const outLen = Math.floor(ch0.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio
    const lo = Math.floor(idx)
    const hi = Math.min(ch0.length - 1, lo + 1)
    const frac = idx - lo
    const s = ch0[lo] * (1 - frac) + ch0[hi] * frac
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff
  }
  return out
}

function arrayBufferToBase64(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function useMic() {
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Live amplitude analysis (drives the orb while the operator speaks).
  const analyserCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const sendAudioPcm = useJarvisStore((s) => s.sendAudioPcm)
  const setMicLevel = useJarvisStore((s) => s.setMicLevel)
  const setListening = useJarvisStore((s) => s.setListening)

  const teardownAnalyser = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (analyserCtxRef.current) {
      try {
        analyserCtxRef.current.close()
      } catch {
        /* noop */
      }
      analyserCtxRef.current = null
    }
    setListening(false)
  }, [setListening])

  const startAnalyser = useCallback(
    (stream: MediaStream) => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new AudioCtx()
        analyserCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyser.smoothingTimeConstant = 0.75
        src.connect(analyser)
        const buf = new Uint8Array(analyser.fftSize)
        const tick = () => {
          analyser.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          // Normalize: speech RMS sits ~0.02–0.25 → scale into a punchy 0..1.
          const level = Math.min(1, rms * 4.5)
          setMicLevel(level)
          rafRef.current = requestAnimationFrame(tick)
        }
        setListening(true)
        tick()
      } catch (err) {
        console.error('analyser failed', err)
      }
    },
    [setMicLevel, setListening],
  )

  const start = useCallback(async () => {
    if (recorderRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        stream.getTracks().forEach((t) => t.stop())
        recorderRef.current = null
        teardownAnalyser()
        try {
          const arrBuf = await blob.arrayBuffer()
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
          const audioCtx = new AudioCtx()
          const audioBuf = await audioCtx.decodeAudioData(arrBuf)
          const pcm = resampleTo16kMonoPCM16(audioBuf)
          const b64 = arrayBufferToBase64(pcm.buffer)
          sendAudioPcm(b64)
        } catch (err) {
          console.error('audio decode failed', err)
        }
      }
      recorder.start()
      recorderRef.current = recorder
      startAnalyser(stream)
      setRecording(true)
    } catch (err) {
      console.error('mic failed', err)
    }
  }, [sendAudioPcm, startAnalyser, teardownAnalyser])

  const stop = useCallback(() => {
    setRecording(false)
    try {
      recorderRef.current?.stop()
    } catch {
      /* noop */
    }
  }, [])

  return { recording, start, stop }
}
