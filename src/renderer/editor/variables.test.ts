// Variables: binding, modes, detaching, instances and the .refig round trip.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readRefig, validateDocument, writeRefig, type Meta } from '../../main/format/refig'
import { FORMAT_VERSION } from '../../shared/document'
import { patch } from './model/ops'
import {
  addMode, bindVariable, createCollection, createVariable, createVariableFrom, deleteCollection, deleteMode, deleteVariable, setMode, setVariableValue, unbindVariable,
} from './model/variables'
import { components, open } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

const light = { r: 1, g: 1, b: 1, a: 1 }, dark = { r: 0, g: 0, b: 0, a: 1 }

/** A "Theme" collection with Light and Dark modes and a color variable `bg`, plus a number variable `r`: 4 in Light, 8 in Dark. */
function themed() {
  const t = open()
  const { store } = t
  store.update((d) => createCollection(d, 'Theme', 'c1', 'm1'))
  store.update((d) => addMode(d, 'c1', 'Dark', 'm2'))
  store.update((d) => createVariable(d, 'c1', 'COLOR', 'bg', light, 'v1'))
  store.update((d) => setVariableValue(d, 'v1', 'm2', dark))
  store.update((d) => createVariable(d, 'c1', 'NUMBER', 'r', 4, 'v2'))
  store.update((d) => setVariableValue(d, 'v2', 'm2', 8))
  return t
}
const fill = (t: ReturnType<typeof open>, id: string) => (t.store.get().doc.nodes[id].fills[0] as { color: unknown }).color

test('variables: a bound field takes the value, a new mode copies the first, and editing the variable moves every node', () => {
  const t = themed(), { store, a, b } = t
  store.update((d) => bindVariable(d, [a, b], 'fills.0.color', 'v1'))
  expect(fill(t, a)).toEqual(light)
  store.update((d) => setVariableValue(d, 'v1', 'm1', { ...light, g: 0.5 }))
  expect(fill(t, b)).toEqual({ ...light, g: 0.5 })
  store.update((d) => bindVariable(d, [a], 'cornerRadius', 'v2'))
  expect(store.get().doc.nodes[a].cornerRadius).toBe(4)
  // wrong type for the field, or an unknown field: nothing happens
  expect(bindVariable(store.get().doc, [a], 'cornerRadius', 'v1')).toBe(store.get().doc)
  expect(bindVariable(store.get().doc, [a], 'x', 'v2')).toBe(store.get().doc)
  expect(store.get().doc.collections[0].variables[0].values.m2).toEqual(dark)
})

test('variables: a mode set on a frame reaches everything inside; clearing it inherits again', () => {
  const t = themed(), { store, frame, inner } = t
  store.update((d) => bindVariable(d, [inner], 'fills.0.color', 'v1'))
  store.update((d) => setMode(d, [frame], 'c1', 'm2'))
  expect(fill(t, inner)).toEqual(dark)
  store.update((d) => setMode(d, [t.page], 'c1', 'm1')) // the nearest choice wins, so the frame's still applies
  expect(fill(t, inner)).toEqual(dark)
  store.update((d) => setMode(d, [frame], 'c1', undefined))
  expect(fill(t, inner)).toEqual(light)
  expect(store.get().doc.nodes[frame].modes).toBeUndefined()
  expect(setMode(store.get().doc, [frame], 'c1', 'nope')).toBe(store.get().doc)
})

test('variables: a hand edit unbinds the field; unbinding and deleting keep the look', () => {
  const t = themed(), { store, a, b } = t
  store.update((d) => bindVariable(d, [a, b], 'cornerRadius', 'v2'))
  store.update((d) => patch(d, [a], { cornerRadius: 12 }))
  expect(store.get().doc.nodes[a]).toMatchObject({ cornerRadius: 12 })
  expect(store.get().doc.nodes[a].bindings).toBeUndefined()
  expect(store.get().doc.nodes[b].cornerRadius).toBe(4)
  store.update((d) => unbindVariable(d, [b], 'cornerRadius'))
  store.update((d) => setVariableValue(d, 'v2', 'm1', 5))
  expect(store.get().doc.nodes[b].cornerRadius).toBe(4)
  store.update((d) => bindVariable(d, [b], 'cornerRadius', 'v2'))
  expect(store.get().doc.nodes[b].cornerRadius).toBe(5)
  store.update((d) => deleteVariable(d, 'v2'))
  expect(store.get().doc.nodes[b]).toMatchObject({ cornerRadius: 5 })
  expect(store.get().doc.nodes[b].bindings).toBeUndefined()
})

