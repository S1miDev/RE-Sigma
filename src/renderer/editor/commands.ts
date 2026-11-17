// Every editor command in one table. The main menu, the toolbar and the keyboard handler all read from it,
// so a menu item can't exist without doing something.
import { isContainer, makeNode, type BoolOp, type Document, type Node } from '../../shared/document'
import { copy, copyProps, hasClipboard, hasProps, paste, pasteProps } from './clipboard'
import { fitView, zoomAt, zoomToFit } from './canvas/viewport'
import { worldBox } from './model/geometry'
import { canMask } from './canvas/paintPlan'
import { addAutoLayout, align, childrenOf, distribute, duplicate, group, orderAbove, pageOf, patch, put, remove, reorder, topLevel, translate, ungroup, type Edit } from './model/ops'
import { preloadFonts } from './fontFile'
import { errorText } from '../util'
import { flatten, makeBoolean } from './model/boolean'
import { presentFrom } from './model/prototype'
import { addVariant, combineAsVariants, detach, makeComponent, newInstance, resetOverrides, setOf, variantsOf } from './model/components'
import type { EditorState, EditorStore, Tool } from './store'
import { deletePoint, editNode, exitMode, setTool, showPage } from './tools'

/** Things only the Editor component can do. */
export interface Actions { back(): void; openExport(): void; placeImages(): void; openPalette(): void; openRename(): void; openFind(): void; openVersions(): void; openLibraries(): void }
export interface Command {
  id: string
  label: string
  group: 'File' | 'Edit' | 'View' | 'Object' | 'Arrange' | 'Tools' | 'Plugins'
  keys?: string[] // first one is shown in menus
  enabled?(s: EditorState, store: EditorStore): boolean
  run(store: EditorStore, actions: Actions): void
}

/**
 * Runs a boolean/flatten edit on the selection as it is now; if it contains text, its fonts are loaded first (outlining needs them),
 * otherwise it runs at once. Missing fonts and failures are shown as a toast.
 */
function withFonts(st: EditorStore, edit: (d: Document, selection: string[]) => Document | Edit) {
  const { doc, selection } = st.get(), texts: Node[] = []
  const walk = (id: string) => { const n = doc.nodes[id]; if (n?.type === 'TEXT') texts.push(n); else if (n) childrenOf(doc, id).forEach((c) => walk(c.id)) }
  selection.forEach(walk)
  if (!texts.length) return st.update((d) => edit(d, selection))
  preloadFonts(texts).then((warning) => {
    st.update((d) => edit(d, selection.filter((id) => d.nodes[id]))) // the selection may have changed (or nodes gone) while fonts loaded
    if (warning) st.set({ toast: warning })
  }).catch((e) => st.set({ toast: errorText(e) }))
}

const has = (s: EditorState) => s.selection.length > 0
const inMode = (s: EditorState) => s.mode.kind !== 'none'
const centre = (s: EditorState) => ({ x: s.size.w / 2, y: s.size.h / 2 })
const tool = (id: Tool, label: string, key: string): Command => ({ id: `tool-${id}`, label, group: 'Tools', keys: [key], run: (st) => setTool(st, id) })
/** Combines the selected shapes (two or more) into a live boolean node. */
const boolean = (id: string, label: string, key: string, op: BoolOp): Command =>
  ({ id, label, group: 'Object', keys: [key], enabled: (s) => topLevel(s.doc, s.selection).length > 1, run: (st) => withFonts(st, (d, sel) => makeBoolean(d, sel, op)) })
const toggle = (field: 'visible' | 'locked') => (st: EditorStore) => {
  const { doc, selection } = st.get(), all = selection.every((id) => doc.nodes[id]?.[field])
  st.update((d) => patch(d, selection, { [field]: !all }))
}
const alignment = (id: string, label: string, key: string, axis: 'x' | 'y', to: 0 | 0.5 | 1): Command =>
  ({ id, label, group: 'Arrange', keys: [key], enabled: has, run: (st) => st.update((d) => align(d, st.get().selection, axis, to)) })

