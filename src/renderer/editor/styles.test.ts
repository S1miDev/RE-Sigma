// Styles: linking, propagation, detaching, components and the .refig round trip.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readRefig, validateDocument, writeRefig, type Meta } from '../../main/format/refig'
import { FORMAT_VERSION, makeNode } from '../../shared/document'
import { insert, patch } from './model/ops'
import { applyStyle, createStyle, deleteStyle, detachStyle, renameStyle, updateStyleFrom } from './model/styles'
import { blue, components, green, open, red } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('styles: a style copies onto linked nodes, and editing it moves them all', () => {
  const { store, a, b } = open()
  store.update((d) => createStyle(d, a, 'fillStyle', 'Brand', 's1'))
  expect(store.get().doc.styles).toEqual([{ id: 's1', name: 'Brand', kind: 'FILL', value: [red] }])
  store.update((d) => applyStyle(d, [b], 's1', 'fillStyle'))
  store.update((d) => patch(d, [a], { fills: [green] }))
  expect(store.get().doc.nodes[a].fillStyle).toBeUndefined() // a hand edit detaches
  expect(store.get().doc.nodes[a].fills).toEqual([green])
  expect(store.get().doc.nodes[b].fills).toEqual([red])
  store.update((d) => updateStyleFrom(d, 's1', a, 'fillStyle')) // a is detached now, so it only supplies a look
  expect(store.get().doc.nodes[b].fills).toEqual([green])
  expect(store.get().doc.nodes[b].fillStyle).toBe('s1')
})

test('styles: effect and text styles, and renaming', () => {
  const { store, page } = open()
  const t = makeNode('TEXT', { characters: 'Hi', fontSize: 20, fontWeight: 700 }), u = makeNode('TEXT', { characters: 'Yo' })
  store.update((d) => insert(insert(d, t, page), u, page))
  store.update((d) => createStyle(d, t.id, 'textStyle', 'Head', 't1'))
  store.update((d) => applyStyle(d, [u.id], 't1', 'textStyle'))
  expect(store.get().doc.nodes[u.id]).toMatchObject({ fontSize: 20, fontWeight: 700 })
  store.update((d) => updateStyleFrom(d, 't1', t.id, 'textStyle'))
  store.update((d) => patch(d, [t.id], { fontSize: 30 })) // detaches t
  store.update((d) => updateStyleFrom(d, 't1', t.id, 'textStyle'))
  expect(store.get().doc.nodes[u.id].fontSize).toBe(30)
  const fx = { type: 'LAYER_BLUR' as const, visible: true, blur: 3 }
  store.update((d) => patch(d, [t.id], { effects: [fx] }))
  store.update((d) => createStyle(d, t.id, 'effectStyle', 'Soft', 'e1'))
  store.update((d) => applyStyle(d, [u.id], 'e1', 'effectStyle'))
  expect(store.get().doc.nodes[u.id].effects).toEqual([fx])
  expect(applyStyle(store.get().doc, [u.id], 'e1', 'fillStyle')).toBe(store.get().doc) // wrong kind is refused
  store.update((d) => renameStyle(d, 'e1', 'Blurry'))
  expect(store.get().doc.styles.find((s) => s.id === 'e1')!.name).toBe('Blurry')
})

test('styles: delete and detach keep the look; a dangling link is dropped', () => {
  const { store, a, b } = open()
  store.update((d) => createStyle(d, a, 'fillStyle', 'S', 's1'))
  store.update((d) => applyStyle(d, [b], 's1', 'fillStyle'))
  store.update((d) => detachStyle(d, [b], 'fillStyle'))
  expect(store.get().doc.nodes[b]).toMatchObject({ fills: [red] })
  expect(store.get().doc.nodes[b].fillStyle).toBeUndefined()
  store.update((d) => deleteStyle(d, 's1'))
  expect(store.get().doc.styles).toEqual([])
  expect(store.get().doc.nodes[a].fillStyle).toBeUndefined()
  expect(store.get().doc.nodes[a].fills).toEqual([red])
  store.update((d) => patch(d, [a], { fillStyle: 'gone' }))
  expect(store.get().doc.nodes[a].fillStyle).toBeUndefined()
})

test('styles: undo restores the styles list', () => {
  const { store, a } = open()
  store.update((d) => createStyle(d, a, 'fillStyle', 'S', 's1'))
  store.undo()
  expect(store.get().doc.styles).toEqual([])
  expect(store.get().doc.nodes[a].fillStyle).toBeUndefined()
})

test('styles: instances follow a style used in their main, and can relink on their own', () => {
  const { store, page, r, copy } = components()
  const x = makeNode('RECTANGLE', { width: 5, height: 5, fills: [blue] }), y = makeNode('RECTANGLE', { width: 5, height: 5, fills: [green] })
  store.update((d) => insert(insert(d, x, page), y, page))
  store.update((d) => createStyle(d, r, 'fillStyle', 'S', 's1'))
  store.update((d) => updateStyleFrom(d, 's1', x.id, 'fillStyle'))
  expect(store.get().doc.nodes[r].fills).toEqual([blue])
  expect(copy().fills).toEqual([blue])
  // the instance node takes another style; the main is untouched
  store.update((d) => createStyle(d, y.id, 'fillStyle', 'T', 's2'))
  store.update((d) => applyStyle(d, [copy().id], 's2', 'fillStyle'))
  expect(copy()).toMatchObject({ fills: [green], fillStyle: 's2' })
  expect(copy().overrides).toEqual(expect.arrayContaining(['fillStyle', 'fills']))
  expect(store.get().doc.nodes[r].fills).toEqual([blue])
  store.update((d) => updateStyleFrom(d, 's1', y.id, 'fillStyle')) // the main's style changes; the instance keeps its own
  expect(copy().fills).toEqual([green])
})

const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }

test('styles: the .refig round trip keeps them, old files get none, bad ones are rejected', () => {
  const { store, a } = open()
  store.update((d) => createStyle(d, a, 'fillStyle', 'S', 's1'))
  const doc = store.get().doc
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const { styles: _s, ...old } = doc
  const nodes = Object.fromEntries(Object.entries(doc.nodes).map(([k, n]) => [k, { ...n, fillStyle: undefined }]))
  expect(validateDocument({ ...old, formatVersion: 11, nodes }).styles).toEqual([])
  expect(() => validateDocument({ ...doc, styles: [{ ...doc.styles[0], kind: 'NOPE' }] })).toThrow(/kind/)
  expect(() => validateDocument({ ...doc, styles: [doc.styles[0], doc.styles[0]] })).toThrow(/styles\.1\.id/)
  expect(() => validateDocument({ ...doc, styles: [] })).toThrow(/no such style/)
})
