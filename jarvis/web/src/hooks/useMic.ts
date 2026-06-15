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
  const sendAudioPcm = useJarvisStore((s) => s.sendAudioPcm)

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
      setRecording(true)
    } catch (err) {
      console.error('mic failed', err)
    }
  }, [sendAudioPcm])

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