export const COMMANDS: Command[] = [
  { id: 'back', label: 'Back to projects', group: 'File', run: (_, a) => a.back() },
  { id: 'save', label: 'Save', group: 'File', keys: ['Ctrl+S'], run: (st) => void st.save() },
  { id: 'versions', label: 'Version history…', group: 'File', run: (_, a) => a.openVersions() },
  { id: 'libraries', label: 'Libraries…', group: 'File', run: (_, a) => a.openLibraries() },
  { id: 'export', label: 'Export…', group: 'File', keys: ['Ctrl+Shift+E'], enabled: has, run: (_, a) => a.openExport() },
  { id: 'plugins-folder', label: 'Open plugins folder', group: 'Plugins', run: (st) => void st.api.openPluginsFolder() },
  { id: 'place-image', label: 'Place image…', group: 'File', keys: ['Ctrl+Shift+K'], run: (_, a) => a.placeImages() },

  { id: 'undo', label: 'Undo', group: 'Edit', keys: ['Ctrl+Z'], enabled: (_, st) => st.canUndo(), run: (st) => st.undo() },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: (_, st) => st.canRedo(), run: (st) => st.redo() },
  { id: 'cut', label: 'Cut', group: 'Edit', keys: ['Ctrl+X'], enabled: has, run: (st) => { copy(st); st.update((d) => remove(d, st.get().selection)) } },
  { id: 'copy', label: 'Copy', group: 'Edit', keys: ['Ctrl+C'], enabled: has, run: copy },
  // Ctrl+V itself arrives as a DOM paste event (so images on the system clipboard can be read); see Editor.
  { id: 'paste', label: 'Paste', group: 'Edit', keys: ['Ctrl+V'], enabled: hasClipboard, run: (st) => void paste(st) },
  { id: 'paste-into', label: 'Paste into selection', group: 'Edit', keys: ['Ctrl+Shift+V'], enabled: (s) => hasClipboard() && !!lone(s) && isContainer(lone(s)!), run: (st) => void paste(st, st.get().selection[0]) },
  { id: 'copy-properties', label: 'Copy properties', group: 'Edit', keys: ['Ctrl+Alt+C'], enabled: (s) => s.selection.length === 1, run: copyProps },
  // Figma's Ctrl+Alt+V is distribute-v here, hence the extra Shift
  { id: 'paste-properties', label: 'Paste properties', group: 'Edit', keys: ['Ctrl+Alt+Shift+V'], enabled: (s) => hasProps() && has(s), run: pasteProps },
  { id: 'rename-layers', label: 'Rename layers…', group: 'Edit', keys: ['Ctrl+F2'], enabled: has, run: (_, a) => a.openRename() },
  { id: 'find-replace', label: 'Find and replace…', group: 'Edit', keys: ['Ctrl+F'], run: (_, a) => a.openFind() },
  { id: 'duplicate', label: 'Duplicate', group: 'Edit', keys: ['Ctrl+D'], enabled: has, run: (st) => st.update((d) => duplicateBeside(d, st.get().selection)) },
  // while editing points, Delete removes the selected point rather than the layer
  { id: 'delete', label: 'Delete', group: 'Edit', keys: ['Delete', 'Backspace'], enabled: (s) => (s.mode.kind === 'points' ? !!s.mode.sel : has(s)), run: (st) => (st.get().mode.kind === 'points' ? deletePoint(st) : st.update((d) => remove(d, st.get().selection))) },
  // With a nested layer selected, Select all stays inside its parent; otherwise it takes the page's top-level layers.
  { id: 'select-all', label: 'Select all', group: 'Edit', keys: ['Ctrl+A'], run: (st) => { const s = st.get(), parent = s.doc.nodes[s.selection[0]]?.parentId ?? s.pageId; st.set({ selection: childrenOf(s.doc, parent).filter((n) => n.visible && !n.locked).map((n) => n.id) }) } },
  { id: 'select-parent', label: 'Select parent', group: 'Edit', keys: ['Shift+Enter'], enabled: (s) => s.selection.some((id) => !isTopLevel(s, id)),
    run: (st) => { const s = st.get(); st.set({ selection: [...new Set(s.selection.map((id) => (isTopLevel(s, id) ? id : s.doc.nodes[id].parentId!)))] }) } },

  { id: 'zoom-in', label: 'Zoom in', group: 'View', keys: ['Ctrl+='], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), s.view.zoom * 2) }) } },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', keys: ['Ctrl+-'], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), s.view.zoom / 2) }) } },
  { id: 'zoom-100', label: 'Zoom to 100%', group: 'View', keys: ['Ctrl+0'], run: (st) => { const s = st.get(); st.set({ view: zoomAt(s.view, centre(s), 1) }) } },
  { id: 'zoom-fit', label: 'Zoom to fit', group: 'View', keys: ['Shift+1'], run: (st) => zoomToFit(st) },
  { id: 'zoom-selection', label: 'Zoom to selection', group: 'View', keys: ['Shift+2'], enabled: has, run: (st) => { const s = st.get(); st.set({ view: fitView(worldBox(s.doc, s.selection), s.size) }) } },
  { id: 'command-palette', label: 'Command palette…', group: 'View', keys: ['Ctrl+K'], run: (_, a) => a.openPalette() },
  { id: 'toggle-ui', label: 'Show/Hide UI', group: 'View', keys: ['Ctrl+\\'], run: (st) => st.set({ uiHidden: !st.get().uiHidden }) },
  { id: 'present', label: 'Present prototype', group: 'View', keys: ['Ctrl+Alt+Enter'], enabled: (s) => !!presentFrom(s.doc, s.pageId, s.selection), run: (st) => st.set({ preview: presentFrom(st.get().doc, st.get().pageId, st.get().selection) }) },
  { id: 'toggle-resolved-comments', label: 'Show resolved comments', group: 'View', run: (st) => st.set({ showResolved: !st.get().showResolved }) },
  { id: 'toggle-rulers', label: 'Rulers', group: 'View', keys: ['Shift+R'], run: (st) => st.set({ rulers: !st.get().rulers }) },
  { id: 'dev-mode', label: 'Dev mode', group: 'View', keys: ['Shift+D'], run: (st) => st.set({ dev: !st.get().dev }) },
  { id: 'toggle-guides', label: 'Guides', group: 'View', keys: ['Ctrl+;'], run: (st) => st.set({ guidesVisible: !st.get().guidesVisible }) },
  { id: 'toggle-pixel-grid', label: 'Pixel grid', group: 'View', keys: ["Ctrl+'"], run: (st) => st.set({ pixelGrid: !st.get().pixelGrid }) },
  { id: 'toggle-layout-grids', label: 'Layout grids', group: 'View', keys: ['Ctrl+Shift+4'], run: (st) => st.set({ layoutGridsVisible: !st.get().layoutGridsVisible }) },

  {
    id: 'toggle-flow-start', label: 'Toggle flow starting point', group: 'Object',
    enabled: (s) => s.selection.length > 0 && s.selection.every((id) => s.doc.nodes[id]?.type === 'FRAME' && s.doc.nodes[id].parentId === s.pageId),
    run: (st) => st.update((d) => patch(d, st.get().selection, (n) => ({ flowStart: n.flowStart ? undefined : true }))),
  },
  { id: 'group', label: 'Group selection', group: 'Object', keys: ['Ctrl+G'], enabled: has, run: (st) => st.update((d) => group(d, st.get().selection, 'GROUP')) },
  { id: 'ungroup', label: 'Ungroup', group: 'Object', keys: ['Ctrl+Shift+G'], enabled: (s) => s.selection.some((id) => ['GROUP', 'FRAME', 'BOOLEAN'].includes(s.doc.nodes[id]?.type)), run: (st) => st.update((d) => ungroup(d, st.get().selection)) },
  { id: 'frame-selection', label: 'Frame selection', group: 'Object', keys: ['Ctrl+Alt+G'], enabled: has, run: (st) => st.update((d) => group(d, st.get().selection, 'FRAME')) },
  boolean('union', 'Union', 'Ctrl+Alt+U', 'UNION'), boolean('subtract', 'Subtract', 'Ctrl+Alt+S', 'SUBTRACT'),
  boolean('intersect', 'Intersect', 'Ctrl+Alt+I', 'INTERSECT'), boolean('exclude', 'Exclude', 'Ctrl+Alt+X', 'EXCLUDE'),
  { id: 'use-as-mask', label: 'Use as mask', group: 'Object', keys: ['Ctrl+Alt+M'], enabled: (s) => has(s) && (s.selection.length > 1 || (!!lone(s) && canMask(lone(s)!))),
    run: (st) => st.update((d) => useAsMask(d, st.get().selection)) },
  { id: 'flatten', label: 'Flatten', group: 'Object', keys: ['Ctrl+E'], enabled: has,
    run: (st) => withFonts(st, (d, sel) => {
      const ids = topLevel(d, sel) // several nodes flatten as their union
      const made = ids.length > 1 ? makeBoolean(d, ids, 'UNION') : { doc: d, ids }
      return flatten(made.doc, made.ids)
    }) },
  { id: 'add-auto-layout', label: 'Add auto layout', group: 'Object', keys: ['Shift+A'], enabled: has, run: (st) => onFrame(st, (n) => !n.layout, addAutoLayout) },
  { id: 'remove-auto-layout', label: 'Remove auto layout', group: 'Object', keys: ['Alt+Shift+A'], enabled: (s) => s.selection.some((id) => s.doc.nodes[id]?.layout), run: (st) => st.update((d) => patch(d, st.get().selection.filter((id) => d.nodes[id]?.layout), { layout: undefined })) },
  { id: 'create-component', label: 'Create component', group: 'Object', keys: ['Ctrl+Alt+K'], enabled: has, run: (st) => onFrame(st, (n) => !n.component && !n.instanceOf, makeComponent) },
  { id: 'create-instance', label: 'Create instance', group: 'Object', enabled: (s) => !!lone(s)?.component || (!!lone(s)?.componentSet && variantsOf(s.doc, lone(s)!.id).length > 0), run: createInstance },
  { id: 'combine-variants', label: 'Combine as variants', group: 'Object', enabled: (s) => s.selection.length > 0 && s.selection.every((id) => s.doc.nodes[id]?.component && !setOf(s.doc, id)), run: (st) => st.update((d) => combineAsVariants(d, st.get().selection)) },
  { id: 'add-variant', label: 'Add variant', group: 'Object', enabled: (s) => !!setSelected(s), run: (st) => st.update((d) => addVariant(d, setSelected(st.get())!.id)) },
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

  tool('move', 'Move', 'V'), tool('hand', 'Hand', 'H'), tool('frame', 'Frame', 'F'), tool('section', 'Section', 'Shift+X'), tool('slice', 'Slice', 'S'),tool('rectangle', 'Rectangle', 'R'),
  tool('ellipse', 'Ellipse', 'O'), tool('line', 'Line', 'L'), tool('arrow', 'Arrow', 'Shift+L'), tool('star', 'Star', 'Shift+S'), tool('polygon', 'Polygon', 'Shift+G'), tool('pen', 'Pen', 'P'), tool('pencil', 'Pencil', 'Shift+P'),tool('text', 'Text', 'T'), tool('scale', 'Scale', 'K'), tool('comment', 'Comment', 'C'),
  // Escape steps out one level: leaves a mode (finishing a pen path), then deselects
  { id: 'escape', label: 'Deselect', group: 'Tools', keys: ['Escape'], run: (st) => (inMode(st.get()) ? exitMode(st) : st.set({ selection: [], tool: 'move', draft: null, openComment: null })) },
  // Enter edits a text's characters or a vector's points, or leaves the mode; on other layers it selects their children
  { id: 'edit', label: 'Edit text or points', group: 'Tools', keys: ['Enter'], enabled: (s) => inMode(s) || editable(s) || s.selection.some((id) => childrenOf(s.doc, id).length > 0),
    run: (st) => { const s = st.get(); if (inMode(s)) exitMode(st); else if (editable(s)) editNode(st, s.selection[0]); else st.set({ selection: s.selection.flatMap((id) => childrenOf(s.doc, id).map((n) => n.id)) }) } },
]

