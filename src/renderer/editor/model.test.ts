import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { RefigApi } from '../../shared/api'
import { colorAt, convertPaint, emptyDocument, gradient, gradientAngle, makeNode, rotateGradient, solid, type AutoLayout, type Constraint, type Document, type Node, type NodeType, type Paint } from '../../shared/document'
import { frameAt, hitTest, marqueeHits } from './canvas/hit'
import { handleAt, handlesOf } from './canvas/overlay'
import { snap, snapTargets } from './canvas/snap'
import { fitView, toScreen, toWorld, zoomAt } from './canvas/viewport'
import { COMMANDS, keyOf } from './commands'
import { toSvg } from './export/svg'
import { apply, corners, invert, lineBetween, localMatrix, mul, resizeBox, worldBox } from './model/geometry'
import { addAutoLayout, addPage, align, autoLayout, childrenOf, distribute, duplicate, group, insert, moveTo, movePage, patch, put, remove, removePage, reorder, resizeNode, topLevel, translate, ungroup } from './model/ops'
import { setVariant, syncInstances, variantProps, variantsOf } from './model/components'
import { AUTOSAVE_MS, createEditorStore } from './store'
import { beginGesture, type Pointer } from './tools'

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
function scene() {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const add = (type: NodeType, parentId: string, props: Partial<Node>) => {
    const n = makeNode(type, { fills: [solid(1, 0, 0)], ...props })
    doc = insert(doc, n, parentId)
    return n.id
  }
  const frame = add('FRAME', page, { x: 100, y: 100, width: 200, height: 200 })
  const inner = add('RECTANGLE', frame, { x: 10, y: 10, width: 50, height: 50 })
  const a = add('RECTANGLE', page, { x: 400, y: 0, width: 100, height: 100 })
  const b = add('ELLIPSE', page, { x: 450, y: 50, width: 100, height: 100 })
  return { doc, page, frame, inner, a, b }
}
const names = (doc: Document, parent: string) => childrenOf(doc, parent).map((n) => n.id)

test('matrices: a rotated node maps its corners about its centre, and inverts', () => {
  const n = makeNode('RECTANGLE', { x: 10, y: 20, width: 100, height: 50, rotation: 90 })
  const m = localMatrix(n), c = apply(m, { x: 50, y: 25 })
  near(c.x, 60); near(c.y, 45) // the centre doesn't move
  const p = apply(m, { x: 0, y: 0 })
  near(p.x, 85); near(p.y, -5)
  const back = apply(mul(invert(m), m), { x: 3, y: 4 })
  near(back.x, 3); near(back.y, 4)
})

test('worldBox follows nesting', () => {
  const { doc, inner, frame } = scene()
  expect(worldBox(doc, [inner])).toEqual({ x: 110, y: 110, w: 50, h: 50 })
  const rotated = patch(doc, [frame], { rotation: 180 })
  const box = worldBox(rotated, [inner])!
  near(box.x, 240); near(box.y, 240)
})

test('resizeBox keeps the opposite edge fixed, flips, and honours Shift/Alt', () => {
  const n = makeNode('RECTANGLE', { x: 0, y: 0, width: 100, height: 50 })
  expect(resizeBox(n, 1, 1, { x: 150, y: 80 })).toEqual({ x: 0, y: 0, width: 150, height: 80 })
  expect(resizeBox(n, -1, 0, { x: 20, y: 999 })).toEqual({ x: 20, y: 0, width: 80, height: 50 })
  expect(resizeBox(n, 1, 0, { x: -40, y: 0 })).toMatchObject({ x: -40, width: 40 }) // dragged past the left edge
  expect(resizeBox(n, 1, 1, { x: 200, y: 60 }, { shift: true })).toMatchObject({ width: 200, height: 100 })
  expect(resizeBox(n, 1, 0, { x: 120, y: 0 }, { alt: true })).toMatchObject({ x: -20, width: 140 })
  const r = resizeBox({ ...n, rotation: 90 }, 1, 0, { x: 50, y: 125 }) // right edge points down when rotated 90°
  near(r.width, 150); near(r.height, 50)
  const line = lineBetween({ x: 0, y: 0 }, { x: 0, y: 10 })
  near(line.rotation, 90); near(line.width, 10); near(line.x, -5); near(line.y, 5)
})

test('insert stacks on top; reorder moves within siblings', () => {
  const { doc, page, frame, a, b } = scene()
  expect(names(doc, page)).toEqual([frame, a, b])
  expect(names(reorder(doc, [frame], 'forward'), page)).toEqual([a, frame, b])
  expect(names(reorder(doc, [b], 'back'), page)).toEqual([b, frame, a])
  expect(names(reorder(doc, [frame, a], 'front'), page)).toEqual([b, frame, a])
  expect(names(reorder(doc, [b], 'forward'), page)).toEqual([frame, a, b]) // already on top
  expect(reorder(doc, [b], 'forward')).toBe(doc)
})

test('remove takes descendants; pages are not removable through it', () => {
  const { doc, page, frame, inner } = scene()
  const next = remove(doc, [frame, page])
  expect(next.nodes[frame]).toBeUndefined()
  expect(next.nodes[inner]).toBeUndefined()
  expect(next.nodes[page]).toBeDefined()
})

