import fs from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { expect, test } from 'vitest'
import { emptyDocument, FORMAT_VERSION, gradientMatrix, makeNode, solid, type Gradient } from '../../shared/document'
import { figGradient, importFig } from './fig'
import { decodeMessage, decodeSchema, readCanvas } from './kiwi'
import { readRefig, readRefigMeta, validateDocument, writeRefig, type Meta } from './refig'

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`../../../research/fixtures/${name}`, import.meta.url)))
const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }

function sampleDoc() {
  const doc = emptyDocument(), page = doc.pages[0]
  const frame = makeNode('FRAME', { parentId: page, width: 200, height: 100, fills: [solid(1, 1, 1)] })
  const text = makeNode('TEXT', { parentId: frame.id, characters: 'Hi', width: 20, height: 19 })
  doc.nodes[frame.id] = frame
  doc.nodes[text.id] = text
  return { doc, page, frame, text }
}

test('kiwi decodes a hand-built schema and message', () => {
  const s = (t: string) => [...Buffer.from(t), 0]
  const defs = decodeSchema(Uint8Array.from([
    2,
    ...s('Kind'), 0, 2, ...s('A'), 0, 0, 0, ...s('B'), 0, 0, 1,
    ...s('Message'), 2, 3, ...s('name'), 11, 0, 1, ...s('kind'), 0, 0, 2, ...s('xs'), 5, 1, 3,
  ]))
  expect(decodeMessage(defs, Uint8Array.from([1, ...s('hi'), 2, 1, 3, 2, 3, 4, 0]))).toEqual({ name: 'hi', kind: 'B', xs: [-2, 2] })
})

test('kiwi decodes a real Figma canvas and rejects garbage', () => {
  const { version, message } = readCanvas(fixture('canvas.fig'))
  expect(version).toBe(106)
  expect(message.nodeChanges[0].type).toBe('DOCUMENT')
  expect(() => readCanvas(strToU8('not a fig file at all'))).toThrow(/fig-kiwi/)
  expect(() => readCanvas(fixture('canvas.fig').subarray(0, 200))).toThrow(/truncated/)
})

test('refig round-trips document, thumbnail and images', () => {
  const { doc } = sampleDoc()
  const hash = 'a'.repeat(64)
  const bytes = writeRefig({ meta, document: doc, thumbnail: Uint8Array.of(1, 2, 3), images: { [hash]: Uint8Array.of(9, 8) } })
  const back = readRefig(bytes)
  expect(back.meta).toEqual(meta)
  expect(back.document).toEqual(doc)
  expect([...back.thumbnail!]).toEqual([1, 2, 3])
  expect([...back.images[hash]]).toEqual([9, 8])
  expect(readRefigMeta(bytes).meta.id).toBe(meta.id)
})

test('refig round-trips boolean nodes and rejects an unknown operation', () => {
  const { doc, frame } = sampleDoc()
  const b = makeNode('BOOLEAN', { parentId: frame.id, boolOp: 'SUBTRACT', width: 10, height: 10, vector: { w: 10, h: 10, fill: [{ d: 'M0 0L10 0L10 10Z', rule: 'evenodd' }], stroke: [] } })
  doc.nodes[b.id] = b
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [b.id]: { ...b, boolOp: 'MERGE' } } })).toThrow(/boolOp/)
})

test('refig keeps the mask flag on shapes and drops it from text', () => {
  const { doc, frame, text } = sampleDoc()
  const r = makeNode('RECTANGLE', { parentId: frame.id, mask: true, width: 10, height: 10 })
  doc.nodes[r.id] = r
  const back = readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document
  expect(back.nodes[r.id].mask).toBe(true)
  expect(validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...text, mask: true } } }).nodes[text.id].mask).toBeUndefined()
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [r.id]: { ...r, mask: 'yes' } } })).toThrow(/mask/)
})