test('variables: deleting a mode or collection cleans up; a dangling binding is dropped', () => {
  const t = themed(), { store, a, frame } = t
  store.update((d) => bindVariable(d, [a], 'fills.0.color', 'v1'))
  store.update((d) => setMode(d, [frame], 'c1', 'm2'))
  store.update((d) => deleteMode(d, 'c1', 'm2'))
  expect(store.get().doc.nodes[frame].modes).toBeUndefined()
  expect(Object.keys(store.get().doc.collections[0].variables[0].values)).toEqual(['m1'])
  expect(deleteMode(store.get().doc, 'c1', 'm1')).toBe(store.get().doc) // the last mode stays
  store.update((d) => patch(d, [a], { bindings: { 'fills.0.color': 'gone' } }))
  expect(store.get().doc.nodes[a].bindings).toBeUndefined()
  store.update((d) => bindVariable(d, [a], 'fills.0.color', 'v1'))
  store.update((d) => deleteCollection(d, 'c1'))
  expect(store.get().doc.collections).toEqual([])
  expect(store.get().doc.nodes[a].bindings).toBeUndefined()
  expect(fill(t, a)).toEqual(light)
})

test('variables: create from a node field, and undo', () => {
  const t = themed(), { store, a } = t
  store.update((d) => createVariableFrom(d, 'c1', a, 'cornerRadius', 'Radius', 'v3'))
  expect(store.get().doc.collections[0].variables.at(-1)).toMatchObject({ id: 'v3', type: 'NUMBER', values: { m1: 0, m2: 0 } })
  expect(store.get().doc.nodes[a].bindings).toEqual({ cornerRadius: 'v3' })
  store.undo()
  expect(store.get().doc.nodes[a].bindings).toBeUndefined()
  expect(store.get().doc.collections[0].variables.map((v) => v.id)).toEqual(['v1', 'v2'])
})

test('variables: an instance follows its main, and takes its own mode', () => {
  const { store, r, i, copy } = components()
  store.update((d) => createCollection(d, 'Theme', 'c1', 'm1'))
  store.update((d) => addMode(d, 'c1', 'Dark', 'm2'))
  store.update((d) => createVariable(d, 'c1', 'COLOR', 'bg', light, 'v1'))
  store.update((d) => setVariableValue(d, 'v1', 'm2', dark))
  store.update((d) => bindVariable(d, [r], 'fills.0.color', 'v1'))
  expect((copy().fills[0] as { color: unknown }).color).toEqual(light)
  store.update((d) => setMode(d, [i], 'c1', 'm2')) // only this instance goes dark
  expect((copy().fills[0] as { color: unknown }).color).toEqual(dark)
  expect((store.get().doc.nodes[r].fills[0] as { color: unknown }).color).toEqual(light)
})

const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }

test('variables: the .refig round trip keeps them, old files get none, bad ones are rejected', () => {
  const t = themed(), { store, a, frame } = t
  store.update((d) => bindVariable(d, [a], 'fills.0.color', 'v1'))
  store.update((d) => setMode(d, [frame], 'c1', 'm2'))
  const doc = store.get().doc
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const { collections: _c, ...old } = doc
  const nodes = Object.fromEntries(Object.entries(doc.nodes).map(([k, n]) => [k, { ...n, bindings: undefined, modes: undefined }]))
  expect(validateDocument({ ...old, formatVersion: 12, nodes }).collections).toEqual([])
  const [c] = doc.collections, [v1, v2] = c.variables
  expect(() => validateDocument({ ...doc, collections: [doc.collections[0], doc.collections[0]] })).toThrow(/collections\.1\.id/)
  expect(() => validateDocument({ ...doc, collections: [{ ...c, modes: [] }] })).toThrow(/modes/)
  expect(() => validateDocument({ ...doc, collections: [{ ...c, variables: [{ ...v1, values: { m1: light } }, v2] }] })).toThrow(/values/)
  expect(() => validateDocument({ ...doc, collections: [{ ...c, variables: [{ ...v1, type: 'NOPE' }, v2] }] })).toThrow(/type/)
  expect(() => validateDocument({ ...doc, collections: [] })).toThrow(/no such (variable|mode)/)
  expect(() => validateDocument({ ...doc, collections: [{ ...c, modes: [c.modes[0], { id: 'm3', name: 'X' }], variables: [] }] })).toThrow(/no such (variable|mode)/)
})