const editable = (s: EditorState) => s.selection.length === 1 && ['TEXT', 'VECTOR'].includes(s.doc.nodes[s.selection[0]]?.type)
/** True when the node sits directly on a page (or is gone): it has no parent layer to select. */
const isTopLevel = (s: EditorState, id: string) => (s.doc.nodes[s.doc.nodes[id]?.parentId ?? '']?.type ?? 'PAGE') === 'PAGE'
const lone = (s: EditorState) => (s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : undefined)

/**
 * Duplicates the selection. Copies of top-level frames go to the right of the originals so they don't hide them;
 * copies inside a frame stay in place. shortcut: the copies can still land on other frames there; find free space if that bites.
 */
function duplicateBeside(d: Document, selection: string[]): Edit {
  const made = duplicate(d, selection), frames = made.ids.filter((id) => made.doc.nodes[id].type === 'FRAME' && made.doc.nodes[made.doc.nodes[id].parentId!]?.type === 'PAGE')
  const box = worldBox(made.doc, frames)
  return box ? { doc: translate(made.doc, frames, { x: box.w + 40, y: 0 }), ids: made.ids } : made
}

/** One shape toggles its mask flag; several are grouped first and the bottom-most becomes the mask over the rest. Shapes that can't mask are left alone. */
function useAsMask(d: Document, selection: string[]): Document | Edit {
  const ids = topLevel(d, selection)
  if (ids.length === 1) return d.nodes[ids[0]] && canMask(d.nodes[ids[0]]) ? patch(d, ids, { mask: d.nodes[ids[0]].mask ? undefined : true }) : d
  const made = group(d, ids, 'GROUP'), base = made.ids[0] && childrenOf(made.doc, made.ids[0])[0]
  return base && canMask(base) ? { doc: patch(made.doc, [base.id], { mask: true }), ids: made.ids } : d
}