test('refig keeps star, arc and corner fields and rejects bad ones', () => {
  const { doc, frame } = sampleDoc()
  const star = makeNode('STAR', { parentId: frame.id, width: 40, height: 40, points: 6, innerRatio: 0.5, vector: { w: 40, h: 40, fill: [{ d: 'M0 0L40 0L40 40Z', rule: 'nonzero' }], stroke: [] } })
  const arc = makeNode('ELLIPSE', { parentId: frame.id, width: 40, height: 40, arc: { start: 10, sweep: 90, inner: 0.3 } })
  const rect = makeNode('RECTANGLE', { parentId: frame.id, width: 40, height: 40, cornerRadii: [1, 2, 3, 4], cornerSmoothing: 0.6 })
  for (const n of [star, arc, rect]) doc.nodes[n.id] = n
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (id: string, change: object) => () => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...change } } })
  expect(bad(star.id, { points: 2 })).toThrow(/points/)
  expect(bad(star.id, { innerRatio: 2 })).toThrow(/innerRatio/)
  expect(bad(rect.id, { cornerRadii: [1, 2, 3] })).toThrow(/cornerRadii/)
  expect(bad(rect.id, { cornerSmoothing: 3 })).toThrow(/cornerSmoothing/)
  expect(bad(arc.id, { arc: { start: 0, sweep: 90, inner: 5 } })).toThrow(/inner/)
})

test('refig keeps export settings and slices and rejects bad ones', () => {
  const { doc, frame, text } = sampleDoc()
  const r = makeNode('RECTANGLE', { parentId: frame.id, slice: true, width: 10, height: 10, exports: [{ suffix: '@2x', format: 'webp', scale: 2 }] })
  doc.nodes[r.id] = r
  const back = readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document
  expect(back.nodes[r.id].slice).toBe(true)
  expect(back.nodes[r.id].exports).toEqual([{ suffix: '@2x', format: 'webp', scale: 2 }])
  const withExports = (exports: unknown) => () => validateDocument({ ...doc, nodes: { ...doc.nodes, [r.id]: { ...r, exports } as never } })
  expect(withExports([{ suffix: '', format: 'gif', scale: 1 }])).toThrow(/format/)
  expect(withExports([{ suffix: '', format: 'png', scale: 0 }])).toThrow(/scale/)
  expect(withExports(Array(21).fill({ suffix: '', format: 'png', scale: 1 }))).toThrow(/exports/)
  expect(validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...text, slice: true } } }).nodes[text.id].slice).toBeUndefined()
})

test('validateDocument rejects bad shapes, dangling parents and cycles', () => {
  const { doc, frame, text } = sampleDoc()
  expect(validateDocument(doc)).toEqual(doc)
  const broken = (edit: (d: ReturnType<typeof sampleDoc>['doc']) => void) => {
    const d = structuredClone(doc)
    edit(d)
    return () => validateDocument(d)
  }
  expect(broken((d) => (d.nodes[frame.id].width = -1))).toThrow(/width/)
  expect(broken((d) => (d.nodes[frame.id].x = NaN))).toThrow(/\.x/)
  expect(broken((d) => (d.nodes[frame.id].parentId = 'nope'))).toThrow(/parentId/)
  expect(broken((d) => (d.nodes[frame.id].parentId = text.id))).toThrow(/parentId|cycle/)
  expect(broken((d) => delete d.nodes[text.id].characters)).toThrow(/characters/)
  expect(broken((d) => (d.pages = []))).toThrow(/pages/)
  expect(broken((d) => ((d as { formatVersion: number }).formatVersion = FORMAT_VERSION + 1))).toThrow(/newer version/)
  // a cycle that never reaches a page
  const a = makeNode('GROUP'), b = makeNode('GROUP', { parentId: a.id })
  a.parentId = b.id
  expect(broken((d) => Object.assign(d.nodes, { [a.id]: a, [b.id]: b }))).toThrow(/cycle/)
  // unknown fields are dropped
  expect(validateDocument({ ...doc, extra: 1 })).not.toHaveProperty('extra')
})