test('moveTo reparents without moving the node on the page, and refuses cycles', () => {
  const { doc, page, frame, inner, a } = scene()
  const rotated = patch(doc, [frame], { rotation: 30 })
  const before = corners(rotated, a)
  const moved = moveTo(rotated, [a], frame)
  expect(moved.nodes[a].parentId).toBe(frame)
  corners(moved, a).forEach((p, i) => { near(p.x, before[i].x); near(p.y, before[i].y) })
  near(moved.nodes[a].rotation, -30)
  expect(names(moveTo(doc, [a], frame, { before: inner }), frame)).toEqual([a, inner])
  expect(moveTo(doc, [frame], frame)).toBe(doc)
  const nested = moveTo(doc, [a], frame)
  expect(moveTo(nested, [frame], a)).toBe(nested) // a isn't a container
  expect(names(moveTo(doc, [inner], page, { after: a }), page).indexOf(inner)).toBe(2)
})

test('group wraps children, ungroup restores them in place', () => {
  const { doc, page, frame, a, b } = scene()
  const g = group(doc, [a, b], 'GROUP')
  expect(doc.nodes[a].parentId).toBe(page)
  const box = g.doc.nodes[g.id!]
  expect(box).toMatchObject({ type: 'GROUP', x: 400, y: 0, width: 150, height: 150 })
  expect(g.doc.nodes[a]).toMatchObject({ parentId: g.id, x: 0, y: 0 })
  expect(g.doc.nodes[b]).toMatchObject({ x: 50, y: 50 })
  expect(names(g.doc, page)).toEqual([frame, g.id])

  const un = ungroup(g.doc, [g.id!])
  expect(un.ids).toEqual([a, b])
  expect(un.doc.nodes[g.id!]).toBeUndefined()
  expect(un.doc.nodes[b]).toMatchObject({ parentId: page, x: 450, y: 50 })

  // resizing a group scales its children
  const scaled = resizeNode(g.doc, g.id!, { x: 400, y: 0, width: 300, height: 150 })
  expect(scaled.nodes[b]).toMatchObject({ x: 100, width: 200, height: 100 })
})

test('duplicate copies subtrees with new ids directly above the original', () => {
  const { doc, page, frame, inner, a, b } = scene()
  const d = duplicate(doc, [frame, inner])
  expect(d.ids).toHaveLength(1) // inner is inside frame, so only frame is duplicated
  const copy = d.ids[0]
  expect(names(d.doc, page)).toEqual([frame, copy, a, b])
  expect(childrenOf(d.doc, copy)).toHaveLength(1)
  expect(childrenOf(d.doc, copy)[0].id).not.toBe(inner)
  expect(topLevel(doc, [inner, frame, 'missing'])).toEqual([frame])
})

test('translate moves by a page delta even inside a rotated parent', () => {
  const { doc, frame, inner } = scene()
  const rotated = patch(doc, [frame], { rotation: 90 })
  const before = worldBox(rotated, [inner])!
  const after = worldBox(translate(rotated, [inner], { x: 10, y: 0 }), [inner])!
  near(after.x, before.x + 10); near(after.y, before.y)
})

test('pages: add, reorder, remove (never the last one)', () => {
  const { doc, page } = scene()
  const added = addPage(doc)
  expect(added.doc.nodes[added.id].name).toBe('Page 2')
  expect(movePage(added.doc, added.id, 0).pages).toEqual([added.id, page])
  const removed = removePage(added.doc, page)
  expect(removed.pages).toEqual([added.id])
  expect(Object.keys(removed.nodes)).toEqual([added.id])
  expect(removePage(removed, added.id)).toBe(removed)
})

test('viewport: zoomAt keeps the point under the cursor; fitView centres', () => {
  const v = { x: 30, y: -20, zoom: 1.5 }, p = { x: 200, y: 100 }
  const z = zoomAt(v, p, 4)
  expect(toWorld(z, p)).toEqual(toWorld(v, p))
  expect(toScreen(v, toWorld(v, p))).toEqual(p)
  expect(zoomAt(v, p, 1e9).zoom).toBe(256)
  const fit = fitView({ x: 0, y: 0, w: 1000, h: 500 }, { w: 596, h: 596 }, 48)
  expect(fit.zoom).toBe(0.5)
  expect(toScreen(fit, { x: 500, y: 250 })).toEqual({ x: 298, y: 298 })
  expect(fitView(null, { w: 100, h: 100 })).toEqual({ zoom: 1, x: 50, y: 50 })
  expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { w: 500, h: 500 }, 48, 1).zoom).toBe(1)
})

