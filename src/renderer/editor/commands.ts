// Every editor command in one table. The main menu, the toolbar and the keyboard handler all read from it,
// so a menu item can't exist without doing something.
import { makeNode, type Node } from '../../shared/document'
import { fitView, toWorld, zoomAt } from './canvas/viewport'
import { apply, worldBox, worldMatrix, worldRotation, type Pt } from './model/geometry'
import { addAutoLayout, align, childrenOf, cloneTree, distribute, descendants, duplicate, group, nextName, pageOf, patch, put, remove, reorder, topLevel, translate, ungroup } from './model/ops'
import { orderBetween } from '../../shared/order'
import { addVariant, combineAsVariants, detach, makeComponent, resetOverrides, setOf, variantsOf } from './model/components'
import type { EditorState, EditorStore, Tool } from './store'

/** Things only the Editor component can do. */
export interface Actions { back(): void; openExport(): void }
export interface Command {
  id: string
  label: string
  group: 'File' | 'Edit' | 'View' | 'Object' | 'Arrange' | 'Tools'
  keys?: string[] // first one is shown in menus
  enabled?(s: EditorState, store: EditorStore): boolean
  run(store: EditorStore, actions: Actions): void
}

// In-app clipboard: survives switching projects within a session.
let clipboard: { roots: { node: Node; centre: Pt; rotation: number }[]; nodes: Node[]; images: Map<string, Uint8Array> } | null = null

export function copy(store: EditorStore) {
  const { doc, selection } = store.get(), ids = topLevel(doc, selection)
  if (!ids.length) return
  const nodes = ids.flatMap((id) => [doc.nodes[id], ...descendants(doc, id)])
  const images = new Map<string, Uint8Array>()
  for (const n of nodes) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE' && store.imageBytes(p.hash)) images.set(p.hash, store.imageBytes(p.hash)!)
  clipboard = {
    nodes, images,
    roots: ids.map((id) => ({ node: doc.nodes[id], centre: apply(worldMatrix(doc, id), { x: doc.nodes[id].width / 2, y: doc.nodes[id].height / 2 }), rotation: worldRotation(doc, id) })),
  }
}

/** Pastes into the original parent when it's on this page (same spot, on top); otherwise onto the page at the same page position. */
export async function paste(store: EditorStore) {
  const clip = clipboard
  if (!clip) return
  for (const [hash, bytes] of clip.images) if (!store.imageBytes(hash)) await store.addImage(bytes)
  const kids = (id: string) => clip.nodes.filter((n) => n.parentId === id)
  const created: string[] = []
  store.update((doc) => {
    const { pageId } = store.get()
    for (const root of clip.roots) {
      const home = root.node.parentId && doc.nodes[root.node.parentId] && pageOf(doc, root.node.parentId) === pageId
      const parentId = home ? root.node.parentId! : pageId
      const placed = home ? root.node : { ...root.node, x: root.centre.x - root.node.width / 2, y: root.centre.y - root.node.height / 2, rotation: root.rotation }
      const copies = cloneTree(placed, kids, parentId, orderBetween(childrenOf(doc, parentId).at(-1)?.order))
      doc = put(doc, copies)
      created.push(copies[0].id)
    }
    return doc
  }, undefined, created)
}

/** Places an image (from the system clipboard) as a rectangle with an image fill, centred in the viewport. */
export async function pasteImage(store: EditorStore, file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = await store.addImage(bytes)
  const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null
  const { view, size, pageId } = store.get(), width = bitmap?.width ?? 200, height = bitmap?.height ?? 200
  const c = toWorld(view, { x: size.w / 2, y: size.h / 2 })
  const node = makeNode('RECTANGLE', { name: nextName(store.get().doc, 'Image'), x: c.x - width / 2, y: c.y - height / 2, width, height, fills: [{ type: 'IMAGE', visible: true, hash }] })
  store.update((doc) => put(doc, [{ ...node, parentId: pageId, order: orderBetween(childrenOf(doc, pageId).at(-1)?.order) }]), undefined, [node.id])
}

const has = (s: EditorState) => s.selection.length > 0
const centre = (s: EditorState) => ({ x: s.size.w / 2, y: s.size.h / 2 })
const tool = (id: Tool, label: string, key: string): Command => ({ id: `tool-${id}`, label, group: 'Tools', keys: [key], run: (st) => st.set({ tool: id }) })
const toggle = (field: 'visible' | 'locked') => (st: EditorStore) => {
  const { doc, selection } = st.get(), all = selection.every((id) => doc.nodes[id]?.[field])
  st.update((d) => patch(d, selection, { [field]: !all }))
}
const alignment = (id: string, label: string, key: string, axis: 'x' | 'y', to: 0 | 0.5 | 1): Command =>
  ({ id, label, group: 'Arrange', keys: [key], enabled: has, run: (st) => st.update((d) => align(d, st.get().selection, axis, to)) })
