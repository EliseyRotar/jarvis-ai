import { useState } from 'react'
import { Mic, Square, LayoutGrid, Send } from 'lucide-react'
import { useJarvisStore, setModel, modelLabel } from '@/store/jarvisStore'
import { useMic } from '@/hooks/useMic'
import { cn } from '@/lib/utils'
import { OrbCanvas } from '@/components/OrbCanvas'
import { TaskOrb } from '@/components/TaskOrb'
import { SubagentBar } from '@/components/SubagentBar'

function cleanCaption(text: string, max = 160): string {
  const t = text
    .replace(/<jarvis:[^>]*>[\s\S]*?<\/jarvis:[^>]*>/g, ' ')
    .replace(/[#*`_>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return '…' + t.slice(t.length - max)
}

function stateWord(speaking: boolean, listening: boolean, thinking: boolean): string {
  if (speaking) return 'speaking'
  if (listening) return 'listening'
  if (thinking) return 'thinking'
  return 'ready'
}

export function OrbConsole() {
  const persona = useJarvisStore((s) => s.persona)
  const connected = useJarvisStore((s) => s.connected)
  const models = useJarvisStore((s) => s.models)
  const activeModel = useJarvisStore((s) => s.activeModel)
  const mode = useJarvisStore((s) => s.mode)
  const setMode = useJarvisStore((s) => s.setMode)
  const transcript = useJarvisStore((s) => s.transcript)
  const responseLive = useJarvisStore((s) => s.responseLive)
  const responseTurns = useJarvisStore((s) => s.responseTurns)
  const speaking = useJarvisStore((s) => s.speaking)
  const listening = useJarvisStore((s) => s.listening)
  const turnActive = useJarvisStore((s) => s.turnActive)
  const setUiMode = useJarvisStore((s) => s.setUiMode)
  const sendText = useJarvisStore((s) => s.sendText)
  const stop = useJarvisStore((s) => s.stop)

  const { recording, start, stop: micStop } = useMic()
  const [text, setText] = useState('')
  const [showInput, setShowInput] = useState(false)

  const thinking = turnActive && !speaking
  const task = useJarvisStore((s) => s.task)
  const name = persona === 'eli6' ? 'eli6' : 'J.A.R.V.I.S'

  const lastUser = transcript.length ? transcript[transcript.length - 1].text : ''
  const userCaption = recording || listening ? 'listening…' : cleanCaption(lastUser, 120)
  const assistantText = responseLive || (responseTurns.length ? responseTurns[responseTurns.length - 1].text : '')
  const assistantCaption = cleanCaption(assistantText)

  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendText(t, false)
    setText('')
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Orb fills the screen; it draws its glow centered. */}
      <div className="absolute inset-0">
        <OrbCanvas />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,0.78) 100%)' }}
      />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              background: connected ? 'var(--blue)' : 'var(--red)',
              boxShadow: connected ? '0 0 10px var(--blue-glow)' : '0 0 8px var(--red-glow)',
            }}
          />
          <span className="text-[11px] uppercase tracking-[0.34em] text-[var(--text-dim)]">{name}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMode(mode === 'wwf' ? 'default' : 'wwf')}
            title={mode === 'wwf' ? 'Switch to normal mode' : 'Switch to WWF work mode'}
            className={cn(
              'rounded-full border bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] backdrop-blur transition',
              mode === 'wwf'
                ? 'border-[var(--amber)] text-[var(--amber)] shadow-[0_0_12px_var(--amber-glow)]'
                : 'border-[var(--line-bright)] text-[var(--text-dim)] hover:border-[var(--blue)] hover:text-[var(--blue)]',
            )}
          >
            {mode === 'wwf' ? 'wwf mode' : 'normal'}
          </button>
          <select
            value={activeModel}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-full border border-[var(--line-bright)] bg-black/40 px-3 py-1 font-mono text-[10px] tracking-[0.12em] text-[var(--text-dim)] outline-none backdrop-blur hover:border-[var(--blue)] hover:text-[var(--blue)]"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#0d1218] text-[var(--text)]">
                {modelLabel(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setUiMode('classic')}
            title="Switch to the classic HUD"
            className="flex items-center gap-1.5 rounded-full border border-[var(--line-bright)] bg-black/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-dim)] backdrop-blur transition hover:border-[var(--blue)] hover:text-[var(--blue)]"
          >
            <LayoutGrid size={12} />
            classic
          </button>
        </div>
      </div>

      {/* User caption — "what am I saying" */}
      <div className="pointer-events-none absolute inset-x-0 top-[16%] z-10 flex justify-center px-8">
        <div
          className={cn(
            'max-w-2xl text-center font-mono text-[13px] leading-relaxed tracking-wide transition-opacity duration-300',
            recording || listening ? 'text-[var(--amber)] opacity-90' : 'text-[var(--text-dim)] opacity-70',
          )}
        >
          {userCaption && <span className="opacity-60">you · </span>}
          {userCaption}
        </div>
      </div>

      {/* Task panel (left side, vertically centered) */}
      {task && (
        <div className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2">
          <TaskOrb plan={task} />
        </div>
      )}

      {/* Subagent quick-launch (right side, vertically centered) */}
      <div className="pointer-events-none absolute right-5 top-1/2 z-10 -translate-y-1/2">
        <SubagentBar />
      </div>

      {/* Assistant caption — "what is he saying" */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[19%] z-10 flex flex-col items-center gap-3 px-8">
        <div
          className="text-[10px] uppercase tracking-[0.4em] transition-colors"
          style={{
            color: speaking ? 'var(--blue)' : 'var(--text-faint)',
            textShadow: speaking ? '0 0 14px var(--blue-glow)' : 'none',
          }}
        >
          {stateWord(speaking, recording || listening, thinking)}
        </div>
        <div
          className={cn(
            'max-w-3xl text-center text-[15px] leading-relaxed transition-opacity duration-300',
            assistantCaption ? 'opacity-100' : 'opacity-0',
          )}
          style={{ color: 'var(--text)', textShadow: '0 0 18px rgba(0,200,255,0.18)' }}
        >
          {assistantCaption}
          {responseLive && <span className="crt-cursor ml-0.5">▍</span>}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-5 pb-6">
        {showInput && (
          <div className="flex w-full max-w-md items-center gap-2">
            <input
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  setShowInput(false)
                }
              }}
              placeholder="type a message…"
              className="flex-1 rounded-full border border-[var(--line-bright)] bg-black/50 px-4 py-2 font-mono text-[13px] text-[var(--text)] outline-none backdrop-blur transition focus:border-[var(--blue)] focus:shadow-[0_0_14px_var(--blue-glow)]"
            />
            <button
              type="button"
              onClick={submit}
              className="rounded-full border border-[var(--blue)] p-2 text-[var(--blue)] transition hover:bg-[rgba(0,200,255,0.12)]"
            >
              <Send size={15} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowInput((v) => !v)}
            title="Type instead"
            className="font-mono text-[11px] tracking-[0.2em] text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
          >
            {showInput ? 'hide' : 'type'}
          </button>

          {/* Push-to-talk orb mic */}
          <button
            type="button"
            onMouseDown={start}
            onMouseUp={micStop}
            onMouseLeave={micStop}
            onTouchStart={start}
            onTouchEnd={micStop}
            title="Hold to talk"
            className={cn(
              'relative flex h-16 w-16 items-center justify-center rounded-full border transition',
              recording
                ? 'border-[var(--amber)] text-[var(--amber)] shadow-[0_0_28px_var(--amber-glow)]'
                : 'border-[var(--blue)] text-[var(--blue)] hover:shadow-[0_0_22px_var(--blue-glow)]',
            )}
            style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
          >
            <Mic size={22} />
            {recording && (
              <span
                className="absolute inset-0 rounded-full border border-[var(--amber)]"
                style={{ animation: 'orb-ping 1.1s ease-out infinite' }}
              />
            )}
          </button>

          <button
            type="button"
            onClick={stop}
            title="Interrupt"
            disabled={!turnActive && !speaking}
            className={cn(
              'flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] transition',
              turnActive || speaking ? 'text-[var(--red)] opacity-100 hover:opacity-80' : 'text-[var(--text-faint)] opacity-40',
            )}
          >
            <Square size={11} />
            stop
          </button>
        </div>

        <div className="text-center font-mono text-[10px] tracking-[0.18em] text-[var(--text-faint)]">
          say “{persona === 'eli6' ? 'jarvis' : 'hey jarvis'}” to interrupt · hold the orb to talk
        </div>
      </div>
    </div>
  )
}
