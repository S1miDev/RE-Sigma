// Editing the characters of a TEXT node: selection, typing, deleting, caret keys, per-range styles and mouse selection.
// The caret lives in the store's text Mode (indices into `characters`); the document changes live, in one undo step per node.
import type { RunStyle } from '../../../shared/document'
import { caretPos, indexAt, lineBounds, wordAt } from '../canvas/caret'
import { layoutText } from '../canvas/text'
import { apply, invert, worldMatrix, type Pt } from '../model/geometry'
import { patch, remove } from '../model/ops'
import { commonStyle, splice, styleAt, styleRange } from '../model/richText'
import { gestureStep, NO_MODE, type EditorStore, type Mode } from '../store'
import { dist, type Gesture, type Pointer } from './pointer'

type TextMode = Extract<Mode, { kind: 'text' }>
/** The step of everything typed into a node: it joins the step that created the node, and consecutive edits of one node are one step. */
export const textStep = (id: string) => gestureStep(`text-${id}`)

/** A text mode with the whole text selected (or just a caret in an empty one). */
export const textMode = (id: string, length: number): TextMode => ({ kind: 'text', id, anchor: 0, focus: length })

function current(store: EditorStore) {
  const { mode, doc } = store.get()
  const n = mode.kind === 'text' ? doc.nodes[mode.id] : undefined
  return mode.kind === 'text' && n?.type === 'TEXT' ? { mode, n } : null
}
const bounds = (m: TextMode): [number, number] => [Math.min(m.anchor, m.focus), Math.max(m.anchor, m.focus)]

/** Moves the selection. A pending style is dropped, as the caret no longer sits where it was chosen. */
export function select(store: EditorStore, anchor: number, focus: number, goalX?: number) {
  const c = current(store)
  if (c) store.set({ mode: { kind: 'text', id: c.mode.id, anchor, focus, ...(goalX !== undefined && { goalX }) } })
}

export const selectedText = (store: EditorStore) => {
  const c = current(store)
  if (!c) return ''
  const [a, b] = bounds(c.mode)
  return (c.n.characters ?? '').slice(a, b)
}

