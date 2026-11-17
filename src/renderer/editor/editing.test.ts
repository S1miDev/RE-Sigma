// Editing: the store (undo, autosave), tools, modes, the pen and point editing.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { emptyDocument, makeNode, solid, type Node } from '../../shared/document'
import { dive, pick } from './canvas/hit'
import { handleKey, keyOf, runCommand, type Actions } from './commands'
import { toSvg } from './export/svg'
import { worldBox } from './model/geometry'
import { addPage, childrenOf, group, insert, patch, remove } from './model/ops'
import { anchorsOf } from './model/path'
import { AUTOSAVE_MS, gestureStep, NO_MODE } from './store'
import { beginGesture, editNode, showPage } from './tools'
import { insertText, select, textKey } from './tools/textEdit'
import { open, at, drag, run, penMode } from './testkit'

const NO_ACTIONS = {} as Actions
beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('store: undo/redo restore document and selection; tagged edits share one step', () => {
  const { store, a, doc } = open()
  store.update((d) => ({ doc: patch(d, [a], { x: 1 }), ids: [a] }))
  const g = gestureStep()
  store.update((d) => patch(d, [a], { x: 2 }), g)
  store.update((d) => patch(d, [a], { x: 3 }), g)
  expect(store.get().doc.nodes[a].x).toBe(3)
  store.undo()
  expect(store.get().doc.nodes[a].x).toBe(1)
  expect(store.get().selection).toEqual([a])
  store.undo()
  expect(store.get().doc).toBe(doc)
  expect(store.canUndo()).toBe(false)
  store.redo(); store.redo()
  expect(store.get().doc.nodes[a].x).toBe(3)
  store.update((d) => remove(d, [a]))
  expect(store.get().selection).toEqual([]) // selection never points at a deleted node
  expect(store.canRedo()).toBe(false)
  store.update((d) => d) // a no-op adds no history
  store.undo()
  expect(store.get().doc.nodes[a]).toBeDefined()
})

test('store: groups refit and empty groups vanish after any edit', () => {
  const { store, a, b } = open()
  let gid = ''
  store.update((d) => { const g = group(d, [a, b], 'GROUP'); gid = g.ids[0]; return g.doc })
  store.update((d) => patch(d, [b], { x: 200 }))
  expect(store.get().doc.nodes[gid].width).toBe(300)
  store.update((d) => remove(d, [a, b]))
  expect(store.get().doc.nodes[gid]).toBeUndefined()
})

test('store: autosaves after the debounce, reports failure, keeps the document and retries', async () => {
  let fail = true
  const { store, a, saveProject } = open({ saveProject: vi.fn(async () => { if (fail) throw new Error("Error invoking remote method 'refig:saveProject': Error: disk full"); return { id: 'p1', name: 'P', modifiedAt: '', thumbnail: null } }) })
  expect(saveProject).toBeDefined()
  const save = store.api.saveProject as ReturnType<typeof vi.fn>
  store.update((d) => patch(d, [a], { x: 9 }))
  expect(store.get().save).toBe('dirty')
  await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1)
  expect(save).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(save).toHaveBeenCalledTimes(1)
  expect(store.get()).toMatchObject({ save: 'error', saveError: 'disk full' })
  expect(store.get().doc.nodes[a].x).toBe(9)
  expect(store.isDirty()).toBe(true)
  fail = false
  await vi.advanceTimersByTimeAsync(5000)
  expect(store.get().save).toBe('saved')
  expect(save.mock.calls.at(-1)![1].nodes[a].x).toBe(9)
  expect(await store.save()).toBe(true) // nothing to do
  expect(save).toHaveBeenCalledTimes(2)
})

test('store: an edit made while a save is in flight is saved afterwards', async () => {
  let release = () => {}
  const save = vi.fn(() => new Promise<never>((done) => (release = () => done(undefined as never))))
  const { store, a } = open({ saveProject: save as never })
  store.update((d) => patch(d, [a], { x: 1 }))
  const first = store.save()
  store.update((d) => patch(d, [a], { x: 2 }))
  expect(store.get().save).toBe('saving')
  release()
  await first
  expect(store.get().save).toBe('dirty')
  await vi.advanceTimersByTimeAsync(AUTOSAVE_MS)
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(save).toHaveBeenCalledTimes(2)
  expect(store.get().save).toBe('saved')
})