test('hit testing: top-most wins, frames expose children, groups answer for theirs, hidden/locked are skipped', () => {
  const { doc, page, frame, inner, a, b } = scene()
  expect(hitTest(doc, page, { x: 460, y: 60 })).toBe(a) // inside a's box but outside b's ellipse
  expect(hitTest(doc, page, { x: 490, y: 90 })).toBe(b)
  expect(hitTest(doc, page, { x: 120, y: 120 })).toBe(inner)
  expect(hitTest(doc, page, { x: 250, y: 250 })).toBe(frame)
  expect(hitTest(doc, page, { x: 0, y: 0 })).toBeNull()
  expect(hitTest(patch(doc, [b], { locked: true }), page, { x: 490, y: 90 })).toBe(a)
  expect(hitTest(patch(doc, [inner], { visible: false }), page, { x: 120, y: 120 })).toBe(frame)
  const g = group(doc, [a, b], 'GROUP')
  expect(hitTest(g.doc, page, { x: 490, y: 90 })).toBe(g.id)
  expect(hitTest(g.doc, page, { x: 490, y: 90 }, { deep: true })).toBe(b)
  expect(hitTest(g.doc, page, { x: 410, y: 140 })).toBeNull() // inside the group's box but on no child
  const line = insert(doc, makeNode('LINE', { ...lineBetween({ x: 0, y: 300 }, { x: 100, y: 400 }), strokes: [solid(0, 0, 0)] }), page)
  expect(hitTest(line, page, { x: 51, y: 50 + 300 }, { tolerance: 4 })).not.toBeNull()
  expect(hitTest(line, page, { x: 80, y: 320 }, { tolerance: 4 })).toBeNull()

  expect(marqueeHits(doc, page, { x: 390, y: -10, w: 300, h: 300 })).toEqual([a, b])
  expect(marqueeHits(doc, page, { x: 90, y: 90, w: 80, h: 80 })).toEqual([inner]) // frame only partly covered
  expect(marqueeHits(doc, page, { x: 90, y: 90, w: 300, h: 300 })).toEqual([frame])
  expect(frameAt(doc, page, { x: 150, y: 150 })).toBe(frame)
  expect(frameAt(doc, page, { x: 150, y: 150 }, [frame])).toBe(page)
  expect(frameAt(doc, page, { x: 0, y: 0 })).toBe(page)
})

test('snapping picks the nearest edge or centre within the threshold', () => {
  const targets = [{ x: 100, y: 100, w: 100, h: 100 }]
  expect(snap([97], [300], targets, 5)).toEqual({ dx: 3, dy: 0, guides: { x: 100 } })
  expect(snap([146, 153], [198], targets, 5)).toEqual({ dx: -3, dy: 2, guides: { x: 150, y: 200 } })
  expect(snap([94], [], targets, 5)).toEqual({ dx: 0, dy: 0, guides: {} })
  const { doc, page, frame, inner, a, b } = scene()
  expect(snapTargets(doc, page, [a])).toHaveLength(2)
  expect(snapTargets(doc, frame, [inner])).toEqual([worldBox(doc, [frame])]) // the parent frame itself
  expect(b).toBeTruthy()
})

test('handles: eight plus rotate for a box, two for a line, none when locked', () => {
  const { doc, a } = scene(), view = { x: 0, y: 0, zoom: 2 }
  const hs = handlesOf(doc, a, view)
  expect(hs).toHaveLength(9)
  expect(handleAt(hs, { x: 1000, y: 200 })).toMatchObject({ kind: 'resize', hx: 1, hy: 1 })
  expect(handleAt(hs, { x: 900, y: -22 })?.kind).toBe('rotate')
  expect(handleAt(hs, { x: 900, y: 100 })).toBeUndefined()
  expect(handlesOf(patch(doc, [a], { locked: true }), a, view)).toEqual([])
  expect(handlesOf(patch(doc, [a], { type: 'LINE', height: 0 }), a, view)).toHaveLength(2)
})