test('validateDocument keeps auto layout and fill flags, and rejects bad ones', () => {
  const { doc, frame, text } = sampleDoc()
  const d = structuredClone(doc)
  d.nodes[frame.id].layout = { mode: 'VERTICAL', gap: 8, padding: [1, 2, 3, 4], align: 'CENTER', hugW: false, hugH: true }
  d.nodes[text.id].fillW = true
  expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
  expect(() => validateDocument({ ...d, nodes: { ...d.nodes, [frame.id]: { ...d.nodes[frame.id], layout: { ...d.nodes[frame.id].layout, padding: [1, 2] } } } })).toThrow(/padding/)
  expect(() => validateDocument({ ...d, nodes: { ...d.nodes, [frame.id]: { ...d.nodes[frame.id], layout: { ...d.nodes[frame.id].layout, gap: -1 } } } })).toThrow(/gap/)
})

test('readRefig rejects unexpected entries, path traversal and non-zips', () => {
  const ok = { 'meta.json': strToU8(JSON.stringify(meta)), 'document.json': strToU8(JSON.stringify(emptyDocument())) }
  expect(readRefig(zipSync(ok)).meta.name).toBe('A')
  expect(() => readRefig(zipSync({ ...ok, '../evil.txt': strToU8('x') }))).toThrow(/Unexpected entry/)
  expect(() => readRefig(zipSync({ ...ok, 'run.exe': strToU8('x') }))).toThrow(/Unexpected entry/)
  expect(() => readRefig(zipSync({ 'meta.json': ok['meta.json'] }))).toThrow(/missing document.json/)
  expect(() => readRefig(strToU8('hello'))).toThrow(/not a valid archive/)
  expect(() => readRefig(zipSync({ ...ok, 'meta.json': strToU8(JSON.stringify({ ...meta, formatVersion: 99 })) }))).toThrow(/newer version/)
})

test('imports the Figma fixture, mapping supported layers and counting the rest', () => {
  const { document: doc, omitted } = importFig(fixture('Untitled.fig'))
  const nodes = Object.values(doc.nodes)
  const pages = doc.pages.map((id) => doc.nodes[id].name)
  expect(pages).toEqual(['Page 1', 'RE-probe', 'RE-interact', 'RE-interact-2']) // "Internal Only Canvas" is skipped
  const types = new Set(nodes.map((n) => n.type))
  for (const t of ['FRAME', 'GROUP', 'RECTANGLE', 'ELLIPSE', 'LINE', 'TEXT'] as const) expect(types.has(t)).toBe(true)
  expect(nodes.find((n) => n.type === 'TEXT' && n.characters === 'Hello world')).toMatchObject({ fontFamily: 'Inter' })
  // vectors, stars, polygons and booleans become paths from Figma's own outlines
  for (const t of ['VECTOR', 'STAR', 'REGULAR_POLYGON', 'BOOLEAN_OPERATION']) expect(omitted[t]).toBeUndefined()
  expect(nodes.find((n) => n.name === 'Polygon')?.vector).toEqual({ w: 100, h: 100, fill: [{ d: 'M50 0L93.301 75L6.699 75L50 0Z', rule: 'nonzero' }], stroke: [] })
  expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  const poly = nodes.find((n) => n.name === 'Polygon')!
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [poly.id]: { ...poly, vector: { ...poly.vector, fill: [{ d: 'M0 0"/><script>', rule: 'nonzero' }] } } } })).toThrow()
  expect(nodes.filter((n) => n.constraints).map((n) => n.constraints!.h).sort()).toEqual(['CENTER', 'MAX', 'SCALE', 'STRETCH']) // Figma's constraints survive import
  expect(omitted.INSTANCE).toBeUndefined() // instances are expanded from their component
  expect(omitted.SYMBOL).toBeUndefined()
  expect(omitted.VARIABLE).toBeUndefined() // lives on the internal canvas
  // children keep Figma's stacking order
  const probe = doc.pages[1]
  const top = nodes.filter((n) => n.parentId === probe).sort((a, b) => (a.order < b.order ? -1 : 1))
  expect(top.slice(0, 3).map((n) => n.name)).toEqual(['Rectangle', 'Ellipse', 'Polygon'])
  // a raw canvas.fig (no zip wrapper) also imports
  expect(importFig(fixture('canvas.fig')).document.pages).toHaveLength(4)
  expect(() => importFig(strToU8('junk'))).toThrow()
})

