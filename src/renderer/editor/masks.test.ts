// Masks: a layer marked as mask clips the siblings above it and draws nothing itself.
import { expect, test } from 'vitest'
import { emptyDocument, makeNode, solid, type Document } from '../../shared/document'
import { hitTest } from './canvas/hit'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import { childrenOf, insert, patch } from './model/ops'
import { open, run } from './testkit'

/** Page with a small rectangle A (bottom), a mask M and a big rectangle B above it. */
function scene(maskProps: Partial<ReturnType<typeof makeNode>> = {}) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const a = makeNode('RECTANGLE', { x: 0, y: 0, width: 50, height: 50, fills: [solid(1, 0, 0)] })
  const m = makeNode('RECTANGLE', { x: 100, y: 0, width: 100, height: 100, fills: [solid(0, 1, 0)], mask: true, ...maskProps })
  const b = makeNode('RECTANGLE', { x: 150, y: 50, width: 200, height: 200, fills: [solid(0, 0, 1)] })
  for (const n of [a, m, b]) doc = insert(doc, n, page)
  return { doc, page, a: a.id, m: m.id, b: b.id }
}

/** Runs renderPage against a context that only records the names of the calls made on it. */
function calls(doc: Document, page: string): string[] {
  const log: string[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 } } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => { log.push(k); return args }),
    set: (t, k: string, v) => ((t[k] = v), true),
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, doc, page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  return log
}

test('mask: the canvas clips what is above the mask, after the layers below it', () => {
  const { doc, page } = scene()
  const log = calls(doc, page)
  const fills = log.flatMap((c, i) => (c === 'fill' ? [i] : []))
  expect(fills).toHaveLength(2) // A and B; the mask itself is not drawn
  const clip = log.indexOf('clip')
  expect(clip).toBeGreaterThan(fills[0])
  expect(clip).toBeLessThan(fills[1])
  expect(log.filter((c) => c === 'save')).toHaveLength(log.filter((c) => c === 'restore').length)
})

test('mask: a hidden mask or a shape that cannot mask clips nothing', () => {
  const hidden = scene({ visible: false })
  expect(calls(hidden.doc, hidden.page)).not.toContain('clip')
  const text = scene({ type: 'TEXT', characters: 'x' }) // a stale flag on a type that can't mask
  expect(calls(text.doc, text.page)).not.toContain('clip')
})

test('mask: SVG wraps the siblings above the mask in its outline', () => {
  const { doc, page } = scene()
  const f = makeNode('FRAME', { width: 400, height: 300, clipsContent: false })
  const moved = { ...doc, nodes: { ...doc.nodes } }
  for (const n of childrenOf(doc, page)) moved.nodes[n.id] = { ...n, parentId: f.id }
  const svg = toSvg(insert(moved, f, page), [f.id], () => undefined)
  expect(svg.match(/<clipPath/g)).toHaveLength(1)
  expect(svg).toMatch(/<clipPath id="c1" transform="matrix\(1 0 0 1 100 0\)"><rect [^>]*width="100"/)
  expect(svg).toMatch(/<g clip-path="url\(#c1\)"><g [^>]*><rect [^>]*width="200"/) // B sits inside the clip, A before it
  expect(svg.indexOf('width="50"')).toBeLessThan(svg.indexOf('clip-path="url'))
})

test('mask: clicks reach the masked layer only inside the mask, and the mask itself stays selectable', () => {
  const { doc, page, m, b } = scene()
  expect(hitTest(doc, page, { x: 160, y: 60 })).toBe(b) // inside both
  expect(hitTest(doc, page, { x: 300, y: 200 })).toBeNull() // inside B, outside the mask
  expect(hitTest(doc, page, { x: 120, y: 20 })).toBe(m) // the mask's own area
  const unmasked = patch(doc, [m], { mask: false })
  expect(hitTest(unmasked, page, { x: 300, y: 200 })).toBe(b)
})

test('mask: Use as mask toggles one shape and groups several with the bottom one as the mask', () => {
  const { store, a, b, page } = open()
  store.set({ selection: [a] })
  run(store, 'use-as-mask')
  expect(store.get().doc.nodes[a].mask).toBe(true)
  run(store, 'use-as-mask')
  expect(store.get().doc.nodes[a].mask).toBeFalsy()
  store.set({ selection: [a, b] })
  run(store, 'use-as-mask')
  const g = store.get().selection[0], kids = childrenOf(store.get().doc, g)
  expect(store.get().doc.nodes[g].type).toBe('GROUP')
  expect(kids.map((k) => !!k.mask)).toEqual([true, false])
  expect(store.get().doc.nodes[page].type).toBe('PAGE')
})