test('keyOf normalises shortcuts; every command key is unique', () => {
  const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => keyOf({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
  expect(ev('z', 'KeyZ', { ctrlKey: true })).toBe('Ctrl+Z')
  expect(ev('!', 'Digit1', { shiftKey: true })).toBe('Shift+1') // layout-independent digits
  expect(ev('G', 'KeyG', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+G')
  expect(ev(']', 'BracketRight')).toBe(']')
  const keys = COMMANDS.flatMap((c) => c.keys ?? [])
  expect(new Set(keys).size).toBe(keys.length)
})

test('SVG export escapes text and reflects the selection box', () => {
  const { doc, page, a } = scene()
  const withText = insert(doc, makeNode('TEXT', { characters: '<b>&"x"', x: 5, y: 5, width: 50, height: 19, fills: [solid(0, 0, 0)], effects: [{ visible: true, x: 1, y: 2, blur: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } }] }), page)
  const text = childrenOf(withText, page).at(-1)!.id
  const svg = toSvg(withText, [a, text], () => undefined)
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="495" height="100" viewBox="5 0 495 100">/)
  expect(svg).toContain('&#60;b&#62;&#38;&#34;x&#34;')
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('feGaussianBlur stdDeviation="2"')
  expect(svg).toContain('fill="rgb(255,0,0)"')
})

// ── store ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function fakeApi(over: Partial<RefigApi> = {}) {
  const saveProject = vi.fn(async (id: string) => ({ id, name: 'P', modifiedAt: '', thumbnail: null }))
  return { api: { saveProject, addImage: vi.fn(async () => 'h'.repeat(64)), ...over } as unknown as RefigApi, saveProject }
}
function open(over: Partial<RefigApi> = {}) {
  const s = scene(), f = fakeApi(over)
  const store = createEditorStore({ summary: { id: 'p1', name: 'P', modifiedAt: '', thumbnail: null }, document: s.doc, images: {} }, f.api)
  return { ...s, ...f, store }
}
beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('store: undo/redo restore document and selection; tagged edits share one step', () => {
  const { store, a, doc } = open()
  store.update((d) => patch(d, [a], { x: 1 }), undefined, [a])
  store.update((d) => patch(d, [a], { x: 2 }), 'gesture1')
  store.update((d) => patch(d, [a], { x: 3 }), 'gesture1')
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
  store.update((d) => { const g = group(d, [a, b], 'GROUP'); gid = g.id!; return g.doc })
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

// ── tools ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ screen: { x, y }, world: { x, y }, shift: false, alt: false, ctrl: false, ...mods })
function drag(store: ReturnType<typeof open>['store'], from: Pointer, ...to: Pointer[]) {
  const g = beginGesture(store, from)
  for (const p of to) g?.move(p)
  g?.up(to.at(-1) ?? from)
}

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
  expect(s).toMatchObject({ tool: 'move', editingText: id })
  expect(s.doc.nodes[id]).toMatchObject({ type: 'TEXT', parentId: page, x: 10, y: 500, textAutoWidth: true })
  store.set({ tool: 'hand', editingText: null })
  drag(store, at(0, 0), at(30, 40))
  expect(store.get().view).toMatchObject({ x: 30, y: 40 })
})

test('align: several nodes meet at the shared edge, a lone node aligns to its parent frame', () => {
  const { doc, a, b, inner } = scene()
  const left = align(doc, [a, b], 'x', 0)
  near(left.nodes[b].x, 400)
  const centred = align(doc, [inner], 'x', 0.5) // frame x 100..300, inner is 50 wide
  near(centred.nodes[inner].x, 75)
  expect(align(doc, [a], 'x', 0)).toBe(doc) // lone node on a page: nothing to align to
})

test('distribute: middle node moves so the gaps are equal', () => {
  const { doc, page } = scene()
  let d = doc
  const ids = [0, 30, 300].map((x) => { const n = makeNode('RECTANGLE', { x, y: 0, width: 100, height: 10 }); d = insert(d, n, page); return n.id })
  const out = distribute(d, ids, 'x')
  near(out.nodes[ids[1]].x, 150) // span 0..400, 300 of box width, 100 free / 2 gaps = 50
})

// ── auto layout ──────────────────────────────────────────────────────────────────────────────────────────────────────
function row(layout: Partial<AutoLayout> = {}, sizes: [number, number][] = [[40, 20], [60, 30], [20, 10]]) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const f = makeNode('FRAME', { x: 0, y: 0, width: 300, height: 100, layout: { mode: 'HORIZONTAL', gap: 10, padding: [5, 6, 7, 8], align: 'MIN', hugW: true, hugH: true, ...layout } })
  doc = insert(doc, f, page)
  const kids = sizes.map(([width, height]) => { const n = makeNode('RECTANGLE', { x: 500, y: 500, width, height }); doc = insert(doc, n, f.id); return n.id })
  return { doc, page, f: f.id, kids }
}
const boxOf = (doc: Document, id: string) => { const n = doc.nodes[id]; return [n.x, n.y, n.width, n.height] }

test('auto layout: places children with gap and padding, hugs content, aligns on the cross axis', () => {
  const { doc, f, kids } = row()
  const out = autoLayout(doc)
  expect(kids.map((k) => boxOf(out, k))).toEqual([[8, 5, 40, 20], [58, 5, 60, 30], [128, 5, 20, 10]])
  expect(boxOf(out, f).slice(2)).toEqual([8 + 40 + 10 + 60 + 10 + 20 + 6, 5 + 30 + 7])
  const c = autoLayout(row({ align: 'CENTER' }).doc), m = row({ align: 'MAX' })
  expect(Object.values(c.nodes).filter((n) => n.type === 'RECTANGLE').map((n) => n.y)).toEqual([10, 5, 15])
  expect(autoLayout(m.doc).nodes[m.kids[2]].y).toBe(25)
  const v = row({ mode: 'VERTICAL' }), vo = autoLayout(v.doc)
  expect(v.kids.map((k) => vo.nodes[k].y)).toEqual([5, 35, 75])
  expect(boxOf(vo, v.f).slice(2)).toEqual([8 + 60 + 6, 5 + 20 + 10 + 30 + 10 + 10 + 7])
  expect(autoLayout(out)).toBe(out) // settled layout changes nothing
})

test('auto layout: fill shares leftover space, hidden children are skipped, hug overrides fill', () => {
  const r = row({ hugW: false, hugH: false })
  let d = patch(r.doc, [r.kids[0]], { fillW: true, fillH: true })
  d = patch(d, [r.kids[2]], { visible: false })
  const out = autoLayout(d)
  expect(boxOf(out, r.kids[0])).toEqual([8, 5, 300 - 8 - 6 - 10 - 60, 100 - 5 - 7])
  expect(out.nodes[r.kids[1]].x).toBe(8 + 216 + 10)
  expect(boxOf(out, r.kids[2])).toEqual([500, 500, 20, 10])
  const hug = row()
  expect(autoLayout(patch(hug.doc, [hug.kids[0]], { fillW: true })).nodes[hug.kids[0]].width).toBe(40)
})