test('validateDocument keeps constraints and rejects unknown ones', () => {
  const { doc, text } = sampleDoc()
  const d = structuredClone(doc)
  d.nodes[text.id].constraints = { h: 'STRETCH', v: 'CENTER' }
  expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
  expect(() => validateDocument({ ...d, nodes: { ...d.nodes, [text.id]: { ...d.nodes[text.id], constraints: { h: 'LEFT', v: 'MIN' } } } })).toThrow(/constraints/)
})

test('validateDocument keeps component links and rejects unknown override fields', () => {
  const { doc, frame, text } = sampleDoc()
  const d = structuredClone(doc)
  d.nodes[frame.id] = { ...d.nodes[frame.id], instanceOf: 'main-id' }
  d.nodes[text.id] = { ...d.nodes[text.id], ref: 'main-text', overrides: ['fills', 'characters'] }
  expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
  const main = structuredClone(doc)
  main.nodes[frame.id].component = true
  expect(validateDocument(main).nodes[frame.id].component).toBe(true)
  expect(() => validateDocument({ ...d, nodes: { ...d.nodes, [text.id]: { ...d.nodes[text.id], overrides: ['id'] } } })).toThrow(/overrides/)
})

test('validateDocument keeps component sets', () => {
  const { doc, frame } = sampleDoc()
  const d = structuredClone(doc)
  d.nodes[frame.id].componentSet = true
  expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
  expect(() => validateDocument({ ...d, nodes: { ...d.nodes, [frame.id]: { ...d.nodes[frame.id], componentSet: 'yes' } } })).toThrow(/componentSet/)
})

test('figGradient reads stops and handles from the paint transform', () => {
  const stops = [{ color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 1, a: 0.5 }, position: 1 }]
  // identity: linear runs (0,½)→(1,½)
  expect(figGradient({ type: 'GRADIENT_LINEAR', stops, opacity: 0.5 })).toEqual({
    type: 'GRADIENT', kind: 'LINEAR', visible: true, from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, w: { x: 0, y: 1 },
    stops: [{ pos: 0, color: { r: 1, g: 0, b: 0, a: 0.5 } }, { pos: 1, color: { r: 0, g: 0, b: 1, a: 0.25 } }],
  })
  // Figma's top-to-bottom linear: the transform maps box (x,y) → gradient (y, 1−x)
  const g = figGradient({ type: 'GRADIENT_LINEAR', stops, transform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 } })!
  expect(g.from).toEqual({ x: 0.5, y: 0 }); expect(g.to).toEqual({ x: 0.5, y: 1 })
  expect(figGradient({ type: 'GRADIENT_RADIAL', stops })).toMatchObject({ kind: 'RADIAL', from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } })
  expect(figGradient({ type: 'GRADIENT_LINEAR', stops: stops.slice(1) })).toBeNull()
  expect(figGradient({ type: 'GRADIENT_LINEAR', stops, transform: { m00: 0, m11: 0 } })).toBeNull()
  expect(figGradient({ type: 'SOLID' })).toBeNull()
})

