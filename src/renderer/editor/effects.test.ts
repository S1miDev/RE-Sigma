// Inner shadow, layer blur and background blur: canvas, SVG and the .refig round trip.
import { expect, test, vi } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode, solid, type Document, type Effect } from '../../shared/document'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

const black = { r: 0, g: 0, b: 0, a: 0.5 }
const inner: Effect = { type: 'INNER_SHADOW', visible: true, x: 1, y: 2, blur: 4, spread: 0, color: black }
const layer: Effect = { type: 'LAYER_BLUR', visible: true, blur: 6 }
const back: Effect = { type: 'BACKGROUND_BLUR', visible: true, blur: 10 }

function scene(effects: Effect[]) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const r = makeNode('RECTANGLE', { width: 20, height: 20, fills: [solid(1, 0, 0)], effects })
  doc = insert(doc, r, page)
  return { doc, page, id: r.id }
}

test('canvas applies the blurs as filters and draws an inner shadow after the fill', () => {
  const { doc, page } = scene([inner, layer, back])
  vi.stubGlobal('Path2D', class { rect() {} addPath() {} roundRect() {} ellipse() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (t, k: string) => (k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k in t ? t[k] : () => { calls.push(`${k}:${t.filter ?? ''}`) }),
    set: (t, k: string, v) => { if (k === 'filter') calls.push(`filter=${v}`); t[k] = v; return true },
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, doc, page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(calls).toContain('filter=blur(5px)') // background: radius 10 = std dev 5
  expect(calls).toContain('filter=blur(3px)') // layer: radius 6
  const fill = calls.indexOf('fill:blur(3px)'), evenodd = calls.lastIndexOf('fill:blur(3px)')
  expect(evenodd).toBeGreaterThan(fill) // the inner shadow's fill comes after the node's own
})

test('SVG exports inner shadow and layer blur, and skips background blur', () => {
  const s = scene([inner, layer, back])
  const svg = toSvg(s.doc, [s.id], () => undefined)
  expect(svg).toContain('<mask')
  expect(svg).toMatch(/<g transform="matrix\([^"]*\)" filter="url\(#s\d+\)"/)
  expect(svg.match(/feGaussianBlur/g)).toHaveLength(2)
})

test('refig round-trips the effects, reads untyped shadows, and rejects bad types', () => {
  const { doc, id } = scene([inner, layer, back, { visible: true, x: 0, y: 1, blur: 2, spread: 0, color: black }])
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (effects: unknown) => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], effects } } })
  expect(() => bad([{ ...inner, type: 'NOPE' }])).toThrow(/type/)
  expect(() => bad([{ type: 'LAYER_BLUR', visible: true, blur: -1 }])).toThrow(/blur/)
})