test('auto layout: a manual resize turns hug and fill off on that axis only', () => {
  const r = row()
  let d = resizeNode(autoLayout(r.doc), r.f, { x: 0, y: 0, width: 400, height: 42 })
  expect(d.nodes[r.f].layout).toMatchObject({ hugW: false, hugH: true })
  d = resizeNode(patch(d, [r.kids[0]], { fillW: true, fillH: true }), r.kids[0], { x: 8, y: 5, width: 40, height: 99 })
  expect(d.nodes[r.kids[0]]).toMatchObject({ fillW: true, fillH: false })
})

test('auto layout: adding it sorts children by position and reads gap and padding off the arrangement', () => {
  const { doc, frame, inner } = scene()
  let d = doc
  const n = makeNode('RECTANGLE', { x: 130, y: 10, width: 50, height: 50 }); d = insert(d, n, frame)
  const m = makeNode('RECTANGLE', { x: 70, y: 10, width: 50, height: 50 }); d = insert(d, m, frame)
  d = addAutoLayout(d, frame)
  expect(d.nodes[frame].layout).toEqual({ mode: 'HORIZONTAL', gap: 10, padding: [10, 20, 140, 10], align: 'MIN', hugW: true, hugH: true })
  expect(childrenOf(d, frame).map((k) => k.id)).toEqual([inner, m.id, n.id])
})