test('tools: rectangle drag draws inside the frame under the pointer, then returns to Move', () => {
  const { store, frame } = open()
  store.set({ tool: 'rectangle' })
  drag(store, at(120, 180), at(150, 200), at(170, 240))
  const s = store.get(), id = s.selection[0]
  expect(s.tool).toBe('move')
  expect(s.doc.nodes[id]).toMatchObject({ type: 'RECTANGLE', parentId: frame, x: 20, y: 80, width: 50, height: 60, name: 'Rectangle 1' })
  store.undo()
  expect(store.get().doc.nodes[id]).toBeUndefined() // the whole drag is one undo step
  store.set({ tool: 'ellipse' })
  drag(store, at(700, 700))
  expect(store.get().doc.nodes[store.get().selection[0]]).toMatchObject({ type: 'ELLIPSE', x: 700, y: 700, width: 100, height: 100 })
})

test('tools: click selects, Shift adds, drag moves and reparents on drop, marquee selects', () => {
  const { store, page, frame, a, b } = open()
  drag(store, at(410, 10))
  expect(store.get().selection).toEqual([a])
  drag(store, at(540, 100, { shift: true }))
  expect(store.get().selection).toEqual([a, b])
  drag(store, at(0, 300))
  expect(store.get().selection).toEqual([])

  drag(store, at(410, 10), at(300, 110), at(160, 210)) // drop a inside the frame
  expect(store.get().doc.nodes[a]).toMatchObject({ parentId: frame, x: 50, y: 100 })
  store.undo()
  expect(store.get().doc.nodes[a]).toMatchObject({ parentId: page, x: 400, y: 0 })

  drag(store, at(600, 300), at(380, -20))
  expect(store.get().selection).toEqual([a, b])
  expect(store.get().overlay).toEqual({})
})

test('tools: moving snaps to a sibling edge and shows a guide while dragging', () => {
  const { store, a } = open()
  const g = beginGesture(store, at(410, 10))!
  g.move(at(410, 163)) // a's top would be at 153; b's bottom edge is at 150
  expect(store.get().doc.nodes[a].y).toBe(150)
  expect(store.get().overlay.guides).toEqual({ x: 450, y: 150 })
  g.up(at(410, 163))
  expect(store.get().overlay).toEqual({})
})

test('tools: handles resize and rotate the selected node', () => {
  const { store, a } = open()
  store.set({ selection: [a] })
  drag(store, at(500, 100), at(520, 130), at(700, 300))
  expect(store.get().doc.nodes[a]).toMatchObject({ x: 400, y: 0, width: 300, height: 300 })
  drag(store, at(550, -22), at(872, 150, { shift: true }))
  expect(store.get().doc.nodes[a].rotation).toBe(90)
})

test('tools: text tool creates a node in edit mode; hand tool pans', () => {
  const { store, page } = open()
  store.set({ tool: 'text' })
  drag(store, at(10, 500))
  const s = store.get(), id = s.selection[0]
  expect(s).toMatchObject({ tool: 'move', mode: { kind: 'text', id } })
  expect(s.doc.nodes[id]).toMatchObject({ type: 'TEXT', parentId: page, x: 10, y: 500, textAutoWidth: true })
  store.set({ tool: 'hand', mode: NO_MODE })
  drag(store, at(0, 0), at(30, 40))
  expect(store.get().view).toMatchObject({ x: 30, y: 40 })
})

test('auto layout: Shift+A wraps the selection; dragging a child reorders it; dropping in slots it', () => {
  const { store, a, b } = open()
  store.set({ selection: [a, b] })
  runCommand(store, 'add-auto-layout')
  const s = store.get(), f = s.selection[0]
  expect(s.doc.nodes[f].layout?.mode).toBe('HORIZONTAL')
  expect(childrenOf(s.doc, f).map((k) => k.id)).toEqual([a, b])
  const fb = worldBox(s.doc, [f])!
  expect(fb).toEqual({ x: 400, y: 0, w: 200, h: 100 }) // gap read as 0 from the overlap
  store.set({ selection: [] })
  drag(store, at(410, 50, { ctrl: true }), at(450, 50), at(590, 50)) // a past b's centre
  expect(childrenOf(store.get().doc, f).map((k) => k.id)).toEqual([b, a])
  expect(store.get().doc.nodes[b].x).toBe(0)
  store.undo()
  expect(childrenOf(store.get().doc, f).map((k) => k.id)).toEqual([a, b])
})

