// Libraries: copying another document's components, styles and variables, and updating the copies.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { validateDocument } from '../../../main/format/refig'
import { makeNode, type Document } from '../../../shared/document'
import { childrenOf, put } from './ops'
import { importFromLibrary, libraryImages, removeLibrary } from './library'
import { createStyle } from './styles'
import { addMode, bindVariable, createCollection, createVariable, setVariableValue } from './variables'
import { components, open, run } from '../testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

const P = '11111111-1111-1111-1111-111111111111'
const green = { r: 0, g: 1, b: 0, a: 1 }

/** A library document: Button (with Bg bound to a style and to a variable) and an instance of it that lives outside any component. */
function library() {
  const c = components()
  const { store, r, m } = c
  store.update((d) => createStyle(d, r, 'fillStyle', 'Brand', 's1'))
  store.update((d) => createCollection(d, 'Theme', 'c1', 'm1'))
  store.update((d) => addMode(d, 'c1', 'Dark', 'm2'))
  store.update((d) => createVariable(d, 'c1', 'NUMBER', 'radius', 4, 'v1'))
  store.update((d) => setVariableValue(d, 'v1', 'm2', 8))
  store.update((d) => bindVariable(d, [r], 'cornerRadius', 'v1'))
  return { ...c, doc: () => store.get().doc, main: m }
}
const consumer = () => open()
const bg = (doc: Document, mainId: string) => childrenOf(doc, mainId)[0]

test('import copies the component under a library page, with fresh ids, its style and its variable', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const doc = t.store.get().doc
  const l = doc.libraries[0]
  expect(l).toMatchObject({ projectId: P, name: 'Kit' })
  const mainLocal = doc.nodes[l.links[lib.main]]
  expect(mainLocal).toMatchObject({ name: 'Button', component: true })
  expect(l.links[lib.main]).not.toBe(lib.main)
  expect(doc.nodes[mainLocal.parentId!]).toMatchObject({ type: 'PAGE', name: 'Library: Kit' })
  expect(doc.pages).toContain(mainLocal.parentId)
  const child = bg(doc, mainLocal.id)
  expect(child.fillStyle).toBe(l.links.s1)
  expect(doc.styles.find((s) => s.id === l.links.s1)?.name).toBe('Brand')
  expect(child.bindings).toEqual({ cornerRadius: l.links.v1 })
  const col = doc.collections.find((c) => c.id === l.links.c1)!
  expect(col.modes.map((m) => m.id)).toEqual([l.links.m1, l.links.m2])
  expect(col.variables[0].values).toEqual({ [l.links.m1]: 4, [l.links.m2]: 8 })
  expect(() => validateDocument(doc)).not.toThrow() // links to styles and variables resolve
})

test('a second import changes nothing: no duplicates', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const once = t.store.get().doc
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const twice = t.store.get().doc
  expect(Object.keys(twice.nodes).sort()).toEqual(Object.keys(once.nodes).sort())
  expect(twice.styles).toHaveLength(1)
  expect(twice.collections).toHaveLength(1)
  expect(twice.libraries).toHaveLength(1)
  expect(twice.libraries[0].links).toEqual(once.libraries[0].links)
})


test('update: library edits arrive in the copy and in its instances', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const mainId = t.store.get().doc.libraries[0].links[lib.main]
  t.store.update((d) => ({ ...d, nodes: { ...d.nodes, [mainId]: { ...d.nodes[mainId], x: 321 } } }))
  t.store.set({ selection: [mainId] })
  run(t.store, 'create-instance')
  const inst = t.store.get().selection[0]
  // the library changes: Bg gets wider and the style turns green
  lib.store.update((d) => ({ ...d, nodes: { ...d.nodes, [lib.r]: { ...d.nodes[lib.r], width: 77 } }, styles: d.styles.map((s) => (s.id === 's1' ? { ...s, value: [{ type: 'SOLID', visible: true, color: green }] } : s)) }) as Document)
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const doc = t.store.get().doc
  expect(bg(doc, mainId).width).toBe(77)
  expect(doc.nodes[mainId].x).toBe(321)
  expect(bg(doc, inst).width).toBe(77) // the instance follows through the usual sync
  expect((bg(doc, mainId).fills[0] as { color: unknown }).color).toEqual(green)
})

test('update deletes copies of components the library dropped, and keeps the link when everything is gone', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const mainId = t.store.get().doc.libraries[0].links[lib.main]
  const emptied = { ...lib.doc(), nodes: Object.fromEntries(Object.entries(lib.doc().nodes).filter(([, n]) => n.type === 'PAGE')) } as Document
  t.store.update((d) => importFromLibrary(d, P, 'Kit', emptied))
  const doc = t.store.get().doc
  expect(doc.nodes[mainId]).toBeUndefined()
  expect(doc.libraries).toHaveLength(1)
})

