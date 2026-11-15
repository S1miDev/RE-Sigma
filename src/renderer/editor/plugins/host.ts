// Runs one plugin: its code in a Worker, its optional UI in an iframe (PluginUI), both served from refig-plugin://.
// Everything a plugin asks for goes through `dispatch`, which validates it; the document is only changed via store.update.
import type { PluginInfo } from '../../../shared/api'
import { isContainer, makeNode, solid, type Node, type NodeType } from '../../../shared/document'
import { childrenOf, insert, nextName, patch, remove } from '../model/ops'
import { gestureStep, type EditorStore } from '../store'

export interface Port {
  postMessage(m: unknown): void
  terminate(): void
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: (() => void) | null
}
/** Starts a worker from its script text. A blob worker: a worker must be same-origin, so it can't load from refig-plugin://. It keeps the app's CSP (no network). */
export type Spawn = (code: string) => Port
const spawnWorker: Spawn = (code) => {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const w = new Worker(url)
  URL.revokeObjectURL(url)
  return w as unknown as Port
}

export const MAX_CREATES = 1000
const IDLE_MS = 30_000
const TYPES: NodeType[] = ['RECTANGLE', 'ELLIPSE', 'FRAME', 'TEXT']
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const str = (max: number) => (v: unknown) => typeof v === 'string' && v.length <= max
/** The only node fields a plugin may set, each checked. Anything else (id, type, parentId, order, paths…) is refused. */
const FIELDS: Record<string, (v: unknown) => boolean> = {
  name: str(200), characters: str(100_000), fontFamily: str(100),
  visible: (v) => typeof v === 'boolean', locked: (v) => typeof v === 'boolean',
  x: num, y: num, rotation: num, strokeWeight: (v) => num(v) && (v as number) >= 0, cornerRadius: (v) => num(v) && (v as number) >= 0,
  width: (v) => num(v) && (v as number) >= 0, height: (v) => num(v) && (v as number) >= 0,
  opacity: (v) => num(v) && (v as number) >= 0 && (v as number) <= 1,
  fontSize: (v) => num(v) && (v as number) > 0, fontWeight: (v) => num(v) && (v as number) >= 1 && (v as number) <= 1000,
}
const channel = (v: unknown) => num(v) && (v as number) >= 0 && (v as number) <= 1
/** fills/strokes: solid colours only, given as [{r,g,b,a?}] with channels 0..1. */
function paints(v: unknown) {
  if (!Array.isArray(v) || v.length > 20) throw new Error('paints must be an array of up to 20 colours')
  return v.map((c) => {
    if (!channel(c?.r) || !channel(c?.g) || !channel(c?.b) || (c.a !== undefined && !channel(c.a))) throw new Error('colour channels must be numbers from 0 to 1')
    return solid(c.r, c.g, c.b, c.a ?? 1)
  })
}
function props(v: unknown): Partial<Node> {
  if (typeof v !== 'object' || !v || Array.isArray(v)) throw new Error('props must be an object')
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'fills' || k === 'strokes') out[k] = paints(val)
    else if (FIELDS[k]?.(val)) out[k] = val
    else throw new Error(`Cannot set "${k}"`)
  }
  return out as Partial<Node>
}

export interface Session {
  /** Called by PluginUI with its iframe (or null on unmount). */
  attachUI(frame: HTMLIFrameElement | null): void
  /** A message from the UI iframe; PluginUI has already checked its source. */
  fromUI(msg: unknown): void
  stop(): void
}

