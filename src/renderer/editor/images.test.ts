// Image fill modes: placement maths, SVG output and the .refig round trip.
import { expect, test } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode, type Document, type ImagePaint } from '../../shared/document'
import { at, drag, near, open } from './testkit'
import { editNode } from './tools'
import { imageBox } from './canvas/paintPlan'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

const HASH = 'a'.repeat(64)
const img = (extra: Partial<ImagePaint> = {}): ImagePaint => ({ type: 'IMAGE', visible: true, hash: HASH, ...extra })

test('imageBox places each mode', () => {
  // a 100×50 image in a 40×40 node
  expect(imageBox(img(), 40, 40, 100, 50)).toEqual({ x: -20, y: 0, w: 80, h: 40, tile: false }) // fill covers
  expect(imageBox(img({ scaleMode: 'FIT' }), 40, 40, 100, 50)).toEqual({ x: 0, y: 10, w: 40, h: 20, tile: false })
  expect(imageBox(img({ scaleMode: 'CROP', scale: 2, offsetX: 5, offsetY: -5 }), 40, 40, 100, 50)).toEqual({ x: -60 + 5, y: -20 - 5, w: 160, h: 80, tile: false })
  expect(imageBox(img({ scaleMode: 'TILE', scale: 0.5, offsetX: 3 }), 40, 40, 100, 50)).toEqual({ x: 3, y: 0, w: 50, h: 25, tile: true })
})

function scene(p: ImagePaint) {
  let doc: Document = emptyDocument()
  const page = doc.pages[0]
  const r = makeNode('RECTANGLE', { width: 40, height: 40, fills: [p] })
  doc = insert(doc, r, page)
  return { doc, id: r.id }
}

test('SVG draws fit as a placed image and tile as a pattern', () => {
  const url = () => 'data:image/png;base64,AA=='
  const size = () => ({ w: 100, h: 50 })
  const fit = scene(img({ scaleMode: 'FIT' }))
  expect(toSvg(fit.doc, [fit.id], url, size)).toMatch(/<image [^>]*x="0" y="10" width="40" height="20"/)
  const tile = scene(img({ scaleMode: 'TILE', scale: 0.5 }))
  expect(toSvg(tile.doc, [tile.id], url, size)).toMatch(/<pattern [^>]*width="50" height="25"/)
  expect(toSvg(fit.doc, [fit.id], url)).toContain('slice') // size unknown: cover
})

test('refig keeps image mode fields and rejects bad ones', () => {
  const { doc, id } = scene(img({ scaleMode: 'CROP', scale: 1.5, offsetX: 4, offsetY: -2 }))
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document.nodes[id].fills).toEqual(doc.nodes[id].fills)
  const bad = (p: object) => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], fills: [p] } } })
  expect(() => bad({ ...img(), scaleMode: 'NOPE' })).toThrow(/scaleMode/)
  expect(() => bad({ ...img(), scale: 0 })).toThrow(/scale/)
})

test('double-click enters crop mode; dragging moves the image and a corner scales it', () => {
  const { store, a } = open()
  Object.assign(store, { image: () => ({ width: 100, height: 50 }) })
  store.set({ view: { x: 0, y: 0, zoom: 1 } })
  const fills = () => store.get().doc.nodes[a].fills[0] as ImagePaint
  store.update((d) => ({ doc: { ...d, nodes: { ...d.nodes, [a]: { ...d.nodes[a], fills: [img()] } } }, ids: [a] })) // a: 100×100 at (400, 0)
  editNode(store, a)
  expect(store.get().mode).toEqual({ kind: 'crop', id: a, paint: 0 })
  expect(fills().scaleMode).toBe('CROP')
  drag(store, at(450, 50), at(460, 55))
  expect([fills().offsetX, fills().offsetY]).toEqual([10, 5])
  // the image is 200×100 centred on (460, 55) now: its right-bottom corner is (560, 105); dragging it away from the centre doubles the distance
  drag(store, at(560, 105), at(660, 155))
  near(fills().scale!, 2)
})