/** Replaces the selection with `text`, which takes the style typed with (the previous character's, plus any pending change). */
export function insertText(store: EditorStore, text: string) {
  const c = current(store)
  if (!c) return
  const { mode, n } = c, [a, b] = bounds(mode)
  if (a === b && !text) return
  const inherit = mode.pending ? { ...styleAt(n, Math.max(0, a - 1)), ...mode.pending } : undefined
  const out = splice(n, a, b, text, inherit)
  // The layer is named after its text until the user renames it.
  const old = n.characters ?? '', named = n.name === 'Text' || n.name === old.split('\n')[0].slice(0, 40)
  store.update((d) => patch(d, [n.id], { characters: out.characters, runs: out.runs.length ? out.runs : undefined, ...(named && out.characters && { name: out.characters.split('\n')[0].slice(0, 40) }) }), textStep(n.id))
  select(store, a + text.length, a + text.length)
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\t'
const prev = (t: string, i: number) => (i >= 2 && /[\uDC00-\uDFFF]/.test(t[i - 1]) && /[\uD800-\uDBFF]/.test(t[i - 2]) ? i - 2 : Math.max(0, i - 1))
const next = (t: string, i: number) => (i + 1 < t.length && /[\uD800-\uDBFF]/.test(t[i]) && /[\uDC00-\uDFFF]/.test(t[i + 1]) ? i + 2 : Math.min(t.length, i + 1))
function wordLeft(t: string, i: number) {
  while (i > 0 && isSpace(t[i - 1])) i--
  return i === 0 ? 0 : t[i - 1] === '\n' ? i - 1 : wordAt(t, i - 1)[0]
}
function wordRight(t: string, i: number) {
  if (i >= t.length) return i
  if (t[i] === '\n') return i + 1
  let j = Math.max(wordAt(t, i)[1], i + 1)
  while (isSpace(t[j])) j++
  return j
}

export interface KeyEvent { key: string; ctrl: boolean; shift: boolean }

/** The style of the selection for `key` ("mixed" is null), counting a pending change at a collapsed caret. */
export function styleValue<K extends keyof RunStyle>(mode: TextMode, n: Parameters<typeof commonStyle>[0], key: K): RunStyle[K] | null {
  const [a, b] = bounds(mode)
  if (a === b && mode.pending && key in mode.pending) return (mode.pending[key] ?? (n as unknown as RunStyle)[key]) as RunStyle[K]
  return commonStyle(n, a, b, key)
}

/**
 * Applies a style to the selected range, or to what is typed next when only a caret is there.
 * False when no text is being edited (the caller then styles the whole node).
 */
export function applyRunStyle(store: EditorStore, change: RunStyle): boolean {
  const c = current(store)
  if (!c) return false
  const { mode, n } = c, [a, b] = bounds(mode)
  if (a === b) store.set({ mode: { ...mode, pending: { ...mode.pending, ...change } } })
  else {
    const runs = styleRange(n, a, b, change)
    store.update((d) => patch(d, [n.id], { runs: runs.length ? runs : undefined }), { key: `text-style:${n.id}:${Object.keys(change).join()}` })
  }
  return true
}

function toggle(store: EditorStore, mode: TextMode, n: Parameters<typeof commonStyle>[0], on: RunStyle, off: RunStyle) {
  const key = Object.keys(on)[0] as keyof RunStyle
  applyRunStyle(store, styleValue(mode, n, key) === on[key] ? off : on)
}

/** Handles a key in the text editor. False when it is not an editing key (typing characters arrives as input events). */
export function textKey(store: EditorStore, e: KeyEvent): boolean {
  const c = current(store)
  if (!c) return false
  const { mode, n } = c, t = n.characters ?? '', [a, b] = bounds(mode), k = e.key, f = mode.focus
  const to = (i: number, goal?: number) => (select(store, e.shift ? mode.anchor : i, i, goal), true)
  const layout = () => layoutText(n, { editing: true })
  switch (k) {
    case 'ArrowLeft': return !e.shift && a !== b && !e.ctrl ? to(a) : to(e.ctrl ? wordLeft(t, f) : prev(t, f))
    case 'ArrowRight': return !e.shift && a !== b && !e.ctrl ? to(b) : to(e.ctrl ? wordRight(t, f) : next(t, f))
    case 'ArrowUp': case 'ArrowDown': {
      const lay = layout(), pos = caretPos(lay, f), goal = mode.goalX ?? pos.x, li = pos.line + (k === 'ArrowUp' ? -1 : 1)
      if (li < 0) return to(0, goal)
      if (li >= lay.lines.length) return to(t.length, goal)
      const l = lay.lines[li]
      return to(indexAt(lay, goal, l.top + l.height / 2), goal)
    }
    case 'Home': return to(e.ctrl ? 0 : lineBounds(layout(), f)[0])
    case 'End': return to(e.ctrl ? t.length : lineBounds(layout(), f)[1])
    case 'Backspace': case 'Delete': {
      if (a !== b) return insertText(store, ''), true
      const from = k === 'Backspace' ? (e.ctrl ? wordLeft(t, a) : prev(t, a)) : a, end = k === 'Backspace' ? a : e.ctrl ? wordRight(t, a) : next(t, a)
      if (from === end) return true
      select(store, from, end)
      return insertText(store, ''), true
    }
    case 'Enter': return insertText(store, '\n'), true
  }
  if (!e.ctrl) return false
  switch (k.toLowerCase()) {
    case 'a': return select(store, 0, t.length), true
    case 'b': return toggle(store, mode, n, { fontWeight: 700 }, { fontWeight: 400 }), true
    case 'i': return toggle(store, mode, n, { fontItalic: true }, { fontItalic: false }), true
    case 'u': return toggle(store, mode, n, { textDecoration: 'UNDERLINE' }, { textDecoration: 'NONE' }), true
  }
  return false
}

/** Leaves text editing. A text left empty is deleted. */
export function finishText(store: EditorStore, id: string) {
  const { mode } = store.get()
  if (mode.kind === 'text' && mode.id === id) store.set({ mode: NO_MODE })
  const now = store.get().doc.nodes[id]
  if (now && !now.characters) store.update((d) => remove(d, [id]), textStep(id))
}

const toLocal = (store: EditorStore, id: string, world: Pt) => apply(invert(worldMatrix(store.get().doc, id)), world)
/** Whether a point is on (or just around) the text being edited. */
export function onEditedText(store: EditorStore, world: Pt): boolean {
  const c = current(store)
  if (!c) return false
  const q = toLocal(store, c.n.id, world), tol = 4 / store.get().view.zoom
  return q.x >= -tol && q.y >= -tol && q.x <= c.n.width + tol && q.y <= c.n.height + tol
}

let last = { t: 0, x: 0, y: 0, n: 0 }
/** A press on the text being edited: places the caret, or selects a word (double click) or paragraph (triple); dragging extends. Null when the press is elsewhere. */
export function textPointer(store: EditorStore, p: Pointer): Gesture | null {
  const c = current(store)
  if (!c || !onEditedText(store, p.world)) return null
  const id = c.n.id, text = c.n.characters ?? ''
  const at = (w: Pt) => {
    const q = toLocal(store, id, w), n = store.get().doc.nodes[id]
    return n ? indexAt(layoutText(n, { editing: true }), q.x, q.y) : 0
  }
  const now = Date.now(), count = now - last.t < 400 && dist(last, p.screen) < 4 ? Math.min(3, last.n + 1) : 1
  last = { t: now, x: p.screen.x, y: p.screen.y, n: count }
  const i = at(p.world), anchor = p.shift ? c.mode.anchor : i
  if (count === 2) select(store, ...wordAt(text, i))
  else if (count === 3) select(store, text.lastIndexOf('\n', i - 1) + 1, text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i))
  else select(store, anchor, i)
  return { move: (q) => count === 1 && select(store, anchor, at(q.world)), up() {} }
}
