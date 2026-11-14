// Whole-node text options: case, lists, truncation, vertical align, decoration, italic.
import { expect, test, vi } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode, solid, type Document, type Node } from '../../shared/document'
import { layoutText } from './canvas/text'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

const text = (extra: Partial<Node>) => makeNode('TEXT', { characters: 'hello world', width: 100, height: 20, fills: [solid(0, 0, 0)], ...extra })
function scene(extra: Partial<Node>) {
  const n = text(extra), base: Document = emptyDocument(), page = base.pages[0]
  return { doc: insert(base, n, page), page, id: n.id }
}

test('case changes the laid-out text', () => {
  expect(layoutText(text({ textCase: 'UPPER' })).lines[0].text).toBe('HELLO WORLD')
  expect(layoutText(text({ textCase: 'LOWER', characters: 'ABC' })).lines[0].text).toBe('abc')
  expect(layoutText(text({ textCase: 'TITLE' })).lines[0].text).toBe('Hello World')
})

test('lists prefix every paragraph; numbers count up', () => {
  expect(layoutText(text({ listStyle: 'BULLET', characters: 'a\nb' })).lines.map((l) => l.text)).toEqual(['• a', '• b'])
  expect(layoutText(text({ listStyle: 'NUMBERED', characters: 'a\nb' })).lines.map((l) => l.text)).toEqual(['1. a', '2. b'])
})

test('a wrapped list item hangs under its text', () => {
  const [first, second] = layoutText(text({ listStyle: 'BULLET', textAutoWidth: false, width: 60, characters: 'aaaa bbbb' })).lines
  expect(first.indent).toBe(0)
  expect(second.indent).toBeGreaterThan(0)
  expect(second.x).toBe(second.indent)
})

test('maxLines with truncate cuts the last line with an ellipsis', () => {
  const l = layoutText(text({ textAutoWidth: false, width: 50, characters: 'aaaa bbbb cccc dddd', textTruncate: true, maxLines: 2 }))
  expect(l.lines).toHaveLength(2)
  expect(l.lines[1].text.endsWith('…')).toBe(true)
  expect(layoutText(text({ textAutoWidth: false, width: 50, characters: 'aaaa bbbb cccc dddd', maxLines: 2 })).lines.length).toBeGreaterThan(2) // no truncate: all lines
})

test('a fixed height limits lines when truncating and positions by vertical align', () => {
  const base = { textFixedHeight: true, height: 100, lineHeight: 20, characters: 'a' }
  const top = layoutText(text(base)).lines[0].top, mid = layoutText(text({ ...base, textAlignVertical: 'CENTER' })).lines[0].top, bot = layoutText(text({ ...base, textAlignVertical: 'BOTTOM' })).lines[0].top
  expect([top, mid, bot]).toEqual([0, 40, 80])
  expect(layoutText(text(base)).height).toBe(100)
  expect(layoutText(text({ ...base, textAutoWidth: false, width: 20, height: 40, characters: 'aaaa bbbb cccc', textTruncate: true })).lines).toHaveLength(2)
})

test('canvas draws the decoration bar; SVG writes decoration and italic', () => {
  const s = scene({ textDecoration: 'UNDERLINE', fontItalic: true })
  vi.stubGlobal('Path2D', class { rect() {} addPath() {} roundRect() {} ellipse() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (t, k: string) => (k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k in t ? t[k] : (...a: unknown[]) => { calls.push(`${k}:${JSON.stringify(a)}`) }),
    set: (t, k: string, v) => { calls.push(`${k}=${v}`); t[k] = v; return true },
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, s.doc, s.page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(calls.some((c) => c.startsWith('fillRect:'))).toBe(true)
  expect(calls.some((c) => c.startsWith('font=italic '))).toBe(true)
  const svg = toSvg(s.doc, [s.id], () => undefined)
  expect(svg).toContain('text-decoration="underline"')
  expect(svg).toContain('font-style="italic"')
})

test('refig round-trips the text options and rejects bad values', () => {
  const { doc, id } = scene({ fontItalic: true, textDecoration: 'STRIKETHROUGH', textCase: 'TITLE', textAlignVertical: 'BOTTOM', textTruncate: true, maxLines: 3, listStyle: 'NUMBERED', textFixedHeight: true })
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (change: object) => validateDocument({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...change } } })
  expect(() => bad({ textCase: 'NOPE' })).toThrow(/textCase/)
  expect(() => bad({ maxLines: -1 })).toThrow(/maxLines/)
  expect(() => bad({ listStyle: 'X' })).toThrow(/listStyle/)
})
