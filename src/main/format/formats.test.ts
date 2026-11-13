import fs from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { expect, test } from 'vitest'
import { emptyDocument, makeNode, solid } from '../../shared/document'
import { importFig } from './fig'
import { decodeMessage, decodeSchema, readCanvas } from './kiwi'
import { readRefig, readRefigMeta, validateDocument, writeRefig, type Meta } from './refig'

const fixture = (name: string) => new Uint8Array(fs.readFileSync(new URL(`../../../research/fixtures/${name}`, import.meta.url)))
const meta: Meta = { format: 'refig', formatVersion: 1, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }

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
  expect(broken((d) => ((d as { formatVersion: number }).formatVersion = 2))).toThrow(/newer version/)
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