test('auto layout: Shift+A wraps the selection; dragging a child reorders it; dropping in slots it', () => {
  const { store, a, b } = open()
  store.set({ selection: [a, b] })
  COMMANDS.find((c) => c.id === 'add-auto-layout')!.run(store, { back() {}, openExport() {} })
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

// ── constraints ──────────────────────────────────────────────────────────────────────────────────────────────────────
function pinned(h: Constraint, v: Constraint = 'MIN', parent: Partial<Node> = {}) {
  let doc: Document = emptyDocument()
  const f = makeNode('FRAME', { x: 0, y: 0, width: 200, height: 100, ...parent })
  doc = insert(doc, f, doc.pages[0])
  const k = makeNode('RECTANGLE', { x: 20, y: 10, width: 40, height: 30, constraints: { h, v } })
  doc = insert(doc, k, f.id)
  return { doc, f: f.id, k: k.id }
}

test('constraints: children follow a frame resize per axis', () => {
  const grow = (h: Constraint, v: Constraint = 'MIN') => { const p = pinned(h, v); return boxOf(resizeNode(p.doc, p.f, { x: 0, y: 0, width: 300, height: 200 }), p.k) }
  expect(grow('MIN')).toEqual([20, 10, 40, 30])
  expect(grow('MAX')).toEqual([120, 10, 40, 30])
  expect(grow('CENTER')).toEqual([70, 10, 40, 30])
  expect(grow('STRETCH')).toEqual([20, 10, 140, 30])
  expect(grow('SCALE')).toEqual([30, 10, 60, 30])
  expect(grow('MIN', 'MAX')).toEqual([20, 110, 40, 30])
  expect(grow('MIN', 'SCALE')).toEqual([20, 20, 40, 60])
  const shrink = pinned('STRETCH')
  expect(resizeNode(shrink.doc, shrink.f, { x: 0, y: 0, width: 100, height: 100 }).nodes[shrink.k].width).toBe(0) // never negative
})

test('constraints: nested frames cascade; auto-layout frames ignore them; dragging the left edge keeps MIN glued to it', () => {
  const p = pinned('STRETCH')
  let d = patch(p.doc, [p.k], { type: 'FRAME' })
  const inner = makeNode('RECTANGLE', { x: 0, y: 0, width: 10, height: 10, constraints: { h: 'MAX', v: 'MIN' } })
  d = insert(d, inner, p.k)
  d = resizeNode(d, p.f, { x: 0, y: 0, width: 300, height: 100 })
  expect(d.nodes[inner.id].x).toBe(100)
  const l = pinned('MAX', 'MIN', { layout: { mode: 'HORIZONTAL', gap: 0, padding: [0, 0, 0, 0], align: 'MIN', hugW: false, hugH: false } })
  expect(resizeNode(l.doc, l.f, { x: 0, y: 0, width: 300, height: 100 }).nodes[l.k].x).toBe(20)
  const m = pinned('MIN')
  const { store } = open()
  store.update(() => m.doc)
  store.set({ pageId: m.doc.pages[0], selection: [m.f] })
  drag(store, at(0, 50), at(-50, 50)) // left handle
  const s = store.get().doc
  expect(s.nodes[m.f]).toMatchObject({ x: -50, width: 250 })
  expect(worldBox(s, [m.k])!.x).toBe(-30) // moved with the left edge
})

// ── components ───────────────────────────────────────────────────────────────────────────────────────────────────────
const red = solid(1, 0, 0), green = solid(0, 1, 0), blue = solid(0, 0, 1)
const run = (store: ReturnType<typeof open>['store'], id: string) => COMMANDS.find((c) => c.id === id)!.run(store, { back() {}, openExport() {} })
/** A main component (100×50) with one rectangle, and an instance of it made with "Create instance". */
function components() {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const m = makeNode('FRAME', { name: 'Button', x: 0, y: 0, width: 100, height: 50, component: true })
  const r = makeNode('RECTANGLE', { name: 'Bg', x: 10, y: 10, width: 20, height: 20, fills: [red] })
  doc = insert(insert(doc, m, page), r, m.id)
  const store = createEditorStore({ summary: { id: 'p1', name: 'P', modifiedAt: '', thumbnail: null }, document: doc, images: {} }, fakeApi().api)
  store.set({ selection: [m.id] })
  run(store, 'create-instance')
  const i = store.get().selection[0]
  const copy = () => childrenOf(store.get().doc, i)[0]
  return { store, page, m: m.id, r: r.id, i, copy }
}

test('components: an instance mirrors its main, and follows edits, added and removed children', () => {
  const { store, m, r, i, copy } = components()
  expect(store.get().doc.nodes[i]).toMatchObject({ instanceOf: m, name: 'Button', x: 140, width: 100, height: 50 })
  expect(copy()).toMatchObject({ ref: r, name: 'Bg', x: 10, fills: [red] })
  expect(copy().id).not.toBe(r)
  store.update((d) => patch(d, [r], { fills: [green] }))
  expect(copy().fills).toEqual([green])
  const extra = makeNode('ELLIPSE', { x: 50, y: 10, width: 10, height: 10 })
  store.update((d) => insert(d, extra, m))
  expect(childrenOf(store.get().doc, i).map((k) => k.ref)).toEqual([r, extra.id])
  store.update((d) => remove(d, [extra.id]))
  expect(childrenOf(store.get().doc, i).map((k) => k.ref)).toEqual([r])
  store.update((d) => resizeNode(d, m, { x: 0, y: 0, width: 120, height: 50 }))
  expect(store.get().doc.nodes[i].width).toBe(120)
  const s = store.get().doc
  expect(syncInstances(s, s)).toBe(s) // a settled document doesn't change
})

test('components: overrides survive main edits to the same field; reset and detach', () => {
  const { store, m, r, i, copy } = components()
  store.update((d) => patch(d, [copy().id], { fills: [blue] }))
  expect(copy().overrides).toEqual(['fills'])
  store.update((d) => patch(d, [r], { fills: [green], x: 30 }))
  expect(copy()).toMatchObject({ fills: [blue], x: 30 })
  store.set({ selection: [i] })
  run(store, 'reset-instance')
  expect(copy()).toMatchObject({ fills: [green] })
  expect(copy().overrides).toBeUndefined()
  run(store, 'detach-instance')
  store.update((d) => patch(d, [r], { fills: [red] }))
  expect(copy().fills).toEqual([green])
  expect(store.get().doc.nodes[i].instanceOf).toBeUndefined()
  expect(copy().ref).toBeUndefined()
  expect(store.get().doc.nodes[m].component).toBe(true)
})

test('components: a resized instance applies the main child constraints without recording them as overrides', () => {
  const { store, r, i, copy } = components()
  store.update((d) => patch(d, [r], { constraints: { h: 'MAX', v: 'MIN' } }))
  store.update((d) => resizeNode(d, i, { x: 140, y: 0, width: 150, height: 50 }))
  expect(copy().x).toBe(60)
  expect(copy().overrides).toBeUndefined()
  expect(store.get().doc.nodes[i].overrides).toEqual(['width'])
  store.update((d) => patch(d, [r], { y: 15 }))
  expect(copy()).toMatchObject({ x: 60, y: 15 })
})

test('components: nested instances sync; an instance inside its own main does not recurse', () => {
  const { store, m, r, i } = components()
  let outer = ''
  store.update((d) => {
    const a = makeNode('FRAME', { name: 'Card', x: 0, y: 300, width: 200, height: 100, component: true })
    const nested = makeNode('FRAME', { instanceOf: m, x: 10, y: 10 })
    outer = a.id
    return insert(insert(d, a, store.get().pageId), nested, a.id)
  })
  store.set({ selection: [outer] })
  run(store, 'create-instance')
  const cardInstance = store.get().selection[0], doc = () => store.get().doc
  const nestedCopy = childrenOf(doc(), cardInstance)[0]
  expect(nestedCopy.instanceOf).toBe(m)
  expect(childrenOf(doc(), nestedCopy.id)[0]).toMatchObject({ ref: r, fills: [red] })
  store.update((d) => patch(d, [r], { fills: [green] }))
  expect(childrenOf(doc(), childrenOf(doc(), cardInstance)[0].id)[0].fills).toEqual([green])

  const loop = makeNode('FRAME', { instanceOf: m, x: 0, y: 0 })
  store.update((d) => put(d, [{ ...loop, parentId: m, order: 'z' }]))
  expect(childrenOf(doc(), loop.id)).toEqual([])
  expect(childrenOf(doc(), i).length).toBe(2) // the plain instance now mirrors the (empty) nested one too
})

test('components: instances take no new children, their nodes stay put, copies out stop mirroring, orphans keep content', () => {
  const { store, page, m, i, copy } = components()
  const d0 = store.get().doc
  expect(moveTo(d0, [copy().id], page)).toBe(d0)
  const loose = makeNode('RECTANGLE', { x: 150, y: 10, width: 5, height: 5 })
  const d1 = insert(d0, loose, page)
  expect(moveTo(d1, [loose.id], i)).toBe(d1)
  expect(frameAt(d0, page, { x: 160, y: 20 })).toBe(page)
  store.update((d) => put(d, [{ ...copy(), id: 'pasted', parentId: page, order: 'z' }]))
  expect(store.get().doc.nodes.pasted.ref).toBeUndefined()
  store.update((d) => remove(d, [m]))
  expect(copy()).toMatchObject({ name: 'Bg', fills: [red] })
})

test('components: Ctrl+Alt+K wraps a selection into a component', () => {
  const { store, a, b } = open()
  store.set({ selection: [a, b] })
  expect(keyOf({ key: 'k', code: 'KeyK', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false })).toBe('Ctrl+Alt+K')
  run(store, 'create-component')
  const c = store.get().doc.nodes[store.get().selection[0]]
  expect(c).toMatchObject({ type: 'FRAME', component: true, name: 'Component 1' })
  expect(childrenOf(store.get().doc, c.id).map((k) => k.id)).toEqual([a, b])
})

// ── variants ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('variants: names parse into properties', () => {
  expect(variantProps('Size=Large, State = Hover')).toEqual({ Size: 'Large', State: 'Hover' })
  expect(variantProps('Button')).toEqual({})
  expect(variantProps('A=1,broken,B=2')).toEqual({ A: '1', B: '2' })
})

