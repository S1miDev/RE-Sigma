// Shared fixtures for the editor's tests: a small scene, an open store with a fake API, pointer drags.
import { expect, vi } from 'vitest'
import type { RefigApi } from '../../shared/api'
import { emptyDocument, makeNode, solid, type AutoLayout, type Constraint, type Document, type Node, type NodeType } from '../../shared/document'
import { runCommand } from './commands'
import { childrenOf, insert } from './model/ops'
import { createEditorStore, type EditorStore, type Mode } from './store'
import { beginGesture, type Pointer } from './tools'

export const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
export function scene() {
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
export const names = (doc: Document, parent: string) => childrenOf(doc, parent).map((n) => n.id)
export function fakeApi(over: Partial<RefigApi> = {}) {
  const saveProject = vi.fn(async (id: string) => ({ id, name: 'P', modifiedAt: '', thumbnail: null }))
  return { api: { saveProject, addImage: vi.fn(async () => 'h'.repeat(64)), ...over } as unknown as RefigApi, saveProject }
}
export function open(over: Partial<RefigApi> = {}) {
  const s = scene(), f = fakeApi(over)
  const store = createEditorStore({ summary: { id: 'p1', name: 'P', modifiedAt: '', thumbnail: null }, document: s.doc, images: {} }, f.api)
  return { ...s, ...f, store }
}
export const at = (x: number, y: number, mods: Partial<Pointer> = {}): Pointer => ({ screen: { x, y }, world: { x, y }, shift: false, alt: false, ctrl: false, ...mods })
export function drag(store: ReturnType<typeof open>['store'], from: Pointer, ...to: Pointer[]) {
  const g = beginGesture(store, from)
  for (const p of to) g?.move(p)
  g?.up(to.at(-1) ?? from)
}
export function row(layout: Partial<AutoLayout> = {}, sizes: [number, number][] = [[40, 20], [60, 30], [20, 10]]) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const f = makeNode('FRAME', { x: 0, y: 0, width: 300, height: 100, layout: { mode: 'HORIZONTAL', gap: 10, padding: [5, 6, 7, 8], align: 'MIN', hugW: true, hugH: true, ...layout } })
  doc = insert(doc, f, page)
  const kids = sizes.map(([width, height]) => { const n = makeNode('RECTANGLE', { x: 500, y: 500, width, height }); doc = insert(doc, n, f.id); return n.id })
  return { doc, page, f: f.id, kids }
}
export const boxOf = (doc: Document, id: string) => { const n = doc.nodes[id]; return [n.x, n.y, n.width, n.height] }
export function pinned(h: Constraint, v: Constraint = 'MIN', parent: Partial<Node> = {}) {
  let doc: Document = emptyDocument()
  const f = makeNode('FRAME', { x: 0, y: 0, width: 200, height: 100, ...parent })
  doc = insert(doc, f, doc.pages[0])
  const k = makeNode('RECTANGLE', { x: 20, y: 10, width: 40, height: 30, constraints: { h, v } })
  doc = insert(doc, k, f.id)
  return { doc, f: f.id, k: k.id }
}
export const red = solid(1, 0, 0), green = solid(0, 1, 0), blue = solid(0, 0, 1)
export const run = runCommand
/** A main component (100×50) with one rectangle, and an instance of it made with "Create instance". */
export function components() {
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
export const black = { r: 0, g: 0, b: 0, a: 1 }
export const penMode = (store: EditorStore) => store.get().mode as Extract<Mode, { kind: 'pen' }>