test('keyOf: Ctrl+Alt letters work on AltGr layouts', () => {
  const k = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => keyOf({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
  expect(k('&', 'KeyK', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+K') // Czech AltGr+K
  expect(k('đ', 'KeyB', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+B')
  expect(k('z', 'KeyY')).toBe('Z') // without Alt, letters still go by what they type (QWERTZ)
})

test('modes: switching page or undoing leaves point editing; a pen path in progress is finished on a page switch', () => {
  const { store, page } = open()
  const v = makeNode('VECTOR', { x: 600, y: 600, width: 50, height: 50, vector: { w: 50, h: 50, fill: [{ d: 'M0 0L50 0L0 50Z', rule: 'nonzero' }], stroke: [] } })
  store.update((d) => ({ doc: insert(d, v, page), ids: [v.id] }))
  editNode(store, v.id)
  expect(store.get().mode).toEqual({ kind: 'points', id: v.id, sel: null })
  store.update((d) => addPage(d))
  showPage(store, store.get().doc.pages.at(-1)!)
  expect(store.get().mode).toEqual(NO_MODE)

  showPage(store, page, [v.id])
  editNode(store, v.id)
  store.undo()
  expect(store.get().mode).toEqual(NO_MODE)

  store.set({ tool: 'pen' })
  drag(store, at(10, 10))
  const lone = penMode(store).id
  showPage(store, store.get().doc.pages.at(-1)!)
  expect(store.get()).toMatchObject({ mode: NO_MODE, tool: 'move' })
  expect(store.get().doc.nodes[lone]).toBeUndefined() // a single point leaves nothing
})

test('pencil: a drag draws one smoothed vector in the frame under it, one undo removes it, a click draws nothing', () => {
  const { store, frame } = open()
  store.set({ tool: 'pencil' })
  const before = Object.keys(store.get().doc.nodes).length
  drag(store, at(150, 150))
  expect(Object.keys(store.get().doc.nodes)).toHaveLength(before)
  drag(store, at(150, 150), at(170, 150), at(190, 190), at(210, 190), at(230, 150))
  const id = store.get().selection[0], n = store.get().doc.nodes[id]
  expect(n).toMatchObject({ type: 'VECTOR', parentId: frame })
  expect(store.get().tool).toBe('pencil')
  expect(anchorsOf(n)[0].anchors.length).toBeGreaterThanOrEqual(2)
  store.undo()
  expect(store.get().doc.nodes[id]).toBeUndefined()
})

test('pen: clicks draw corners, a drag pulls handles, the first point closes, the whole path is one undo step', () => {
  const { store, doc } = open()
  store.set({ tool: 'pen' })
  drag(store, at(600, 600))
  drag(store, at(700, 600), at(720, 640), at(740, 680)) // drag: handles
  const id = penMode(store).id
  expect(penMode(store).anchors[1]).toEqual({ x: 700, y: 600, out: { x: 740, y: 680 }, in: { x: 660, y: 520 } }) // page = parent coords here
  drag(store, at(700, 700))
  drag(store, at(603, 602)) // back on the first point
  const s = store.get(), n = s.doc.nodes[id]
  expect(s).toMatchObject({ mode: NO_MODE, tool: 'move', selection: [id] })
  expect(n).toMatchObject({ type: 'VECTOR', name: 'Vector 1', fills: [], strokes: [solid(0, 0, 0)] })
  expect(anchorsOf(n)[0]).toMatchObject({ closed: true })
  expect(anchorsOf(n)[0].anchors).toHaveLength(3)
  expect(anchorsOf(n)[0].anchors[1].out).toBeDefined() // the dragged handle shapes the next segment too
  expect(toSvg(s.doc, [id], () => undefined)).toContain('<path d="M')
  store.undo()
  expect(store.get().doc).toBe(doc)
})

test('pen: Escape or a tool change finishes an open path; a single point leaves nothing; Shift keeps 45°', () => {
  const { store } = open()
  store.set({ tool: 'pen' })
  drag(store, at(600, 600))
  drag(store, at(700, 630, { shift: true })) // snapped onto the horizontal
  const id = penMode(store).id
  expect(penMode(store).anchors[1]).toMatchObject({ x: expect.closeTo(704.4, 1), y: expect.closeTo(600, 6) })
  run(store, 'escape')
  expect(store.get()).toMatchObject({ mode: NO_MODE, tool: 'move', selection: [id] })
  expect(anchorsOf(store.get().doc.nodes[id])[0].closed).toBe(false)
  store.set({ tool: 'pen' })
  drag(store, at(800, 800))
  const lone = penMode(store).id
  run(store, 'tool-rectangle')
  expect(store.get().doc.nodes[lone]).toBeUndefined()
  expect(store.get().tool).toBe('rectangle')
})

test('point editing: Enter starts it, dragging moves one point or one handle, Delete removes points, Escape ends it', () => {
  const { store, page } = open()
  const v = makeNode('VECTOR', { x: 600, y: 600, width: 100, height: 100, strokes: [solid(0, 0, 0)], vector: { w: 50, h: 50, fill: [{ d: 'M0 0L50 0C50 25 25 50 0 50Z', rule: 'nonzero' }], stroke: [{ d: 'M0 0Z', rule: 'nonzero' }] } })
  store.update((d) => ({ doc: insert(d, v, page), ids: [v.id] }))
  run(store, 'edit')
  expect(store.get().mode).toEqual({ kind: 'points', id: v.id, sel: null })
  drag(store, at(700, 600), at(720, 590), at(740, 580)) // the second anchor (100, 0 in px)
  let n = store.get().doc.nodes[v.id]
  expect(store.get().mode).toMatchObject({ sel: { s: 0, i: 1 } })
  expect(anchorsOf(n)[0].anchors[1]).toMatchObject({ x: 140, y: 0, out: { x: 140, y: 50 } }) // handles came along
  expect(n).toMatchObject({ x: 600, y: 580, width: 140, height: 120 }) // the box re-fitted
  expect(n.vector!.stroke).toEqual([]) // the imported outline no longer matches: dropped
  drag(store, at(740, 630), at(760, 630)) // its out-handle (140, 50 in px)
  expect(anchorsOf(store.get().doc.nodes[v.id])[0].anchors[1]).toMatchObject({ x: 140, out: { x: 160, y: 50 } })
  run(store, 'delete')
  n = store.get().doc.nodes[v.id]
  expect(anchorsOf(n)[0].anchors).toHaveLength(2)
  store.set({ mode: { kind: 'points', id: v.id, sel: { s: 0, i: 0 } } })
  run(store, 'delete') // one point left: the vector goes
  expect(store.get().doc.nodes[v.id]).toBeUndefined()
  expect(store.get().mode).toEqual(NO_MODE)
  store.undo(); store.undo()
  store.set({ selection: [v.id], mode: { kind: 'points', id: v.id, sel: null } })
  run(store, 'escape')
  expect(store.get()).toMatchObject({ mode: NO_MODE, selection: [v.id] })
})

test('text editing: typing, selecting with Shift+arrows, Ctrl+B styles the range, undo restores text and runs', () => {
  const { store } = open()
  store.set({ tool: 'text' })
  drag(store, at(10, 500))
  const id = store.get().selection[0]
  const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => textKey(store, { key: k, ctrl: false, shift: false, ...mods })
  const node = () => store.get().doc.nodes[id]
  insertText(store, 'hello world')
  expect(node().characters).toBe('hello world')
  expect(node().name).toBe('hello world') // the layer is named after its text
  key('Home')
  for (let i = 0; i < 5; i++) key('ArrowRight', { shift: true })
  expect(store.get().mode).toMatchObject({ anchor: 0, focus: 5 })
  key('b', { ctrl: true })
  expect(node().runs).toEqual([{ len: 5, style: { fontWeight: 700 } }, { len: 6, style: {} }])
  key('ArrowRight') // collapses to the end of the selection
  insertText(store, 'X') // typed after bold text: bold
  expect(node().characters).toBe('helloX world')
  expect(node().runs).toEqual([{ len: 6, style: { fontWeight: 700 } }, { len: 6, style: {} }])
  key('Backspace')
  expect(node().characters).toBe('hello world')
  store.undo()
  store.undo() // back before the bold
  expect(node().runs).toBeUndefined()
})

test('text editing: a style chosen at a bare caret applies to what is typed next; Up/Down keep the column', () => {
  const { store } = open()
  store.set({ tool: 'text' })
  drag(store, at(10, 500))
  const id = store.get().selection[0]
  const key = (k: string, mods: { shift?: boolean } = {}) => textKey(store, { key: k, ctrl: false, shift: false, ...mods })
  insertText(store, 'ab')
  key('i', {} as never) // not a ctrl key: ignored
  textKey(store, { key: 'i', ctrl: true, shift: false }) // italic pending at the caret
  insertText(store, 'c')
  expect(store.get().doc.nodes[id].runs).toEqual([{ len: 2, style: {} }, { len: 1, style: { fontItalic: true } }])
  insertText(store, '\nxyz')
  select(store, 7, 7) // end of the text
  key('ArrowUp')
  expect(store.get().mode).toMatchObject({ focus: 3 }) // end of "abc"
  key('ArrowDown')
  expect(store.get().mode).toMatchObject({ focus: 7 })
  key('ArrowRight', { shift: true })
  expect(store.get().mode).toMatchObject({ anchor: 7, focus: 7 })
})

test('tree navigation: Enter selects children, Shift+Enter the parent, Ctrl+A stays inside the parent', () => {
  const { store, frame, inner, a, b } = open()
  const key = (k: string, shift = false, ctrl = false) => handleKey({ key: k, code: k === 'a' ? 'KeyA' : k, shiftKey: shift, ctrlKey: ctrl, altKey: false, metaKey: false } as KeyboardEvent, store, NO_ACTIONS)
  store.set({ selection: [frame] })
  expect(key('Enter')).toBe(true)
  expect(store.get().selection).toEqual([inner])
  expect(key('Enter', true)).toBe(true)
  expect(store.get().selection).toEqual([frame])
  expect(key('Enter', true)).toBe(false) // a top-level layer has no parent to select
  store.set({ selection: [inner] })
  key('a', false, true)
  expect(store.get().selection).toEqual([inner])
  store.set({ selection: [a] })
  key('a', false, true)
  expect(store.get().selection).toEqual([frame, a, b])
})

test('undo and redo revert the document only; the selection stays, minus layers that are gone', () => {
  const { store, a, b } = open()
  store.set({ selection: [a] })
  store.update((d) => patch(d, [a], { x: 999 }))
  store.set({ selection: [b] })
  store.undo()
  expect(store.get().doc.nodes[a].x).toBe(400)
  expect(store.get().selection).toEqual([b])
  store.update((d) => remove(d, [b]))
  store.undo()
  store.set({ selection: [b] })
  store.redo() // b is deleted again
  expect(store.get().selection).toEqual([])
})

test('click depth: a click selects in the current context, each double-click goes one level deeper, Ctrl goes to the deepest', () => {
  let doc = emptyDocument()
  const page = doc.pages[0]
  const add = (type: 'FRAME' | 'TEXT', parent: string, props: Partial<Node>) => { const n = makeNode(type, { x: 0, y: 0, ...props }); doc = insert(doc, n, parent); return n.id }
  const desktop = add('FRAME', page, { width: 1440, height: 900 })
  const section = add('FRAME', desktop, { width: 600, height: 400 })
  const card = add('FRAME', section, { width: 200, height: 200 }), other = add('FRAME', section, { x: 300, width: 200, height: 200 })
  const button = add('FRAME', card, { width: 100, height: 40 })
  const label = add('TEXT', button, { width: 50, height: 20, characters: 'Go' })
  const p = { x: 5, y: 5 }
  expect(pick(doc, page, p, [])).toBe(section) // the top-level frame's child
  expect(dive(doc, page, p, [section])).toEqual({ select: card })
  expect(pick(doc, page, p, [card])).toBe(card) // a selected layer under the pointer stays, so it can be dragged
  expect(dive(doc, page, p, [card])).toEqual({ select: button })
  expect(dive(doc, page, p, [button])).toEqual({ select: label })
  expect(dive(doc, page, p, [label])).toEqual({ edit: label }) // text editing only once the text itself is selected
  expect(pick(doc, page, { x: 305, y: 5 }, [card])).toBe(other) // a sibling of the selection
  expect(pick(doc, page, p, [], { deep: true })).toBe(label)
  expect(pick(doc, page, { x: 1000, y: 800 }, [])).toBe(desktop) // empty part of a top-level frame
})

test('Ctrl+D puts the copy of a top-level frame to its right; a copy inside a frame stays in place', () => {
  const { store, frame, inner } = open()
  store.set({ selection: [frame] })
  run(store, 'duplicate')
  const [copy] = store.get().selection
  expect(copy).not.toBe(frame)
  expect(store.get().doc.nodes[copy]).toMatchObject({ x: 100 + 200 + 40, y: 100 })
  store.set({ selection: [inner] })
  run(store, 'duplicate')
  expect(store.get().doc.nodes[store.get().selection[0]]).toMatchObject({ x: 10, y: 10 })
})