export function runPlugin(store: EditorStore, info: PluginInfo, command: string, spawn: Spawn = spawnWorker): Session {
  stopPlugin(store)
  const step = gestureStep(`plugin:${info.id}`)
  const base = `refig-plugin://${info.id}/`
  let frame: HTMLIFrameElement | null = null, creates = 0, idle: ReturnType<typeof setTimeout>, stopped = false
  let port: Port | undefined // set once the code has been read

  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(idle)
    port?.terminate()
    if (store.get().plugin?.id === info.id) store.set({ plugin: null })
    if (sessions.get(store) === session) sessions.delete(store)
  }
  const touch = () => {
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE_MS)
  }
  const live = (id: unknown): string => {
    if (typeof id !== 'string' || !store.get().doc.nodes[id]) throw new Error('No such node')
    return id
  }
  const ids = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length > 10_000) throw new Error('ids must be an array')
    return v.map(live)
  }
  const plain = (n: Node) => JSON.parse(JSON.stringify(n)) as Node

  const methods: Record<string, (...a: unknown[]) => unknown> = {
    getSelection: () => store.get().selection.map((i) => plain(store.get().doc.nodes[i])),
    getNode: (i) => plain(store.get().doc.nodes[live(i)]),
    getChildren: (i) => childrenOf(store.get().doc, live(i)).map(plain),
    setSelection: (v) => void store.set({ selection: ids(v) }),
    createNode(type, p, parent) {
      if (!TYPES.includes(type as NodeType)) throw new Error(`type must be one of ${TYPES.join(', ')}`)
      if (++creates > MAX_CREATES) throw new Error('Too many nodes created by one plugin run')
      const s = store.get(), into = parent === undefined ? s.pageId : live(parent)
      if (!isContainer(s.doc.nodes[into])) throw new Error('parent cannot hold children')
      const node = makeNode(type as NodeType, { ...props(p ?? {}) })
      if (!(p as { name?: unknown } | undefined)?.name) node.name = nextName(s.doc, node.name)
      store.update((d) => insert(d, node, into), step)
      return node.id
    },
    updateNode: (i, p) => void store.update((d) => patch(d, [live(i)], props(p)), step),
    removeNodes: (v) => void store.update((d) => remove(d, ids(v)), step),
    notify: (t) => void store.set({ toast: String(t).slice(0, 200) }),
    showUI(size) {
      if (!info.ui) throw new Error('This plugin has no UI')
      const { width, height } = (size ?? {}) as { width?: unknown; height?: unknown }
      const clamp = (v: unknown, d: number) => (num(v) ? Math.min(Math.max(v as number, 120), 800) : d)
      store.set({ plugin: { id: info.id, name: info.name, ui: { src: base + info.ui, w: clamp(width, 320), h: clamp(height, 240) } } })
    },
    postToUI: (m) => void frame?.contentWindow?.postMessage(m, '*'),
    closePlugin: () => {}, // dispatch stops the plugin once it has replied
  }

  async function dispatch(m: { id?: unknown; method?: unknown; args?: unknown }) {
    if (typeof m?.id !== 'number' || typeof m.method !== 'string') return
    touch()
    try {
      const fn = Object.hasOwn(methods, m.method) ? methods[m.method] : null
      if (!fn) throw new Error(`Unknown method "${m.method}"`)
      const result = await fn(...(Array.isArray(m.args) ? m.args : []))
      if (!stopped) port?.postMessage({ type: 'reply', id: m.id, result })
      if (m.method === 'closePlugin') stop()
    } catch (e) {
      if (!stopped) port?.postMessage({ type: 'reply', id: m.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  const session: Session = {
    attachUI: (f) => void (frame = f),
    fromUI: (msg) => (touch(), port?.postMessage({ type: 'ui', msg })),
    stop,
  }
  sessions.set(store, session)
  store.set({ plugin: { id: info.id, name: info.name, ui: null } })
  touch()
  const fail = () => {
    if (stopped) return
    store.set({ toast: `Plugin "${info.name}" failed` })
    stop()
  }
  store.api.readPluginCode(info.id).then((code) => {
    if (stopped) return
    port = spawn(code)
    port.onmessage = (e) => void dispatch(e.data as never)
    port.onerror = fail
    port.postMessage({ type: 'run', command })
  }).catch(fail)
  return session
}

/** Rescans the plugins folder into the store (editor open, palette open, menu open). */
export const refreshPlugins = (store: EditorStore) => store.api.listPlugins().then((plugins) => store.set({ plugins }), () => {})

const sessions = new WeakMap<EditorStore, Session>()
export const currentSession = (store: EditorStore) => sessions.get(store)
export const stopPlugin = (store: EditorStore) => currentSession(store)?.stop()
