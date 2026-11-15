// Rulers, guides, pixel grid view state, layout grids and grid styles.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readRefig, validateDocument, writeRefig, type Meta } from '../../main/format/refig'
import { FORMAT_VERSION, makeNode, type LayoutGrid } from '../../shared/document'
import { guideAt, RULER, tickStep } from './canvas/aids'
import { drawOverlay } from './canvas/overlay'
import { runCommand } from './commands'
import { childrenOf, insert, patch } from './model/ops'
import { applyStyle, createStyle, updateStyleFrom } from './model/styles'
import { at, drag, open } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

const guides = (store: ReturnType<typeof open>['store']) => store.get().doc.nodes[store.get().pageId].guides

test('ruler ticks step by 1, 2 or 5 powers of ten and stay apart', () => {
  expect(tickStep(1)).toBe(100)
  expect(tickStep(2)).toBe(50)
  expect(tickStep(0.1)).toBe(1000)
  for (const z of [0.02, 0.3, 1, 7, 256]) expect(tickStep(z) * z).toBeGreaterThanOrEqual(60)
})

test('guides: drag from a ruler makes one, drag it to move, back into the ruler to delete; undo restores', () => {
  const { store } = open()
  drag(store, at(100, 5), at(100, 5)) // rulers hidden: an ordinary click on the canvas
  expect(guides(store)).toBeUndefined()
  runCommand(store, 'toggle-rulers')
  drag(store, at(100, 5), at(100, 5), at(120, 250)) // top ruler: a horizontal guide
  expect(guides(store)).toEqual([{ axis: 'y', pos: 250 }])
  drag(store, at(5, 100), at(300, 100)) // left ruler: a vertical one
  expect(guides(store)).toEqual([{ axis: 'y', pos: 250 }, { axis: 'x', pos: 300 }])
  expect(guideAt(store.get(), { x: 600, y: 252 })).toBe(0)
  expect(guideAt(store.get(), { x: 600, y: 270 })).toBe(-1)
  drag(store, at(600, 251), at(600, 400)) // grab the first guide
  expect(guides(store)![0]).toEqual({ axis: 'y', pos: 400 })
  drag(store, at(600, 400), at(600, 5)) // back into the top ruler
  expect(guides(store)).toEqual([{ axis: 'x', pos: 300 }])
  store.undo()
  expect(guides(store)).toHaveLength(2)
  store.undo()
  expect(guides(store)).toEqual([{ axis: 'y', pos: 250 }, { axis: 'x', pos: 300 }])
  expect(RULER).toBeGreaterThan(0)
})

test('guides: dragged layers snap to them, unless guides are hidden', () => {
  const { store, a } = open()
  store.update((d) => patch(d, [store.get().pageId], { guides: [{ axis: 'y', pos: 330 }] }))
  drag(store, at(420, 20), at(420, 20), at(420, 353)) // a's top edge would land on 333
  expect(store.get().doc.nodes[a].y).toBe(330)
  store.undo()
  runCommand(store, 'toggle-guides')
  drag(store, at(420, 20), at(420, 20), at(420, 353))
  expect(store.get().doc.nodes[a].y).toBe(333)
})

test('view toggles: rulers, pixel grid, guides, layout grids', () => {
  const { store } = open()
  expect(store.get()).toMatchObject({ rulers: false, pixelGrid: true, guidesVisible: true, layoutGridsVisible: true })
  for (const id of ['toggle-rulers', 'toggle-pixel-grid', 'toggle-guides', 'toggle-layout-grids']) runCommand(store, id)
  expect(store.get()).toMatchObject({ rulers: true, pixelGrid: false, guidesVisible: false, layoutGridsVisible: false })
})

const cols: LayoutGrid = { kind: 'COLUMNS', size: 8, count: 4, gutter: 10, margin: 5, color: { r: 1, g: 0, b: 0, a: 0.1 } }

