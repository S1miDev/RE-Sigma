// Per-range text styles: the pure run operations and the .refig validation of runs.
import { expect, test } from 'vitest'
import { readRefig, writeRefig, validateDocument, type Meta } from '../../main/format/refig'
import { emptyDocument, FORMAT_VERSION, makeNode } from '../../shared/document'
import { insert } from './model/ops'
import { commonStyle, runsOf, splice, styleAt, styleRange } from './model/richText'

const n = (characters: string, runs?: { len: number; style: object }[]) => makeNode('TEXT', { characters, runs: runs as never })

test('runsOf pads, cuts and merges so runs always cover the text', () => {
  expect(runsOf(n('abcd'))).toEqual([])
  expect(runsOf(n('abcd', [{ len: 2, style: { fontWeight: 700 } }]))).toEqual([{ len: 4, style: { fontWeight: 700 } }]) // short runs extend
  expect(runsOf(n('ab', [{ len: 5, style: { fontWeight: 700 } }]))).toEqual([{ len: 2, style: { fontWeight: 700 } }])
})

test('styleRange splits, merges and clears overrides', () => {
  const t = n('abcdef')
  const bold = styleRange(t, 2, 4, { fontWeight: 700 })
  expect(bold).toEqual([{ len: 2, style: {} }, { len: 2, style: { fontWeight: 700 } }, { len: 2, style: {} }])
  const all = styleRange({ ...t, runs: bold }, 0, 6, { fontWeight: 700 })
  expect(all).toEqual([{ len: 6, style: { fontWeight: 700 } }])
  expect(styleRange({ ...t, runs: all }, 0, 6, { fontWeight: undefined })).toEqual([])
})

test('splice inherits the style before the caret and deletes across runs', () => {
  const t = n('abcd', styleRange(n('abcd'), 0, 2, { fontSize: 30 }))
  const typed = splice(t, 2, 2, 'X') // after "ab" (30px) -> inherits 30
  expect(typed.characters).toBe('abXcd')
  expect(styleAt({ characters: typed.characters, runs: typed.runs }, 2)).toEqual({ fontSize: 30 })
  const cut = splice(t, 1, 3, '') // removes "bc" across both runs
  expect(cut.characters).toBe('ad')
  expect(cut.runs).toEqual([{ len: 1, style: { fontSize: 30 } }, { len: 1, style: {} }])
  expect(splice(t, 0, 4, 'z', {}).runs).toEqual([])
})

test('commonStyle reports the shared value or null when mixed', () => {
  const t = { ...n('abcd'), runs: styleRange(n('abcd'), 0, 2, { fontWeight: 700 }) }
  expect(commonStyle(t, 0, 2, 'fontWeight')).toBe(700)
  expect(commonStyle(t, 0, 4, 'fontWeight')).toBeNull()
  expect(commonStyle(t, 3, 3, 'fontWeight')).toBe(400) // collapsed caret reads the char before it (base style)
})

test('refig round-trips runs and rejects runs that do not cover the text', () => {
  const base = emptyDocument(), page = base.pages[0]
  const text = makeNode('TEXT', { characters: 'abcd', fills: [], runs: styleRange(n('abcd'), 1, 3, { fontWeight: 700, fill: { r: 1, g: 0, b: 0, a: 1 }, textDecoration: 'UNDERLINE' }) })
  const doc = insert(base, text, page)
  const meta: Meta = { format: 'refig', formatVersion: FORMAT_VERSION, id: '11111111-2222-3333-4444-555555555555', name: 'A', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-02T00:00:00.000Z', appVersion: '0.1.0' }
  expect(readRefig(writeRefig({ meta, document: doc, thumbnail: undefined, images: {} })).document).toEqual(doc)
  const bad = (change: object) => validateDocument({ ...doc, nodes: { ...doc.nodes, [text.id]: { ...doc.nodes[text.id], ...change } } })
  expect(() => bad({ runs: [{ len: 3, style: {} }] })).toThrow(/runs/)
  expect(() => bad({ runs: [{ len: 4, style: { textCase: 'X' } }] })).toThrow(/textCase/)
})

// ---- layout and rendering with runs ----
import { vi } from 'vitest'
import { layoutText } from './canvas/text'
import { renderPage } from './canvas/render'
import { toSvg } from './export/svg'
import type { Node } from '../../shared/document'

const rich = (characters: string, from: number, to: number, patch: object, extra: Partial<Node> = {}) => {
  const t = makeNode('TEXT', { characters, textAutoWidth: true, fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0, a: 1 } }], ...extra })
  return { ...t, runs: styleRange(t, from, to, patch) }
}

