// Editor state for one open project: document, selection, view, undo history, images and autosave.
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { OpenedProject, RefigApi } from '../../shared/api'
import type { Document } from '../../shared/document'
import { errorText } from '../util'
import { thumbnail } from './canvas/render'
import type { Guides } from './canvas/snap'
import { fitText } from './canvas/text'
import type { View } from './canvas/viewport'
import type { Box } from './model/geometry'
import { syncInstances } from './model/components'
import { autoLayout, fitGroups, put } from './model/ops'

export type Tool = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'line' | 'text'
export interface EditorState {
  name: string
  doc: Document
  pageId: string
  selection: string[]
  tool: Tool
  view: View
  size: { w: number; h: number } // canvas viewport in CSS px
  editingText: string | null
  overlay: { marquee?: Box; guides?: Guides }
  save: 'saved' | 'dirty' | 'saving' | 'error'
  saveError?: string
  uiHidden: boolean
  tick: number // bumped when an image finishes decoding
}
type Snapshot = Pick<EditorState, 'doc' | 'pageId' | 'selection'>

export const AUTOSAVE_MS = 1000
const RETRY_MS = 5000
const HISTORY = 200

/** Re-measures text nodes changed since `prev`. */
function fitTexts(prev: Document, next: Document): Document {
  const refit = Object.values(next.nodes).filter((n) => n.type === 'TEXT' && prev.nodes[n.id] !== n).map(fitText).filter((n) => next.nodes[n.id] !== n)
  return refit.length ? put(next, refit) : next
}
/** Text boxes follow their content, groups wrap their children and auto-layout frames place theirs, whatever edit was made. */
function normalize(prev: Document, next: Document): Document {
  if (next === prev) return prev
  // instances sync first, while `next` still holds exactly what the user changed (their overrides)
  next = syncInstances(prev, next)
  // auto layout can change a text box's width (fill), so text is measured again and laid out once more
  return autoLayout(fitTexts(prev, autoLayout(fitGroups(fitTexts(prev, next)))))
}

export function createEditorStore(opened: OpenedProject, api: RefigApi) {
  const id = opened.summary.id
  let state: EditorState = {
    name: opened.summary.name, doc: opened.document, pageId: opened.document.pages[0], selection: [], tool: 'move',
    view: { x: 0, y: 0, zoom: 1 }, size: { w: 0, h: 0 }, editingText: null, overlay: {}, save: 'saved', uiHidden: false, tick: 0,
  }
  const listeners = new Set<() => void>()
  const past: Snapshot[] = [], future: Snapshot[] = []
  let lastTag: string | undefined, lastAt = 0
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
    const editingText = p.editingText !== undefined ? p.editingText : state.editingText
    set({ ...p, doc, pageId, selection: (p.selection ?? state.selection).filter((i) => doc.nodes[i]), editingText: editingText && doc.nodes[editingText] ? editingText : null })
    dirty = true
    if (state.save !== 'saving') set({ save: 'dirty' })
    clearTimeout(timer)
    timer = setTimeout(() => void save(), AUTOSAVE_MS)
  }

  /**
   * Applies an edit and records an undo step. Consecutive edits with the same `tag` share one step
   * (always for 'gesture…' tags, within a second otherwise). `select` replaces the selection.
   */
  function update(fn: (doc: Document) => Document, tag?: string, select?: string[]) {
    const doc = normalize(state.doc, fn(state.doc))
    if (doc === state.doc) return select && set({ selection: select })
    const now = Date.now()
    if (!(tag !== undefined && tag === lastTag && (tag.startsWith('gesture') || now - lastAt < 1000))) {
      past.push(snapshot())
      if (past.length > HISTORY) past.shift()
    }
    future.length = 0
    lastTag = tag
    lastAt = now
    commit(doc, select ? { selection: select } : {})
  }
  function travel(from: Snapshot[], to: Snapshot[]) {
    const s = from.pop()
    if (!s) return
    to.push(snapshot())
    lastTag = undefined
    commit(s.doc, { pageId: s.pageId, selection: s.selection, editingText: null })
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