/** A lone frame that `takes` the change gets it directly; anything else is wrapped in a new frame first, which gets it and is selected. */
function onFrame(st: EditorStore, takes: (frame: Node) => boolean, change: (doc: Document, id: string) => Document) {
  const { doc, selection } = st.get(), ids = topLevel(doc, selection), only = ids.length === 1 ? doc.nodes[ids[0]] : null
  if (only?.type === 'FRAME' && takes(only)) return st.update((d) => change(d, only.id))
  st.update((d) => {
    const r = group(d, ids, 'FRAME')
    return r.ids.length ? { doc: change(r.doc, r.ids[0]), ids: r.ids } : d
  })
}
/** Places an instance of the selected main component (a set's first variant for a set) just right of it, or of its set. */
function createInstance(st: EditorStore) {
  const { node, at } = newInstance(st.get().doc, lone(st.get())!.id)
  st.update((d) => ({ doc: put(d, [{ ...node, x: at.x + at.width + 40, y: at.y, parentId: at.parentId, order: orderAbove(d, at) }]), ids: [node.id] }))
}
const setSelected = (s: EditorState) => { const n = lone(s); return n?.componentSet ? n : n && setOf(s.doc, n.id) }
function goToMain(st: EditorStore) {
  const { doc } = st.get(), main = doc.nodes[lone(st.get())!.instanceOf!]
  showPage(st, pageOf(doc, main.id)!, [main.id])
  const s = st.get()
  st.set({ view: fitView(worldBox(s.doc, [main.id]), s.size) })
}

