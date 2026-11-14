// Blend modes (node) and per-paint opacity: canvas, SVG and the .refig round trip.
import { expect, test } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode, solid, type Document } from '../../shared/document'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

function scene(props: Partial<ReturnType<typeof makeNode>>) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const r = makeNode('RECTANGLE', { width: 20, height: 20, fills: [{ ...solid(1, 0, 0), opacity: 0.5 }], ...props })
  doc = insert(doc, r, page)
  return { doc, page, id: r.id }
}

test('canvas sets the composite operation and scales alpha per paint', () => {
  const { doc, page } = scene({ blendMode: 'MULTIPLY' })
  const seen: unknown[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => { if (k === 'fill') seen.push([t.globalCompositeOperation, t.globalAlpha]) }),
    set: (t, k: string, v) => ((t[k] = v), true),
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, doc, page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(seen).toContainEqual(['multiply', 0.5])
})

test('SVG carries the blend mode and the paint opacity', () => {
  const { doc, id } = scene({ blendMode: 'SCREEN' })
  const svg = toSvg(doc, [id], () => undefined)
  expect(svg).toContain('mix-blend-mode:screen')
  expect(svg).toContain('<g opacity="0.5">')
})

test('refig keeps blendMode and paint opacity, and rejects bad values', () => {
  const { doc, id } = scene({ blendMode: 'OVERLAY' })
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], blendMode: 'NOPE' } } })).toThrow(/blendMode/)
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], fills: [{ ...solid(1, 0, 0), opacity: 2 }] } } })).toThrow(/opacity/)
})