/** A user's own node on the first page, linked to the library's style, variable and mode. */
function withUserNode(t: ReturnType<typeof consumer>, links: Record<string, string>) {
  const l = links
  t.store.update((d) => put(d, [makeNode('RECTANGLE', { id: 'mine', parentId: d.pages[0], fillStyle: l.s1, bindings: { cornerRadius: l.v1 }, modes: { [l.c1]: l.m2 } })]))
}

test('update unlinks the user\'s nodes from a style and collection the library dropped, so the project still validates', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  withUserNode(t, t.store.get().doc.libraries[0].links)
  lib.store.update((d) => ({ ...d, styles: [], collections: [], nodes: Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, { ...n, fillStyle: undefined, bindings: undefined }])) }) as Document)
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const doc = t.store.get().doc
  expect(doc.nodes.mine.fillStyle).toBeUndefined()
  expect(doc.nodes.mine.bindings).toBeUndefined()
  expect(doc.nodes.mine.modes).toBeUndefined()
  expect(doc.styles).toEqual([])
  expect(doc.collections).toEqual([])
  expect(() => validateDocument(doc)).not.toThrow()
})

test('update unbinds the user\'s nodes from a variable and mode the library removed from a kept collection', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  withUserNode(t, t.store.get().doc.libraries[0].links)
  lib.store.update((d) => createVariable(d, 'c1', 'NUMBER', 'gap', 1, 'v2')) // keeps c1 in use
  lib.store.update((d) => ({ ...d, collections: d.collections.map((c) => ({ ...c, modes: c.modes.filter((m) => m.id !== 'm2'), variables: c.variables.filter((v) => v.id !== 'v1').map((v) => ({ ...v, values: { m1: 1 } })) })) }) as Document)
  lib.store.update((d) => bindVariable(d, [lib.r], 'cornerRadius', 'v2'))
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const doc = t.store.get().doc
  expect(doc.nodes.mine.bindings).toBeUndefined()
  expect(doc.nodes.mine.modes).toBeUndefined()
  expect(() => validateDocument(doc)).not.toThrow()
})

test('a collection no component uses for a while keeps its variable and mode ids, so the user\'s bindings survive', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  withUserNode(t, t.store.get().doc.libraries[0].links)
  const unbound = lib.doc()
  lib.store.update((d) => ({ ...d, nodes: Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, { ...n, bindings: undefined }])) }) as Document)
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc())) // c1 unused now
  t.store.update((d) => importFromLibrary(d, P, 'Kit', unbound)) // and used again
  const doc = t.store.get().doc
  expect(doc.nodes.mine.bindings).toEqual({ cornerRadius: doc.libraries[0].links.v1 })
  expect(() => validateDocument(doc)).not.toThrow()
})

test('update detaches the user\'s instances of a dropped component and follows a renamed project in the page name', () => {
  const lib = library(), t = consumer()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const mainId = t.store.get().doc.libraries[0].links[lib.main], pageId = t.store.get().doc.libraries[0].links.page
  t.store.set({ selection: [mainId] })
  run(t.store, 'create-instance')
  const inst = t.store.get().selection[0]
  t.store.update((d) => put(d, [{ ...d.nodes[inst], parentId: d.pages[0] }])) // the user's own instance, on their page
  const emptied = { ...lib.doc(), nodes: Object.fromEntries(Object.entries(lib.doc().nodes).filter(([, n]) => n.type === 'PAGE')) } as Document
  t.store.update((d) => importFromLibrary(d, P, 'Kit 2', emptied))
  const doc = t.store.get().doc
  expect(doc.nodes[inst].instanceOf).toBeUndefined()
  expect(childrenOf(doc, inst)).toHaveLength(1) // keeps its content
  expect(doc.nodes[pageId].name).toBe('Library: Kit 2')
  expect(() => validateDocument(doc)).not.toThrow()
})

test('libraryImages lists only the images the copied components use', () => {
  const lib = library()
  const img = (hash: string) => [{ type: 'IMAGE', visible: true, hash } as never]
  lib.store.update((d) => ({ ...d, nodes: { ...d.nodes, [lib.r]: { ...d.nodes[lib.r], fills: img('a'.repeat(64)) } } }))
  lib.store.update((d) => put(d, [makeNode('RECTANGLE', { id: 'loose', parentId: d.pages[0], fills: img('b'.repeat(64)) })]))
  expect([...libraryImages(lib.doc())]).toEqual(['a'.repeat(64)])
})

test('importing a project without components fails; removeLibrary unlinks and keeps the copies', () => {
  const t = consumer()
  expect(() => importFromLibrary(t.store.get().doc, P, 'Empty', t.store.get().doc)).toThrow(/no components/)
  const lib = library()
  t.store.update((d) => importFromLibrary(d, P, 'Kit', lib.doc()))
  const mainId = t.store.get().doc.libraries[0].links[lib.main]
  t.store.update((d) => removeLibrary(d, P))
  expect(t.store.get().doc.libraries).toEqual([])
  expect(t.store.get().doc.nodes[mainId]).toBeDefined()
})