/** Zoom to fit the whole page (never past 100 % on open, any zoom on request). */
export const zoomToFit = (st: EditorStore, maxZoom?: number) => {
  const s = st.get()
  st.set({ view: fitView(worldBox(s.doc, childrenOf(s.doc, s.pageId).map((n) => n.id)), s.size, 48, maxZoom) })
}

export const COMMANDS: Command[] = [
  { id: 'back', label: 'Back to projects', group: 'File', run: (_, a) => a.back() },
  { id: 'save', label: 'Save', group: 'File', keys: ['Ctrl+S'], run: (st) => void st.save() },
  { id: 'export', label: 'Export…', group: 'File', keys: ['Ctrl+Shift+E'], enabled: has, run: (_, a) => a.openExport() },

  { id: 'undo', label: 'Undo', group: 'Edit', keys: ['Ctrl+Z'], enabled: (_, st) => st.canUndo(), run: (st) => st.undo() },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: (_, st) => st.canRedo(), run: (st) => st.redo() },
  { id: 'cut', label: 'Cut', group: 'Edit', keys: ['Ctrl+X'], enabled: has, run: (st) => { copy(st); st.update((d) => remove(d, st.get().selection)) } },
  { id: 'copy', label: 'Copy', group: 'Edit', keys: ['Ctrl+C'], enabled: has, run: copy },
  // Ctrl+V itself arrives as a DOM paste event (so images on the system clipboard can be read); see Editor.
  { id: 'paste', label: 'Paste', group: 'Edit', keys: ['Ctrl+V'], enabled: () => clipboard !== null, run: (st) => void paste(st) },
  { id: 'duplicate', label: 'Duplicate', group: 'Edit', keys: ['Ctrl+D'], enabled: has, run: (st) => { let ids: string[] = []; st.update((d) => { const r = duplicate(d, st.get().selection); ids = r.ids; return r.doc }); st.set({ selection: ids }) } },
  { id: 'delete', label: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], enabled: has, run: (st) => st.update((d) => remove(d, st.get().selection)) },
  { id: 'select-all', label: 'Select all', group: 'Edit', keys: ['Ctrl+A'], run: (st) => { const s = st.get(); st.set({ selection: childrenOf(s.doc, s.pageId).filter((n) => n.visible && !n.locked).map((n) => n.id) }) } },

  { id: 'zoom-in', label: 'Zoom in', group: 'View', keys: ['Ctrl+='], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), s.view.zoom * 2) }) } },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', keys: ['Ctrl+-'], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), s.view.zoom / 2) }) } },
  { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', keys: ['Ctrl+0'], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), 1) }) } },
  { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', keys: ['Shift+1'], run: (st) => zoomToFit(st) },
  { id: 'zoom-selection', label: 'Zoom to selection', group: 'View', keys: ['Shift+2'], enabled: has, run: (st) => { const s = st.get(); st.set({ view: fitView(worldBox(s.doc, s.selection), s.size) }) } },
  { id: 'toggle-ui', label: 'Show/Hide UI', group: 'View', keys: ['Ctrl+\\'], run: (st) => st.set({ uiHidden: !st.get().uiHidden }) },

  { id: 'group', label: 'Group selection', group: 'Object', keys: ['Ctrl+G'], enabled: has, run: (st) => wrap(st, 'GROUP') },
  { id: 'ungroup', label: 'Ungroup', group: 'Object', keys: ['Ctrl+Shift+G'], enabled: (s) => s.selection.some((id) => ['GROUP', 'FRAME'].includes(s.doc.nodes[id]?.type)), run: (st) => { let ids: string[] = []; st.update((d) => { const r = ungroup(d, st.get().selection); ids = r.ids; return r.doc }); if (ids.length) st.set({ selection: ids }) } },
  { id: 'frame-selection', label: 'Frame selection', group: 'Object', keys: ['Ctrl+Alt+G'], enabled: has, run: (st) => wrap(st, 'FRAME') },
  { id: 'add-auto-layout', label: 'Add auto layout', group: 'Object', keys: ['Shift+A'], enabled: has, run: addLayout },
  { id: 'remove-auto-layout', label: 'Remove auto layout', group: 'Object', keys: ['Alt+Shift+A'], enabled: (s) => s.selection.some((id) => s.doc.nodes[id]?.layout), run: (st) => st.update((d) => patch(d, st.get().selection.filter((id) => d.nodes[id]?.layout), { layout: undefined })) },
  { id: 'create-component', label: 'Create component', group: 'Object', keys: ['Ctrl+Alt+K'], enabled: has, run: createComponent },
  { id: 'create-instance', label: 'Create instance', group: 'Object', enabled: (s) => !!lone(s)?.component || (!!lone(s)?.componentSet && variantsOf(s.doc, lone(s)!.id).length > 0), run: createInstance },
  { id: 'combine-variants', label: 'Combine as variants', group: 'Object', enabled: (s) => s.selection.length > 0 && s.selection.every((id) => s.doc.nodes[id]?.component && !setOf(s.doc, id)), run: (st) => { let id: string | null = null; st.update((d) => { const r = combineAsVariants(d, st.get().selection); id = r.id; return r.doc }); if (id) st.set({ selection: [id] }) } },
  { id: 'add-variant', label: 'Add variant', group: 'Object', enabled: (s) => !!setSelected(s), run: (st) => { let id: string | null = null; st.update((d) => { const r = addVariant(d, setSelected(st.get())!.id); id = r.id; return r.doc }); if (id) st.set({ selection: [id] }) } },
  { id: 'go-to-main', label: 'Go to main component', group: 'Object', enabled: (s) => !!s.doc.nodes[lone(s)?.instanceOf ?? ''], run: goToMain },
  { id: 'reset-instance', label: 'Reset overrides', group: 'Object', enabled: (s) => !!lone(s)?.instanceOf, run: (st) => st.update((d) => resetOverrides(d, st.get().selection[0])) },
  { id: 'detach-instance', label: 'Detach instance', group: 'Object', keys: ['Ctrl+Alt+B'], enabled: (s) => s.selection.some((id) => s.doc.nodes[id]?.instanceOf), run: (st) => st.update((d) => st.get().selection.filter((id) => d.nodes[id]?.instanceOf).reduce(detach, d)) },
  { id: 'toggle-visible', label: 'Show/Hide selection', group: 'Object', keys: ['Ctrl+Shift+H'], enabled: has, run: toggle('visible') },
  { id: 'toggle-lock', label: 'Lock/Unlock selection', group: 'Object', keys: ['Ctrl+Shift+L'], enabled: has, run: toggle('locked') },

  { id: 'bring-forward', label: 'Bring forward', group: 'Arrange', keys: [']'], enabled: has, run: (st) => st.update((d) => reorder(d, st.get().selection, 'forward')) },
  { id: 'send-backward', label: 'Send backward', group: 'Arrange', keys: ['['], enabled: has, run: (st) => st.update((d) => reorder(d, st.get().selection, 'backward')) },
  { id: 'bring-front', label: 'Bring to front', group: 'Arrange', keys: ['Ctrl+]'], enabled: has, run: (st) => st.update((d) => reorder(d, st.get().selection, 'front')) },
  { id: 'send-back', label: 'Send to back', group: 'Arrange', keys: ['Ctrl+['], enabled: has, run: (st) => st.update((d) => reorder(d, st.get().selection, 'back')) },
  alignment('align-left', 'Align left', 'Alt+A', 'x', 0), alignment('align-hcenter', 'Align horizontal centres', 'Alt+H', 'x', 0.5), alignment('align-right', 'Align right', 'Alt+D', 'x', 1),
  alignment('align-top', 'Align top', 'Alt+W', 'y', 0), alignment('align-vcenter', 'Align vertical centres', 'Alt+V', 'y', 0.5), alignment('align-bottom', 'Align bottom', 'Alt+S', 'y', 1),
  { id: 'distribute-h', label: 'Distribute horizontal spacing', group: 'Arrange', keys: ['Ctrl+Alt+H'], enabled: (s) => topLevel(s.doc, s.selection).length > 2, run: (st) => st.update((d) => distribute(d, st.get().selection, 'x')) },
  { id: 'distribute-v', label: 'Distribute vertical spacing', group: 'Arrange', keys: ['Ctrl+Alt+V'], enabled: (s) => topLevel(s.doc, s.selection).length > 2, run: (st) => st.update((d) => distribute(d, st.get().selection, 'y')) },

  tool('move', 'Move', 'V'), tool('hand', 'Hand', 'H'), tool('frame', 'Frame', 'F'), tool('rectangle', 'Rectangle', 'R'),
  tool('ellipse', 'Ellipse', 'O'), tool('line', 'Line', 'L'), tool('text', 'Text', 'T'),
  { id: 'escape', label: 'Deselect', group: 'Tools', keys: ['Escape'], run: (st) => st.set({ selection: [], tool: 'move' }) },
  { id: 'edit-text', label: 'Edit text', group: 'Tools', keys: ['Enter'], enabled: (s) => s.selection.length === 1 && s.doc.nodes[s.selection[0]]?.type === 'TEXT', run: (st) => st.set({ editingText: st.get().selection[0] }) },
]

function wrap(st: EditorStore, type: 'GROUP' | 'FRAME') {
  let id: string | null = null
  st.update((d) => {
    const r = group(d, st.get().selection, type)
    id = r.id
    return r.doc
  })
  if (id) st.set({ selection: [id] })
}

const lone = (s: EditorState) => (s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined)

/** A lone frame becomes a component; anything else is wrapped in a new frame first. */
function createComponent(st: EditorStore) {
  const { doc, selection } = st.get(), ids = topLevel(doc, selection), only = ids.length === 1 ? doc.nodes[ids[0]] : null
  if (only?.type === 'FRAME' && !only.component && !only.instanceOf) return st.update((d) => makeComponent(d, only.id))
  let id: string | null = null
  st.update((d) => {
    const r = group(d, ids, 'FRAME')
    id = r.id
    return id ? makeComponent(r.doc, id) : d
  })
  if (id) st.set({ selection: [id] })
}
/** Places an instance of the selected main component just to its right. */
/** Places an instance of the selected main component (a set's first variant for a set) just right of it, or of its set. */
function createInstance(st: EditorStore) {
  const { doc } = st.get(), picked = lone(st.get())!
  const main = picked.componentSet ? variantsOf(doc, picked.id)[0] : picked, at = setOf(doc, main.id) ?? main
  const node = makeNode('FRAME', { name: at.name, instanceOf: main.id, x: at.x + at.width + 40, y: at.y, width: main.width, height: main.height, rotation: at.rotation })
  st.update((d) => put(d, [{ ...node, parentId: at.parentId, order: orderBetween(at.order, childrenOf(d, at.parentId!).find((k) => k.order > at.order)?.order) }]), undefined, [node.id])
}
const setSelected = (s: EditorState) => { const n = lone(s); return n?.componentSet ? n : n && setOf(s.doc, n.id) }
function goToMain(st: EditorStore) {
  const { doc } = st.get(), main = doc.nodes[lone(st.get())!.instanceOf!]
  st.set({ pageId: pageOf(doc, main.id)!, selection: [main.id] })
  const s = st.get()
  st.set({ view: fitView(worldBox(s.doc, [main.id]), s.size) })
}

/** A single frame gets auto layout; anything else is wrapped in a new auto-layout frame first. */
function addLayout(st: EditorStore) {
  const { doc, selection } = st.get(), ids = topLevel(doc, selection), only = ids.length === 1 ? doc.nodes[ids[0]] : null
  if (only?.type === 'FRAME' && !only.layout) return st.update((d) => addAutoLayout(d, only.id))
  let id: string | null = null
  st.update((d) => {
    const r = group(d, ids, 'FRAME')
    id = r.id
    return id ? addAutoLayout(r.doc, id) : d
  })
  if (id) st.set({ selection: [id] })
}

export const isEnabled = (c: Command, store: EditorStore) => !c.enabled || c.enabled(store.get(), store)

const CODES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-' }
/** "Ctrl+Shift+G" for a key event. Digits and punctuation go by physical key so they work on any layout; letters by what they type. */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const k = /^Digit\d$/.test(e.code) ? e.code[5] : (CODES[e.code] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key))
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+')
}

/** Runs the command bound to a key event. Returns true if the event was handled. */
export function handleKey(e: KeyboardEvent, store: EditorStore, actions: Actions): boolean {
  const key = keyOf(e), s = store.get()
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key.replace('Shift+', '')]
  if (arrow && s.selection.length) {
    const step = e.shiftKey ? 10 : 1, ids = topLevel(s.doc, s.selection).filter((id) => !s.doc.nodes[id].locked)
    store.update((d) => translate(d, ids, { x: arrow[0] * step, y: arrow[1] * step }), 'nudge')
    return true
  }
  const cmd = COMMANDS.find((c) => c.keys?.includes(key))
  if (!cmd || cmd.id === 'paste') return false
  if (!isEnabled(cmd, store)) return false
  cmd.run(store, actions)
  return true
}
