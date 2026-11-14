// Editor state for one open project: document, selection, view, undo history, images and autosave.
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { OpenedProject, RefigApi } from '../../shared/api'
import type { Document, RunStyle } from '../../shared/document'
import { errorText } from '../util'
import { thumbnail } from './canvas/render'
import type { Guides } from './canvas/snap'
import type { View } from './canvas/viewport'
import type { Box } from './model/geometry'
import type { Edit } from './model/ops'
import { normalize } from './normalize'
import type { Anchor } from './model/path'

export type Tool = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'star' | 'polygon' | 'pen' | 'pencil' | 'text'
/**
 * What a node is being edited as, if anything: its characters (text), a path being drawn (pen; its points live here,
 * in parent coordinates, because path data can't hold the last point's outgoing handle until the next segment
 * exists), or a VECTOR's points (sel = subpath, anchor). A mode ends when its node goes away.
 */
export type Mode =
  | { kind: 'none' }
  | { kind: 'text'; id: string; anchor: number; focus: number; goalX?: number; pending?: RunStyle } // selection as indices into characters; pending: a style chosen at a bare caret for what is typed next
  | { kind: 'pen'; id: string; anchors: Anchor[] }
  | { kind: 'points'; id: string; sel: { s: number; i: number } | null }
  | { kind: 'crop'; id: string; paint: number } // moving and scaling the image of the node's `paint`th fill (scaleMode CROP)
export const NO_MODE: Mode = { kind: 'none' }
export interface EditorState {
  name: string
  doc: Document
  pageId: string
  selection: string[]
  tool: Tool
  view: View
  size: { w: number; h: number } // canvas viewport in CSS px
  mode: Mode
  overlay: { marquee?: Box; guides?: Guides }
  save: 'saved' | 'dirty' | 'saving' | 'error'
  saveError?: string
  uiHidden: boolean
  tick: number // bumped when an image finishes decoding
}
type Snapshot = Pick<EditorState, 'doc' | 'pageId' | 'selection'>
/**
 * The undo step an edit belongs to. Consecutive edits with the same key share one step: always for a gesture
 * (it rebuilds from where it started each frame), within a second otherwise (typing a value, nudging).
 */
export type Step = { key: string; gesture?: boolean }
let gestures = 0
/** A fresh step for one pointer gesture, or a named one (`of`) that a later edit can join. */
export const gestureStep = (of?: string): Step => ({ key: `gesture:${of ?? ++gestures}`, gesture: true })

export const AUTOSAVE_MS = 1000
const RETRY_MS = 5000
const HISTORY = 200

