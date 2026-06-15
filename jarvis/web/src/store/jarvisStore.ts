import { create } from 'zustand'

export type ToolCall = {
  id: string
  name: string
  args: unknown
  result?: unknown
  elapsedMs?: number
  status: 'running' | 'done' | 'error'
  startedAt: number
}

export type TranscriptTurn = {
  id: string
  text: string
  voice: boolean
  time: number
}

export type ResponseTurn = {
  id: string
  text: string
}

export type TaskStep = {
  n: number
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  reason?: string
}

export type TaskPlan = {
  task_id?: string
  goal?: string
  progress?: number
  started_at?: number
  steps?: TaskStep[]
  status?: 'success' | 'partial' | 'failed'
  summary?: string
  artifacts?: string[]
  issues?: string
}

export type ReactorState = 'ONLINE' | 'THINK' | 'SPEAK' | 'DONE' | 'HALT' | 'WAKE' | 'OFFLINE'

export type TurnMeta = {
  model?: string
  usage?: any
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  num_turns?: number
}

interface JarvisState {
  connected: boolean
  ready: boolean
  models: string[]
  activeModel: string
  reactor: ReactorState
  speaking: boolean
  turnActive: boolean
  thinkText: string
  thinkLive: boolean
  responseTurns: ResponseTurn[]
  responseLive: string
  responseState: 'idle' | 'streaming' | 'ready' | 'error'
  transcript: TranscriptTurn[]
  toolCalls: ToolCall[]
  task: TaskPlan | null
  taskHistory: TaskPlan[]
  lastTurnMeta: TurnMeta | null
  toasts: { id: string; message: string; kind: string }[]

  send: (obj: Record<string, unknown>) => void
  sendText: (text: string, voice?: boolean) => void
  sendAudioPcm: (b64: string) => void
  stop: () => void
  reset: () => void
  pushToast: (message: string, kind?: string) => void
  dismissToast: (id: string) => void
}

let ws: WebSocket | null = null
let reconnectDelay = 800
let nextId = 0
const genId = () => `id-${Date.now()}-${nextId++}`