test('a bigger run raises the line height and every segment shares the baseline', () => {
  const l = layoutText(rich('ab cd', 3, 5, { fontSize: 40 })).lines[0]
  expect(l.segs.map((s) => s.text)).toEqual(['ab ', 'cd'])
  expect(l.height).toBe(48) // round(40 * 1.2)
  expect(l.segs.find((s) => s.text === 'cd')!.style.fontSize).toBe(40)
  expect(l.segs.reduce((w, s) => w + s.width, 0)).toBeCloseTo(l.width)
  expect(l.segs[1].x).toBeCloseTo(l.segs[0].x + l.segs[0].width) // segments sit one after another
})

test('wrapping measures words across run boundaries and indexes characters', () => {
  const l = layoutText(rich('aaaa bbbb', 5, 9, { fontWeight: 700 }, { textAutoWidth: false, width: 50 }))
  expect(l.lines).toHaveLength(2)
  expect(l.lines[0].segs[0]).toMatchObject({ text: 'aaaa ', start: 0, end: 5 }) // keeps its trailing space
  expect(l.lines[1].segs[0]).toMatchObject({ text: 'bbbb', start: 5, end: 9 })
})

test('canvas and SVG draw each run in its own style', () => {
  const t = rich('ab', 1, 2, { fontSize: 30, fontItalic: true, fill: { r: 1, g: 0, b: 0, a: 1 }, textDecoration: 'UNDERLINE' })
  const base = emptyDocument(), page = base.pages[0], doc = insert(base, t, page)
  vi.stubGlobal('Path2D', class { rect() {} addPath() {} roundRect() {} ellipse() {} moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (o, k: string) => (k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k in o ? o[k] : (...a: unknown[]) => { calls.push(`${k}:${JSON.stringify(a)}`) }),
    set: (o, k: string, v) => { calls.push(`${k}=${v}`); o[k] = v; return true },
  })
  renderPage(ctx as unknown as CanvasRenderingContext2D, doc, page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(calls.some((c) => c.startsWith('font=italic 400 30px'))).toBe(true)
  expect(calls.some((c) => c.startsWith('font=400 16px'))).toBe(true)
  expect(calls).toContain('fillStyle=rgba(255, 0, 0, 1)')
  const plain = { ...t, runs: styleRange(t, 1, 2, { textDecoration: undefined }) }
  const calls2: string[] = []
  const ctx2 = new Proxy({ canvas: { width: 10, height: 10 }, globalAlpha: 1 } as Record<string, unknown>, {
    get: (o, k: string) => (k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : k in o ? o[k] : (...a: unknown[]) => { calls2.push(k) }),
    set: (o, k: string, v) => { o[k] = v; return true },
  })
  renderPage(ctx2 as unknown as CanvasRenderingContext2D, insert(base, plain, page), page, { x: 0, y: 0, zoom: 1 }, 1, () => undefined)
  expect(calls.filter((c) => c.startsWith('fillRect:')).length).toBe(calls2.filter((c) => c === 'fillRect').length + 1) // one underline bar more
  const svg = toSvg(doc, [t.id], () => undefined)
  expect(svg.match(/<tspan/g)).toHaveLength(2)
  expect(svg).toContain('font-size="30"')
  expect(svg).toContain('fill="rgb(255,0,0)"')
  expect(svg).toContain('text-decoration="underline"')
})

// ---- caret geometry ----
import { caretPos, indexAt, lineBounds, selectionRects, wordAt } from './canvas/caret'

test('caretPos and indexAt agree, and a wrap boundary belongs to the next line', () => {
  const lay = layoutText(rich('aaaa bbbb', 0, 0, {}, { textAutoWidth: false, width: 50 })) // "aaaa " / "bbbb"; fallback width is 8.8 per character
  expect(lay.lines.map((l) => [l.start, l.end])).toEqual([[0, 5], [5, 9]])
  expect(caretPos(lay, 3).x).toBeCloseTo(26.4)
  expect(caretPos(lay, 3).line).toBe(0)
  expect(caretPos(lay, 5)).toMatchObject({ x: 0, line: 1 }) // not after the space on line 0
  expect(indexAt(lay, 27, 5)).toBe(3)
  expect(indexAt(lay, 500, 5)).toBe(4) // past the end of a wrapped line: before its trailing space
  expect(indexAt(lay, 500, 30)).toBe(9)
  expect(lineBounds(lay, 7)).toEqual([5, 9])
})

test('selection boxes span lines; words are found around an index', () => {
  const lay = layoutText(rich('aaaa bbbb', 0, 0, {}, { textAutoWidth: false, width: 50 }))
  const rects = selectionRects(lay, 2, 7)
  expect(rects).toHaveLength(2)
  expect(rects[0].x).toBeCloseTo(17.6)
  expect(rects[1]).toMatchObject({ x: 0, y: lay.lines[1].top })
  expect(wordAt('one two', 5)).toEqual([4, 7])
  expect(wordAt('one two', 3)).toEqual([3, 4]) // on the space: the space
})