test('variants: combine wraps mains in a laid-out set; add variant copies the last one', () => {
  const { store, m } = components()
  store.set({ selection: [m] })
  run(store, 'combine-variants')
  const set = store.get().selection[0], doc = () => store.get().doc
  expect(doc().nodes[set]).toMatchObject({ componentSet: true, name: 'Button', layout: { mode: 'HORIZONTAL', gap: 20, padding: [20, 20, 20, 20] } })
  expect(doc().nodes[m].name).toBe('Property 1=Button')
  run(store, 'add-variant')
  const v2 = store.get().selection[0]
  expect(doc().nodes[v2]).toMatchObject({ component: true, parentId: set, name: 'Property 1=Variant 2', x: 20 + 100 + 20 })
  expect(variantsOf(doc(), set).map((v) => v.id)).toEqual([m, v2])
  expect(doc().nodes[set].width).toBe(20 + 100 + 20 + 100 + 20)
  store.set({ selection: [set] })
  run(store, 'create-instance')
  const fresh = doc().nodes[store.get().selection[0]]
  expect(fresh).toMatchObject({ instanceOf: m, name: 'Button', parentId: store.get().pageId })
})

test('variants: an instance switches variant, keeping overrides on layers with the same name and dropping missing ones', () => {
  const { store, m, i, copy } = components()
  store.set({ selection: [m] })
  run(store, 'combine-variants')
  run(store, 'add-variant')
  const v2 = store.get().selection[0], doc = () => store.get().doc
  const v2bg = childrenOf(doc(), v2)[0].id
  store.update((d) => patch(d, [v2bg], { fills: [green], cornerRadius: 8 }))
  const icon = makeNode('ELLIPSE', { name: 'Icon', x: 50, y: 10, width: 10, height: 10 })
  store.update((d) => insert(d, icon, m))
  expect(childrenOf(doc(), i)).toHaveLength(2)
  store.update((d) => patch(d, [copy().id], { opacity: 0.5 }))

  store.update((d) => setVariant(d, i, 'Property 1', 'Variant 2'))
  expect(doc().nodes[i].instanceOf).toBe(v2)
  expect(childrenOf(doc(), i)).toHaveLength(1) // v2 has no Icon
  expect(copy()).toMatchObject({ ref: v2bg, fills: [green], cornerRadius: 8, opacity: 0.5 })
  store.update((d) => setVariant(d, i, 'Property 1', 'Button'))
  expect(childrenOf(doc(), i).map((k) => k.name)).toEqual(['Bg', 'Icon'])
  expect(copy()).toMatchObject({ fills: [red], opacity: 0.5 })
  expect(setVariant(doc(), i, 'Property 1', 'Missing')).toBe(doc())
})

