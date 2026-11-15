import { readFileSync } from 'node:fs'
import { create, type Font } from 'fontkit'
import { describe, expect, it, vi } from 'vitest'
import { makeNode } from '../../shared/document'
import { textToPath } from './model/textPath'

const inter = create(readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')) as Font
const text = (characters: string, extra = {}) => makeNode('TEXT', { id: 't', characters, fontSize: 100, textAutoWidth: true, ...extra })
const xs = (d: string) => [...d.matchAll(/[MLC]?(-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[1])

describe('textToPath', () => {
  it('outlines glyphs as closed paths', () => {
    const d = textToPath(text('H'), () => inter)
    expect(d).toMatch(/^M/)
    expect(d).toMatch(/Z$/)
  })
  it('letterSpacing moves the second glyph', () => {
    const a = Math.max(...xs(textToPath(text('HH'), () => inter))), b = Math.max(...xs(textToPath(text('HH', { letterSpacing: 20 }), () => inter)))
    expect(b - a).toBeCloseTo(20, 0)
  })
  it('is empty without text or without a font', () => {
    expect(textToPath(text(''), () => inter)).toBe('')
    expect(textToPath(text('H'), () => undefined)).toBe('')
  })
})

describe('Flatten on text', () => {
  it('turns a text node into a vector', async () => {
    const { flatten } = await import('./model/boolean')
    const { loadFont } = await import('./fontFile')
    const { emptyDocument } = await import('../../shared/document')
    const { insert } = await import('./model/ops')
    // jsdom has no fetch of the woff2 url; stand in the font file
    const fetchMock = async () => ({ arrayBuffer: async () => readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').buffer })
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    await loadFont({ family: 'Inter', weight: 400, italic: false })
    const n = text('HI'), doc = insert(emptyDocument(), n, emptyDocument().pages[0])
    const out = flatten(doc, [n.id])
    expect(out.doc.nodes[n.id].type).toBe('VECTOR')
  })
})

describe('text inside a live boolean', () => {
  it('keeps its outline while the font is not loaded, and gets it back once it is', async () => {
    const { makeBoolean } = await import('./model/boolean')
    const { loadFont } = await import('./fontFile')
    const { insert, patch } = await import('./model/ops')
    const { open } = await import('./testkit')
    ;(globalThis as { fetch: unknown }).fetch = async () => ({ arrayBuffer: async () => readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').buffer })
    await loadFont({ family: 'Inter', weight: 400, italic: false })
    const t = open(), page = t.store.get().doc.pages[0]
    const rect = makeNode('RECTANGLE', { id: 'r', width: 50, height: 50 }), tx = text('HI', { id: 'tx' })
    t.store.update((d) => insert(insert(d, rect, page), tx, page))
    t.store.update((d) => makeBoolean(d, ['r', 'tx'], 'UNION'))
    const boolId = t.store.get().doc.pages.length && Object.values(t.store.get().doc.nodes).find((n) => n.type === 'BOOLEAN')!.id
    const d = () => t.store.get().doc.nodes[boolId].vector!.fill[0].d, subpaths = (s: string) => (s.match(/M/g) ?? []).length
    const before = d()
    expect(subpaths(before)).toBeGreaterThan(1) // the rectangle and the glyphs
    t.store.update((doc) => patch(doc, ['tx'], { fontFamily: 'NotLoadedYet' }))
    expect(d()).toBe(before) // the text is not dropped while its font loads
    await vi.waitFor(() => expect(t.store.get().doc.nodes.tx.fontFamily).toBe('NotLoadedYet'))
    await new Promise((r) => setTimeout(r, 20))
    expect(subpaths(d())).toBeGreaterThan(1)
  })
})

describe('cssName', () => {
  it('keeps a hostile family name inside its CSS string and safe as XML text', async () => {
    const { cssName } = await import('./fontFile')
    const out = cssName('a\\"&<b>\n;}')
    expect(out).toBe('a\\5c \\22 &#38;&#60;b&#62;\\a ;}')
    expect(out).not.toMatch(/[<>"\n]|&(?!#\d+;)/)
  })
})
