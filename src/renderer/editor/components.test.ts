// Components, instances and variants.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { convertPaint, makeNode } from '../../shared/document'
import { frameAt } from './canvas/hit'
import { keyOf } from './commands'
import { worldBox } from './model/geometry'
import { childrenOf, insert, moveTo, patch, put, remove, resizeNode } from './model/ops'
import { setVariant, syncInstances, variantProps, variantsOf } from './model/components'
import { beginGesture } from './tools'
import { open, at, red, run, components, black, green, blue } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

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

test('components: an instance of a main holding a boolean follows its operands', () => {
  const { store, page, m, r, i } = components()
  const extra = makeNode('RECTANGLE', { x: 15, y: 15, width: 40, height: 20, fills: [red] })
  store.update((d) => insert(d, extra, m))
  store.set({ selection: [r, extra.id] })
  run(store, 'subtract')
  const inst = () => childrenOf(store.get().doc, i).find((k) => k.type === 'BOOLEAN')!
  const before = inst().vector!.fill[0].d
  expect(before).toBeTruthy()
  store.update((d) => patch(d, [extra.id], { x: 80 }))
  expect(inst().vector!.fill[0].d).not.toBe(before)
  expect(inst().vector!.fill[0].d).toBe(childrenOf(store.get().doc, m).find((k) => k.type === 'BOOLEAN')!.vector!.fill[0].d)
  expect(page).toBeTruthy()
})

test('components: an instance mirrors a mask flag set in its main', () => {
  const { store, r, i, copy } = components()
  store.update((d) => patch(d, [r], { mask: true }))
  expect(copy().mask).toBe(true)
  expect(i).toBeTruthy()
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

test('gradients: a gradient switched on in an instance is an override', () => {
  const { store, r, copy } = components()
  store.update((d) => patch(d, [copy().id], { fills: [convertPaint({ type: 'SOLID', visible: true, color: black }, 'LINEAR')] }))
  store.update((d) => patch(d, [r], { fills: [green] }))
  expect(copy().fills[0].type).toBe('GRADIENT')
  expect(copy().overrides).toEqual(['fills'])
})

test('components: dragging and resizing inside a main keeps instances following (no stray overrides)', () => {
  const { store, m, r, copy } = components()
  store.set({ selection: [] })
  // the main is at (0,0), its rectangle at (10,10) 20×20; the instance sits at x = 140
  const g = beginGesture(store, at(15, 15))!
  for (const x of [25, 35, 45]) g.move(at(x, 15))
  g.up(at(45, 15))
  expect(store.get().doc.nodes[r].x).toBe(40)
  expect(copy()).toMatchObject({ x: 40 })
  expect(copy().overrides).toBeUndefined()
  // resize the main's rectangle from its right handle, over several moves
  store.set({ selection: [r] })
  const h = beginGesture(store, at(60, 20))!
  for (const x of [65, 70, 75]) h.move(at(x, 20))
  h.up(at(75, 20))
  expect(store.get().doc.nodes[r].width).toBe(35)
  expect(copy()).toMatchObject({ x: 40, width: 35 })
  expect(copy().overrides).toBeUndefined()
  expect(store.get().doc.nodes[m].component).toBe(true)
  // dragging the copy itself is still an override
  store.set({ selection: [] })
  const b = worldBox(store.get().doc, [copy().id])!, cx = b.x + b.w / 2, cy = b.y + b.h / 2, before = copy().x
  const c = beginGesture(store, at(cx, cy))!
  expect(store.get().selection).toEqual([copy().id])
  for (const dx of [12, 24]) c.move(at(cx + dx, cy))
  c.up(at(cx + 24, cy))
  expect(copy().x).not.toBe(before)
  expect(copy().overrides).toContain('x')
})

test('components: a gesture frame that leaves an overridden field where it was keeps the override', () => {
  const { store, copy } = components()
  const base = store.get().doc, id = copy().id
  const moved = patch(base, [id], { x: 50 })
  const prev = syncInstances(base, moved, base) // first frame: x overridden
  expect(prev.nodes[id].overrides).toEqual(['x'])
  // the next frame is rebuilt from `base` (no overrides yet) and lands on the same x, e.g. held by snapping
  expect(syncInstances(prev, patch(base, [id], { x: 50 }), base).nodes[id]).toMatchObject({ x: 50, overrides: ['x'] })
  // back where it started: not an override
  expect(syncInstances(prev, base, base).nodes[id].overrides).toBeUndefined()
})

test('variants: matching ignores the order properties are listed in', () => {
  const { store, m, i } = components()
  store.update((d) => patch(d, [m], { name: 'Size=S, Tone=Light' }))
  store.set({ selection: [m] })
  run(store, 'combine-variants')
  const set = store.get().selection[0]
  const add = (name: string) => { store.set({ selection: [set] }); run(store, 'add-variant'); const v = store.get().selection[0]; store.update((d) => patch(d, [v], { name })); return v }
  add('Size=L, Tone=Dark') // first variant with Size=L: what a non-exact fallback would pick
  const target = add('Tone=Light, Size=L') // the exact match, listed the other way round
  store.update((d) => setVariant(d, i, 'Size', 'L'))
  expect(store.get().doc.nodes[i].instanceOf).toBe(target)
})