export function createEditorStore(opened: OpenedProject, api: RefigApi) {
  const id = opened.summary.id
  let state: EditorState = {
    name: opened.summary.name, doc: opened.document, pageId: opened.document.pages[0], selection: [], tool: 'move',
    view: { x: 0, y: 0, zoom: 1 }, size: { w: 0, h: 0 }, mode: NO_MODE, overlay: {}, save: 'saved', uiHidden: false, tick: 0,
  }
  const listeners = new Set<() => void>()
  const past: Snapshot[] = [], future: Snapshot[] = []
  let lastStep: Step | undefined, lastAt = 0
  let dirty = false, disposed = false, timer: ReturnType<typeof setTimeout> | undefined, inflight: Promise<boolean> | null = null
  const bytes = new Map<string, Uint8Array>(), bitmaps = new Map<string, ImageBitmap>()

  const get = () => state
  const set = (p: Partial<EditorState>) => {
    state = { ...state, ...p }
    listeners.forEach((l) => l())
  }
  const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
  const snapshot = (): Snapshot => ({ doc: state.doc, pageId: state.pageId, selection: state.selection })

  function register(hash: string, data: Uint8Array) {
    bytes.set(hash, data)
    if (typeof createImageBitmap !== 'function') return
    createImageBitmap(new Blob([data as BlobPart])).then((b) => (bitmaps.set(hash, b), set({ tick: state.tick + 1 })), () => {})
  }
  for (const [hash, data] of Object.entries(opened.images)) register(hash, data)

  function commit(doc: Document, p: Partial<EditorState> = {}) {
    const pageId = doc.nodes[p.pageId ?? state.pageId] ? (p.pageId ?? state.pageId) : doc.pages[0]
    const mode = p.mode ?? state.mode
    set({ ...p, doc, pageId, selection: (p.selection ?? state.selection).filter((i) => doc.nodes[i]), mode: 'id' in mode && !doc.nodes[mode.id] ? NO_MODE : mode })
    dirty = true
    if (state.save !== 'saving') set({ save: 'dirty' })
    clearTimeout(timer)
    timer = setTimeout(() => void save(), AUTOSAVE_MS)
  }

  /** Applies an edit and records an undo step (see Step). An edit that returns ids selects them (when there are any). */
  function update(fn: (doc: Document) => Document | Edit, step?: Step) {
    const now = Date.now(), joins = !!step && step.key === lastStep?.key && (!!step.gesture || now - lastAt < 1000)
    const out = fn(state.doc), [next, ids] = 'doc' in out ? [out.doc, out.ids] : [out, []]
    const select = ids.length ? ids : undefined
    // A gesture recomputes each frame from the document it started on, so the step's start is the true "before".
    const doc = normalize(state.doc, next, joins ? (past.at(-1)?.doc ?? state.doc) : state.doc)
    if (doc === state.doc) return select && set({ selection: select })
    if (!joins) {
      past.push(snapshot())
      if (past.length > HISTORY) past.shift()
    }
    future.length = 0
    lastStep = step
    lastAt = now
    commit(doc, select ? { selection: select } : {})
  }
  function travel(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop()
    if (!s) return
    to.push(snapshot())
    lastStep = undefined
    commit(s.doc, { pageId: s.pageId, selection: s.selection, mode: NO_MODE }) // a mode's state may not match the restored document
  }

  /** Saves now if there are unsaved changes. Resolves false if the save failed (the document stays in memory and is retried). */
  function save(): Promise<boolean> {
    clearTimeout(timer)
    if (inflight) return inflight.then(() => (dirty ? save() : state.save !== 'error'))
    if (!dirty) return Promise.resolve(true)
    dirty = false
    set({ save: 'saving', saveError: undefined })
    let thumb: Uint8Array | undefined
    try {
      thumb = thumbnail(state.doc, state.doc.pages[0], (h) => bitmaps.get(h))
    } catch {
      // a thumbnail is optional; never let it block a save
    }
    inflight = api.saveProject(id, state.doc, thumb).then(
      () => {
        inflight = null
        set({ save: dirty ? 'dirty' : 'saved' })
        return true
      },
      (e) => {
        inflight = null
        dirty = true
        set({ save: 'error', saveError: errorText(e) })
        if (!disposed) timer = setTimeout(() => void save(), RETRY_MS)
        return false
      },
    )
    return inflight
  }

  return {
    id, api, get, set, subscribe, update, save,
    undo: () => travel(past, future),
    redo: () => travel(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    image: (hash: string) => bitmaps.get(hash),
    imageBytes: (hash: string) => bytes.get(hash),
    /** Stores image bytes with the project and returns their hash. */
    async addImage(data: Uint8Array): Promise<string> {
      const hash = await api.addImage(id, data)
      register(hash, data)
      return hash
    },
    isDirty: () => dirty || inflight !== null,
    attach: () => void (disposed = false),
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
export type EditorStore = ReturnType<typeof createEditorStore>

export const EditorContext = createContext<EditorStore | null>(null)
export function useStore(): EditorStore {
  const store = useContext(EditorContext)
  if (!store) throw new Error('No editor store')
  return store
}
/** Subscribes to a slice of editor state. The selector must return a stable value (a state field or a primitive). */
export function useEditor<T>(select: (s: EditorState) => T): T {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}