test('variants: switching one property keeps the others when such a variant exists', () => {
  const { store, m, i } = components()
  store.update((d) => patch(d, [m], { name: 'Size=S, Tone=Light' }))
  store.set({ selection: [m] })
  run(store, 'combine-variants')
  const set = store.get().selection[0]
  for (const name of ['Size=L, Tone=Light', 'Size=S, Tone=Dark', 'Size=L, Tone=Dark']) {
    store.set({ selection: [set] }); run(store, 'add-variant')
    store.update((d) => patch(d, [store.get().selection[0]], { name }))
  }
  const byName = (name: string) => variantsOf(store.get().doc, set).find((v) => v.name === name)!.id
  store.update((d) => setVariant(d, i, 'Tone', 'Dark'))
  expect(store.get().doc.nodes[i].instanceOf).toBe(byName('Size=S, Tone=Dark'))
  store.update((d) => setVariant(d, i, 'Size', 'L'))
  expect(store.get().doc.nodes[i].instanceOf).toBe(byName('Size=L, Tone=Dark'))
})

// ── gradients ────────────────────────────────────────────────────────────────────────────────────────────────────────
const black = { r: 0, g: 0, b: 0, a: 1 }
test('gradients: defaults, angle, rotation, conversion and interpolation', () => {
  const lin = gradient('LINEAR', black)
  expect(lin).toMatchObject({ from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, stops: [{ pos: 0, color: black }, { pos: 1, color: { ...black, a: 0 } }] })
  expect(gradientAngle(lin)).toBe(90)
  const turned = rotateGradient(lin, 0)
  near(turned.from.x, 0); near(turned.from.y, 0.5); near(turned.to.x, 1); near(turned.to.y, 0.5) // about the midpoint
  const rad = rotateGradient(gradient('RADIAL', black), 90)
  expect(rad.from).toEqual({ x: 0.5, y: 0.5 }); near(rad.to.x, 0.5); near(rad.to.y, 1) // about the centre
  expect(convertPaint(lin, 'SOLID')).toEqual({ type: 'SOLID', visible: true, color: black })
  expect(convertPaint({ type: 'SOLID', visible: false, color: black }, 'DIAMOND')).toMatchObject({ type: 'GRADIENT', kind: 'DIAMOND', visible: false, from: { x: 0.5, y: 0.5 } })
  const custom = { ...lin, stops: [{ pos: 0.2, color: black }, { pos: 0.8, color: { r: 1, g: 1, b: 1, a: 1 } }] }
  expect(convertPaint(custom, 'RADIAL')).toMatchObject({ kind: 'RADIAL', stops: custom.stops })
  const mid = colorAt(custom.stops, 0.5)
  near(mid.r, 0.5); near(mid.b, 0.5); expect(mid.a).toBe(1)
  expect(colorAt(custom.stops, 0)).toEqual(black)
  expect(colorAt(custom.stops, 1).r).toBe(1)
})

test('gradients: SVG export draws linear/radial in the scaled box, diamond as four quadrants, angular falls back', () => {
  const { doc, page } = scene()
  const add = (fills: Paint[], props: Partial<Node> = {}) => { const n = makeNode('RECTANGLE', { x: 0, y: 0, width: 200, height: 100, fills, ...props }); return { d: insert(doc, n, page), id: n.id } }
  const lin = add([gradient('LINEAR', { r: 1, g: 0, b: 0, a: 1 })])
  const svg = toSvg(lin.d, [lin.id], () => undefined)
  expect(svg).toContain('<linearGradient id="g1" gradientUnits="userSpaceOnUse" gradientTransform="scale(200 100)" x1="0.5" y1="0" x2="0.5" y2="1">')
  expect(svg).toContain('<stop offset="0" stop-color="rgb(255,0,0)" stop-opacity="1"/><stop offset="1" stop-color="rgb(255,0,0)" stop-opacity="0"/>')
  expect(svg).toContain('fill="url(#g1)"')
  const rad = add([gradient('RADIAL', black)])
  expect(toSvg(rad.d, [rad.id], () => undefined)).toContain('<radialGradient id="g1" gradientUnits="userSpaceOnUse" gradientTransform="scale(200 100)" cx="0.5" cy="0.5" fx="0.5" fy="0.5" r="0.5">')
  const dia = add([gradient('DIAMOND', black)])
  const dsvg = toSvg(dia.d, [dia.id], () => undefined)
  expect(dsvg.match(/<linearGradient /g)).toHaveLength(4)
  expect(dsvg.match(/<g clip-path=/g)).toHaveLength(4)
  const ang = add([], { strokes: [gradient('ANGULAR', { r: 0, g: 0, b: 1, a: 1 })], strokeWeight: 2 })
  expect(toSvg(ang.d, [ang.id], () => undefined)).toContain('stroke="rgb(0,0,255)" stroke-opacity="1"') // no conic in SVG: first stop
  const text = add([gradient('LINEAR', black)], { type: 'TEXT', characters: 'Hi', fontSize: 16, textAutoWidth: true })
  expect(toSvg(text.d, [text.id], () => undefined)).toMatch(/<text [^>]*fill="url\(#g1\)"/)
})

test('gradients: a gradient switched on in an instance is an override', () => {
  const { store, r, copy } = components()
  store.update((d) => patch(d, [copy().id], { fills: [convertPaint({ type: 'SOLID', visible: true, color: black }, 'LINEAR')] }))
  store.update((d) => patch(d, [r], { fills: [green] }))
  expect(copy().fills[0].type).toBe('GRADIENT')
  expect(copy().overrides).toEqual(['fills'])
})