export const isEnabled = (c: Command, store: EditorStore) => !c.enabled || c.enabled(store.get(), store)
/** Runs a command from a panel button. Commands that need the Editor's own actions (back, export) do nothing here. */
export const runCommand = (store: EditorStore, id: string) => COMMANDS.find((c) => c.id === id)!.run(store, { back() {}, openExport() {}, placeImages() {}, openPalette() {}, openRename() {}, openFind() {}, openVersions() {}, openLibraries() {} })

const CODES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-' }
/** "Ctrl+Shift+G" for a key event. Digits and punctuation go by physical key so they work on any layout; letters by what they type. */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  // With Alt held, letters go by physical key too: on Windows Ctrl+Alt is AltGr, which types another character
  // (e.g. Ctrl+Alt+K gives "&" on a Czech layout). shortcut: QWERTZ users get Y/Z by position there; no command uses them.
  const letter = e.altKey && /^Key[A-Z]$/.test(e.code) ? e.code[3] : null
  const k = letter ?? (/^Digit\d$/.test(e.code) ? e.code[5] : (CODES[e.code] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)))
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+')
}

/** Runs the command bound to a key event. Returns true if the event was handled. */
export function handleKey(e: KeyboardEvent, store: EditorStore, actions: Actions): boolean {
  const key = keyOf(e), s = store.get()
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key.replace('Shift+', '')]
  if (arrow && s.selection.length) {
    const step = e.shiftKey ? 10 : 1, ids = topLevel(s.doc, s.selection).filter((id) => !s.doc.nodes[id].locked)
    store.update((d) => translate(d, ids, { x: arrow[0] * step, y: arrow[1] * step }), { key: 'nudge' })
    return true
  }
  const cmd = COMMANDS.find((c) => c.keys?.includes(key))
  if (!cmd || cmd.id === 'paste') return false
  if (!isEnabled(cmd, store)) return false
  cmd.run(store, actions)
  return true
}