test('validateDocument keeps gradients and rejects bad ones', () => {
  const { doc, frame } = sampleDoc()
  const d = structuredClone(doc)
  const g: Gradient = { type: 'GRADIENT', kind: 'DIAMOND', visible: true, from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 }, stops: [{ pos: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { pos: 1, color: { r: 1, g: 1, b: 1, a: 1 } }] }
  d.nodes[frame.id].fills = [g]
  expect(validateDocument(JSON.parse(JSON.stringify(d)))).toEqual(d)
  const bad = (p: object) => () => validateDocument({ ...d, nodes: { ...d.nodes, [frame.id]: { ...d.nodes[frame.id], fills: [p] } } })
  expect(bad({ ...g, kind: 'CONIC' })).toThrow(/kind/)
  expect(bad({ ...g, stops: g.stops.slice(1) })).toThrow(/stops/)
  expect(bad({ ...g, stops: [{ ...g.stops[0], pos: 2 }, g.stops[1]] })).toThrow(/pos/)
  expect(bad({ ...g, from: { x: 'a', y: 0 } })).toThrow(/from/)
})

test('figGradient keeps the width handle, and skips gradients it cannot represent', () => {
  const stops = [{ color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 }, { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 }]
  // Figma's value x + y: diagonal isolines that from/to alone would lose
  const skew = figGradient({ type: 'GRADIENT_LINEAR', stops, transform: { m00: 1, m01: 1, m02: 0, m10: 0, m11: 1, m12: 0 } })!
  const m = gradientMatrix(skew)!
  // the canonical→box matrix is the transform's inverse: box (x, y) = (cx − cy, cy)
  ;[1, 0, -1, 1, 0, 0].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9))
  // an elliptical radial: canonical radius ½ is ¼ wide and ½ tall in the box
  const oval = figGradient({ type: 'GRADIENT_RADIAL', stops, transform: { m00: 2, m01: 0, m02: -0.5, m10: 0, m11: 1, m12: 0 } })!
  expect(oval).toMatchObject({ from: { x: 0.5, y: 0.5 }, to: { x: 0.75, y: 0.5 }, w: { x: 0.5, y: 1 } })
  // near-singular: handles would land past the validator's range
  expect(figGradient({ type: 'GRADIENT_LINEAR', stops, transform: { m00: 1e-7, m01: 0, m02: 0, m10: 0, m11: 1e-7, m12: 0 } })).toBeNull()
})


test('refig keeps prototype interactions and flow starts and rejects bad ones', () => {
  const { doc, frame, text } = sampleDoc()
  const it = { trigger: 'key', key: 'Enter', action: 'url', url: 'https://example.com', transition: 'slideLeft', duration: 200, easing: 'easeOut' } as const
  doc.nodes[text.id] = { ...text, interactions: [it, { trigger: 'click', action: 'navigate', target: frame.id, transition: 'instant', duration: 0, easing: 'linear' }] }
  doc.nodes[frame.id] = { ...frame, flowStart: true }
  const back = readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document
  expect(back.nodes[text.id].interactions).toEqual(doc.nodes[text.id].interactions)
  expect(back.nodes[frame.id].flowStart).toBe(true)
  const withIt = (i: unknown) => () => validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...text, interactions: [{ ...it, ...(i as object) }] } as never } })
  expect(withIt({ trigger: 'drag' })).toThrow(/trigger/)
  expect(withIt({ url: 'javascript:alert(1)' })).toThrow(/url/)
  expect(withIt({ duration: -1 })).toThrow(/duration/)
  expect(() => validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...text, interactions: Array(21).fill(it) } as never } })).toThrow(/interactions/)
  expect(validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...text, flowStart: true } } }).nodes[text.id].flowStart).toBeUndefined()
})