test('grid styles: a style copies grids onto linked frames and follows edits', () => {
  const { store, frame, page } = open()
  const other = makeNode('FRAME', { x: 0, y: 500, width: 100, height: 100 })
  store.update((d) => insert(d, other, page))
  store.update((d) => patch(d, [frame], { layoutGrids: [cols] }))
  store.update((d) => createStyle(d, frame, 'gridStyle', 'Cols', 'g1'))
  expect(store.get().doc.styles).toEqual([{ id: 'g1', name: 'Cols', kind: 'GRID', value: [cols] }])
  store.update((d) => applyStyle(d, [other.id], 'g1', 'gridStyle'))
  expect(store.get().doc.nodes[other.id].layoutGrids).toEqual([cols])
  expect(applyStyle(store.get().doc, [other.id], 'g1', 'fillStyle')).toBe(store.get().doc) // wrong kind refused
  const rows = { ...cols, kind: 'ROWS' as const }
  store.update((d) => patch(d, [frame], { layoutGrids: [rows] })) // hand edit detaches the frame
  expect(store.get().doc.nodes[frame].gridStyle).toBeUndefined()
  store.update((d) => updateStyleFrom(d, 'g1', frame, 'gridStyle'))
  expect(store.get().doc.nodes[other.id].layoutGrids).toEqual([rows])
})

const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }

test('.refig: guides, layout grids and grid styles round trip; bad ones are rejected', () => {
  const { store, frame, page } = open()
  store.update((d) => patch(d, [page], { guides: [{ axis: 'x', pos: 12.5 }, { axis: 'y', pos: -4 }] }))
  store.update((d) => patch(d, [frame], { layoutGrids: [cols, { ...cols, kind: 'GRID' }] }))
  store.update((d) => createStyle(d, frame, 'gridStyle', 'G', 'g1'))
  const doc = store.get().doc
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (id: string, change: object) => ({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...change } } })
  expect(() => validateDocument(bad(page, { guides: [{ axis: 'z', pos: 1 }] }))).toThrow(/guides/)
  expect(() => validateDocument(bad(page, { guides: [{ axis: 'x', pos: 'a' }] }))).toThrow(/guides/)
  expect(() => validateDocument(bad(frame, { layoutGrids: [{ ...cols, count: 0 }] }))).toThrow(/layoutGrids/)
  expect(() => validateDocument(bad(frame, { gridStyle: 'nope' }))).toThrow(/no such style/)
  expect(() => validateDocument({ ...doc, styles: [{ ...doc.styles[0], value: [{ kind: 'X' }] }] })).toThrow(/styles\.0\.value/)
})

test('the overlay draws rulers, guides, pixel grid and layout grids without errors', () => {
  const { store, frame, page } = open()
  store.update((d) => patch(patch(d, [frame], { layoutGrids: [cols, { ...cols, kind: 'ROWS' }, { ...cols, kind: 'GRID', size: 10 }] }), [page], { guides: [{ axis: 'x', pos: 5 }, { axis: 'y', pos: 9 }] }))
  store.set({ rulers: true, selection: [frame], overlay: { guide: { axis: 'x', pos: 5 } } })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, { get: (t, k) => (k in t ? (t as never)[k] : (...a: unknown[]) => void calls.push(`${String(k)}:${a.length}`)), set: () => true }) as unknown as CanvasRenderingContext2D
  for (const zoom of [1, 16]) {
    store.set({ view: { x: 0, y: 0, zoom } })
    calls.length = 0
    drawOverlay(ctx, store.get(), 1)
    expect(calls.filter((c) => c.startsWith('fillText')).length).toBeGreaterThan(0) // ruler labels
  }
})

test('drawing the overlay leaves the page children intact (it once emptied the cached list, blanking the canvas)', () => {
  const { store, page } = open()
  const before = childrenOf(store.get().doc, page).length
  expect(before).toBeGreaterThan(0)
  const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, { get: (t, k) => (k in t ? (t as never)[k] : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
  drawOverlay(ctx, store.get(), 1)
  drawOverlay(ctx, store.get(), 1)
  expect(childrenOf(store.get().doc, page).length).toBe(before)
})
