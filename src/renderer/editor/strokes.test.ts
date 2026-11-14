// Stroke options: dashes, caps, joins, end markers and per-side weights in canvas, SVG and the .refig round trip.
import { expect, test, vi } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode, solid, type Document, type Node } from '../../shared/document'
import { endMarks, sidesPath } from './canvas/paintPlan'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

function scene(type: 'LINE' | 'RECTANGLE', extra: Partial<Node>) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const n = makeNode(type, { width: 40, height: type === 'LINE' ? 0 : 20, strokes: [solid(0, 0, 0)], strokeWeight: 2, ...extra })
  doc = insert(doc, n, page)
  return { doc, page, id: n.id, node: doc.nodes[n.id] }
}

test('canvas sets dash, cap and join and fills end markers', () => {
  const s = scene('LINE', { strokeDash: [4, 2], strokeCap: 'ROUND', strokeJoin: 'BEVEL', strokeEnd: 'TRIANGLE' })
  vi.stubGlobal('Path2D', class { rect() {} addPath() {} roundRect() {} ellipse() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (t, k: string) => (k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k in t ? t[k] : (...a: unknown[]) => { calls.push(`${k}:${JSON.stringify(a)}`) }),
    set: (t, k: string, v) => { calls.push(`${k}=${v}`); t[k] = v; return true },
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, s.doc, s.page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(calls).toContain('setLineDash:[[4,2]]')
  expect(calls).toContain('lineCap=round')
  expect(calls).toContain('lineJoin=bevel')
  expect(calls.filter((c) => c.startsWith('fill:')).length).toBe(1) // the triangle at the end
})

test('SVG writes stroke attributes, markers and per-side edges', () => {
  const l = scene('LINE', { strokeDash: [4, 2], strokeCap: 'SQUARE', strokeStart: 'CIRCLE' })
  const svg = toSvg(l.doc, [l.id], () => undefined)
  expect(svg).toContain('stroke-dasharray="4 2"')
  expect(svg).toContain('stroke-linecap="square"')
  expect(svg).toContain('<polygon')
  const r = scene('RECTANGLE', { strokeSides: [1, 0, 3, 0] })
  expect(toSvg(r.doc, [r.id], () => undefined)).toContain(`<path d="${sidesPath(r.node)}"`)
})

test('end markers point outward from the path ends', () => {
  const l = scene('LINE', { strokeEnd: 'TRIANGLE', strokeStart: 'ARROW' })
  const [start, end] = endMarks(l.node)
  expect(end[0]).toEqual([40, 0]) // tip on the end point
  expect(start[0]).toEqual([0, 0])
  expect(Math.max(...end.map((p) => p[0]))).toBe(40) // body lies behind the tip
  expect(Math.min(...start.map((p) => p[0]))).toBe(0)
  expect(endMarks(scene('LINE', {}).node)).toEqual([])
})

test('refig round-trips the stroke options and rejects bad values', () => {
  const { doc, id } = scene('RECTANGLE', { strokeDash: [3, 1], strokeCap: 'ROUND', strokeJoin: 'ROUND', strokeStart: 'ARROW', strokeEnd: 'DIAMOND', strokeSides: [1, 2, 3, 4] })
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (change: object) => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...change } } })
  expect(() => bad({ strokeCap: 'NOPE' })).toThrow(/strokeCap/)
  expect(() => bad({ strokeDash: [-1] })).toThrow(/strokeDash/)
  expect(() => bad({ strokeSides: [1, 2] })).toThrow(/strokeSides/)
})