test('refig keeps comments, reads files without them as empty, and rejects bad ones', () => {
  const { doc } = sampleDoc(), page = doc.pages[0]
  const c = { id: 'c1', page, x: 10, y: 20, text: 'hi', at: '2026-01-01T00:00:00.000Z', resolved: true, replies: [{ id: 'r1', text: 'yo', at: '2026-01-02T00:00:00.000Z' }] }
  const back = readRefig(writeRefig({ meta, document: { ...doc, comments: [c] }, thumbnail: undefined, images: {} })).document
  expect(back.comments).toEqual([c])
  const { comments: _, ...old } = doc
  expect(validateDocument(old).comments).toEqual([])
  const bad = (x: object) => () => validateDocument({ ...doc, comments: [{ ...c, ...x }] })
  expect(bad({ page: 'nope' })).toThrow(/comments.0.page/)
  expect(bad({ x: Infinity })).toThrow(/comments.0.x/)
  expect(bad({ text: 'a'.repeat(5001) })).toThrow(/text/)
  expect(bad({ replies: [{ id: 'c1', text: 'dup', at: 'now' }] })).toThrow(/replies/)
  expect(() => validateDocument({ ...doc, comments: Array(1001).fill(c) })).toThrow(/comments/)
})

const VID = '22222222-2222-2222-2222-222222222222'
test('history entries round-trip, load oldest first, and strangers in history/ are still rejected', () => {
  const doc = emptyDocument()
  const history = [
    { id: VID, at: '2026-01-03T00:00:00.000Z', auto: true, document: doc },
    { id: '33333333-3333-3333-3333-333333333333', name: 'Milestone', at: '2026-01-02T00:00:00.000Z', auto: false, document: doc },
  ]
  const back = readRefig(writeRefig({ meta, document: doc, images: {}, history }))
  expect(back.history?.map((h) => h.name ?? 'auto')).toEqual(['Milestone', 'auto'])
  expect(readRefig(writeRefig({ meta, document: doc, images: {} })).history).toEqual([])
  const ok = { 'meta.json': strToU8(JSON.stringify(meta)), 'document.json': strToU8(JSON.stringify(doc)) }
  expect(() => readRefig(zipSync({ ...ok, 'history/evil.json': strToU8('{}') }))).toThrow(/Unexpected entry/)
  // a damaged version is skipped; the project still opens
  const wrongId = strToU8(JSON.stringify({ id: 'other', at: history[0].at, auto: true, document: doc }))
  const badDoc = strToU8(JSON.stringify({ ...history[0], document: { ...doc, pages: [] } }))
  expect(readRefig(zipSync({ ...ok, [`history/${VID}.json`]: wrongId })).history).toEqual([])
  expect(readRefig(zipSync({ ...ok, [`history/${VID}.json`]: badDoc })).history).toEqual([])
  expect(readRefig(zipSync({ ...ok, 'history/': new Uint8Array() })).history).toEqual([])
  const mixed = readRefig(zipSync({ ...ok, [`history/${VID}.json`]: badDoc, [`history/${history[1].id}.json`]: strToU8(JSON.stringify(history[1])) }))
  expect(mixed.history?.map((h) => h.name)).toEqual(['Milestone'])
})

test('libraries are validated and kept; files from before version 19 read with none', () => {
  const doc = emptyDocument(), lib = { projectId: VID, name: 'Kit', links: { a1: 'b1', page: 'p-1' } }
  expect(validateDocument({ ...doc, libraries: [lib] }).libraries).toEqual([lib])
  const { libraries: _, ...old } = doc
  expect(validateDocument({ ...old, formatVersion: 18 }).libraries).toEqual([])
  expect(() => validateDocument({ ...doc, libraries: [{ ...lib, projectId: 'nope' }] })).toThrow(/projectId/)
  expect(() => validateDocument({ ...doc, libraries: [{ ...lib, links: { __proto__x: 'a' } }] })).toThrow(/links/)
  expect(() => validateDocument({ ...doc, libraries: [{ ...lib, links: { a: 7 } }] })).toThrow(/links/)
  expect(() => validateDocument({ ...doc, libraries: 'x' })).toThrow(/libraries/)
})
