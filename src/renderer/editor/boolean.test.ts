// Boolean operations: live BOOLEAN nodes (union, subtract, intersect, exclude), their result paths and flatten.
import { expect, test } from 'vitest'
import { makeNode, solid } from '../../shared/document'
import { toSvg } from './export/svg'
import { bounds } from './model/geometry'
import { childrenOf, insert, patch, ungroup } from './model/ops'
import { anchorsOf, type Sub } from './model/path'
import { open, run } from './testkit'

/** Two overlapping 100×100 squares on the page: `p` at (0,0), `q` at (50,50) above it, both selected. */
function squares() {
  const o = open()
  const p = makeNode('RECTANGLE', { x: 0, y: 0, width: 100, height: 100, fills: [solid(1, 0, 0)] })
  const q = makeNode('RECTANGLE', { x: 50, y: 50, width: 100, height: 100, fills: [solid(0, 0, 1)] })
  o.store.update((d) => insert(insert(d, p, o.page), q, o.page))
  o.store.set({ selection: [p.id, q.id] })
  const boolean = () => o.store.get().doc.nodes[o.store.get().selection[0]]
  return { ...o, p, q, boolean }
}
const area = (subs: Sub[]) => subs.reduce((sum, s) => sum + Math.abs(s.anchors.reduce((a, p, i, all) => a + (p.x * all[(i + 1) % all.length].y - all[(i + 1) % all.length].x * p.y), 0)) / 2, 0)
const box = (subs: Sub[]) => bounds(subs.flatMap((s) => s.anchors))!

test('boolean: union, subtract, intersect and exclude combine the operands bottom to top', () => {
  const expected = {
    union: { area: 17500, box: [0, 0, 150, 150] },
    subtract: { area: 7500, box: [0, 0, 100, 100] },
    intersect: { area: 2500, box: [50, 50, 50, 50] },
    exclude: { area: 15000, box: [0, 0, 150, 150] },
  }
  for (const [command, want] of Object.entries(expected)) {
    const { store, boolean } = squares()
    run(store, command)
    const b = boolean(), subs = anchorsOf(b)
    expect(b.type).toBe('BOOLEAN')
    expect(area(subs)).toBeCloseTo(want.area, 3)
    expect([box(subs).x, box(subs).y, box(subs).w, box(subs).h]).toEqual(want.box)
    expect(b.fills).toEqual([solid(1, 0, 0)]) // the bottom operand's paint
  }
})

test('boolean: the result follows its operands and the operation, and one undo reverts an edit', () => {
  const { store, q, boolean } = squares()
  run(store, 'subtract')
  const id = boolean().id, d0 = boolean().vector!.fill[0].d
  store.update((d) => patch(d, [q.id], { x: 200, y: 200 })) // moved away: nothing overlaps
  expect(area(anchorsOf(store.get().doc.nodes[id]))).toBeCloseTo(10000, 3)
  expect(boolean().vector!.fill[0].d).not.toBe(d0)
  store.update((d) => patch(d, [id], { boolOp: 'UNION' }))
  expect(area(anchorsOf(store.get().doc.nodes[id]))).toBeCloseTo(20000, 3)
  store.undo()
  expect(store.get().doc.nodes[id].boolOp).toBe('SUBTRACT')
})

test('boolean: curves stay curves, hidden operands and text are ignored', () => {
  const { store, page, p, boolean } = squares()
  const e = makeNode('ELLIPSE', { x: 20, y: 20, width: 60, height: 60 })
  const t = makeNode('TEXT', { x: 10, y: 10, characters: 'Hi', width: 20, height: 19 })
  store.update((d) => insert(insert(d, e, page), t, page))
  store.set({ selection: [p.id, e.id, t.id] })
  run(store, 'subtract')
  expect(boolean().vector!.fill[0].d).toContain('C') // the ellipse's curves
  expect(anchorsOf(boolean())).toHaveLength(2) // the square and the hole the ellipse cut in it
  const id = boolean().id
  store.update((d) => patch(d, [e.id], { visible: false }))
  expect(anchorsOf(store.get().doc.nodes[id])).toHaveLength(1)
  expect(area(anchorsOf(store.get().doc.nodes[id]))).toBeCloseTo(10000, 3)
})

test('boolean: ungroup releases the operands; flatten keeps the result as a plain vector', () => {
  const { store, p, q, boolean } = squares()
  run(store, 'union')
  const id = boolean().id, path = boolean().vector!.fill[0].d
  expect(toSvg(store.get().doc, [id], () => undefined)).toContain('<path') // drawn from its result
  run(store, 'flatten')
  const flat = store.get().doc.nodes[id]
  expect(flat.type).toBe('VECTOR')
  expect(childrenOf(store.get().doc, id)).toHaveLength(0)
  expect(area(anchorsOf(flat))).toBeCloseTo(17500, 3)
  expect(store.get().doc.nodes[p.id]).toBeUndefined()
  expect(path).toBeTruthy()

  const again = squares()
  run(again.store, 'union')
  const freed = ungroup(again.store.get().doc, [again.boolean().id])
  expect(freed.ids.sort()).toEqual([again.p.id, again.q.id].sort())
  expect(q).toBeTruthy()
})

test('boolean: flatten turns several nodes into one vector and a lone rectangle into its outline', () => {
  const { store, boolean, p } = squares()
  run(store, 'flatten') // two selected
  expect(boolean().type).toBe('VECTOR')
  expect(area(anchorsOf(boolean()))).toBeCloseTo(17500, 3)
  store.set({ selection: [p.id] }) // gone with the union: nothing to flatten
  const lone = makeNode('RECTANGLE', { x: 300, y: 300, width: 40, height: 20 })
  store.update((d) => insert(d, lone, store.get().pageId))
  store.set({ selection: [lone.id] })
  run(store, 'flatten')
  expect(store.get().doc.nodes[lone.id].type).toBe('VECTOR')
  expect(area(anchorsOf(store.get().doc.nodes[lone.id]))).toBeCloseTo(800, 3)
})