export const useJarvisStore = create<JarvisState>((set, get) => ({
  connected: false,
  ready: false,
  models: [],
  activeModel: '',
  reactor: 'OFFLINE',
  speaking: false,
  turnActive: false,
  thinkText: '',
  thinkLive: false,
  responseTurns: [],
  responseLive: '',
  responseState: 'idle',
  transcript: [],
  toolCalls: [],
  task: null,
  taskHistory: [],
  lastTurnMeta: null,
  toasts: [],

  send: (obj) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
  },
  sendText: (text, voice = false) => {
    get().send({ type: 'user_text', text, voice })
  },
  sendAudioPcm: (b64) => {
    get().send({ type: 'user_audio_pcm', data: b64 })
  },
  stop: () => get().send({ type: 'stop' }),
  reset: () => get().send({ type: 'reset' }),
  pushToast: (message, kind = 'info') => {
    const id = genId()
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5': 'HAIKU 4.5',
  'claude-sonnet-4-6': 'SONNET 4.6',
  'claude-opus-4-7': 'OPUS 4.7',
}
export function modelLabel(m: string) {
  return MODEL_LABELS[m] || m.toUpperCase()
}

function handleLlmEvent(ev: any) {
  const { set, get } = storeApi
  switch (ev.type) {
    case 'think_start':
      set({ thinkLive: true })
      break
    case 'think_delta':
      set((s) => ({ thinkText: s.thinkText + ev.text }))
      break
    case 'think_end':
      set({ thinkLive: false })
      break
    case 'response_delta':
      set((s) => ({
        responseState: 'streaming',
        responseLive: s.responseLive + ev.text,
      }))
      break
    case 'tool_call':
      set((s) => ({
        toolCalls: [
          ...s.toolCalls,
          { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: Date.now() },
        ],
      }))
      break
    case 'tool_result': {
      const ok = ev.result && ev.result.ok !== false && !ev.result.error
      set((s) => ({
        toolCalls: s.toolCalls.map((tc) =>
          tc.id === ev.id
            ? { ...tc, result: ev.result, elapsedMs: ev.elapsed_ms || 0, status: ok ? 'done' : 'error' }
            : tc,
        ),
      }))
      break
    }
    case 'turn_meta': {
      const { type: _type, ...meta } = ev
      set({ lastTurnMeta: meta })
      break
    }
    case 'error':
      get().pushToast(ev.message || 'LLM error', 'err')
      break
    default:
      break
  }
}

function handleMessage(msg: any) {
  const { set, get } = storeApi
  switch (msg.type) {
    case 'ready':
      set({ ready: true, reactor: 'ONLINE' })
      if (msg.model) set({ activeModel: msg.model })
      break
    case 'history': {
      const messages = msg.messages || []
      const responseTurns: ResponseTurn[] = []
      const transcript: TranscriptTurn[] = []
      for (const m of messages) {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        if (!text) continue
        if (m.role === 'user') {
          transcript.push({ id: genId(), text, voice: false, time: Date.now() })
        } else if (m.role === 'assistant') {
          responseTurns.push({ id: genId(), text })
        }
      }
      if (messages.length) {
        set({ responseTurns, transcript })
        get().pushToast('Resumed previous conversation', 'ok')
      }
      break
    }
    case 'model_changed':
      set({ activeModel: msg.model })
      get().pushToast(`Model → ${modelLabel(msg.model)}`, 'ok')
      break
    case 'wake':
      set({ reactor: 'WAKE' })
      setTimeout(() => {
        if (!get().speaking) set({ reactor: 'ONLINE' })
      }, 1200)
      break
    case 'transcript':
      set((s) => ({
        transcript: [...s.transcript, { id: genId(), text: msg.text, voice: !!msg.voice, time: Date.now() }],
      }))
      break
    case 'turn_start':
      set((s) => ({
        thinkText: '',
        thinkLive: false,
        responseLive: '',
        responseState: 'idle',
        turnActive: true,
        reactor: 'THINK',
        responseTurns: s.responseLive.trim() || s.responseTurns.length
          ? [...s.responseTurns]
          : s.responseTurns,
      }))
      break
    case 'turn_end': {
      const live = get().responseLive
      set((s) => ({
        reactor: 'DONE',
        turnActive: false,
        responseState: 'ready',
        responseTurns: live.trim() ? [...s.responseTurns, { id: genId(), text: live }] : s.responseTurns,
        responseLive: '',
      }))
      break
    }
    case 'stopped': {
      const live2 = get().responseLive
      set((s) => ({
        reactor: 'HALT',
        turnActive: false,
        thinkLive: false,
        responseState: 'ready',
        responseTurns: live2.trim() ? [...s.responseTurns, { id: genId(), text: live2 }] : s.responseTurns,
        responseLive: '',
        speaking: false,
      }))
      get().pushToast('Turn aborted', 'warn')
      setTimeout(() => {
        if (get().reactor === 'HALT') set({ reactor: 'ONLINE' })
      }, 1500)
      break
    }
    case 'speaking':
      if (msg.state === 'start') {
        set({ speaking: true, reactor: 'SPEAK' })
      } else {
        set({ speaking: false, reactor: get().turnActive ? 'THINK' : 'ONLINE' })
      }
      break
    case 'llm_event':
      handleLlmEvent(msg.event)
      break
    case 'task_update':
      if (msg.kind === 'task_plan') set({ task: msg.plan })
      else if (msg.kind === 'step') set({ task: msg.plan })
      else if (msg.kind === 'task_complete') {
        set((s) => ({
          task: msg.plan,
          taskHistory: [msg.plan, ...s.taskHistory].slice(0, 50),
        }))
      }
      break
    case 'reset':
      set({
        thinkText: '',
        thinkLive: false,
        responseTurns: [],
        responseLive: '',
        responseState: 'idle',
        transcript: [],
        toolCalls: [],
        task: null,
      })
      break
    case 'shutdown':
      set({ reactor: 'OFFLINE', connected: false })
      get().pushToast('JARVIS is shutting down', 'err')
      break
    case 'error':
      get().pushToast(msg.message || 'An error occurred', 'err')
      break
    default:
      break
  }
}

// Bridge so handlers (declared before `create` finished) can reach state.
const storeApi = {
  get: useJarvisStore.getState,
  set: useJarvisStore.setState,
}

export function connectWebSocket() {
  if (ws) return
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'
  ws = new WebSocket(url)
  ws.onopen = () => {
    useJarvisStore.setState({ connected: true })
    reconnectDelay = 800
  }
  ws.onclose = () => {
    useJarvisStore.setState({ connected: false, reactor: 'OFFLINE' })
    ws = null
    setTimeout(connectWebSocket, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 1.6, 6000)
  }
  ws.onerror = () => {
    try {
      ws?.close()
    } catch {
      /* noop */
    }
  }
  ws.onmessage = (ev) => {
    let msg: any
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    handleMessage(msg)
  }
}

export async function loadModels() {
  try {
    const res = await fetch('/api/models')
    const data = await res.json()
    useJarvisStore.setState({ models: data.models || [], activeModel: data.active || '' })
  } catch {
    /* noop */
  }
}

export async function setModel(model: string) {
  try {
    const res = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    const data = await res.json()
    if (data.ok) useJarvisStore.setState({ activeModel: model })
  } catch {
    /* noop */
  }
}
