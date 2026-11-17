import { describe, expect, it } from 'vitest'
import { toHex } from '../ui'
import { documentColors, pushColor, RECENT, replaceColor, selectionColors } from './model/colors'
import { patch } from './model/ops'
import { solid, type Document } from '../../shared/document'
import { blue, open, scene } from './testkit'

const BLUE = { r: 0, g: 0, b: 1, a: 1 }
const colorOf = (doc: Document, id: string) => { const p = doc.nodes[id].fills[0]; return p.type === 'SOLID' ? p.color : null }

describe('colours', () => {
  it('documentColors lists each colour once, whatever the layer, alpha ignored', () => {
    const s = scene()
    const doc = patch(s.doc, [s.b], { effects: [{ type: 'DROP_SHADOW', visible: true, x: 0, y: 0, blur: 1, spread: 0, color: { r: 0, g: 0, b: 1, a: 0.3 } }] })
    expect(documentColors(doc).map(toHex)).toEqual(['F5F5F5', 'FF0000', '0000FF'])
  })

  it('pushColor puts the newest first, drops its earlier copy and caps the list', () => {
    const c = (r: number) => ({ r: r / 255, g: 0, b: 0, a: 1 })
    expect(pushColor([c(1), c(2)], c(2)).map(toHex)).toEqual(['020000', '010000'])
    const full = Array.from({ length: RECENT + 3 }, (_, i) => c(i)).reduce((l, x) => pushColor(l, x), [] as ReturnType<typeof c>[])
    expect(full).toHaveLength(RECENT)
  })
})

describe('selection colours', () => {
  it('counts each colour used inside the selection, nested children included', () => {
    const s = scene()
    const doc = patch(s.doc, [s.frame], { strokes: [blue] })
    expect(selectionColors(doc, [s.frame]).map((u) => [u.hex, u.count])).toEqual([['FF0000', 2], ['0000FF', 1]])
    expect(selectionColors(doc, [s.frame, s.inner]).find((u) => u.hex === 'FF0000')?.count).toBe(2) // a child selected with its parent counts once
  })

  it('replaceColor changes every user under the selection, keeps alpha, and leaves the rest alone', () => {
    const s = scene()
    let doc = patch(s.doc, [s.inner], { fills: [solid(1, 0, 0, 0.5)], strokes: [blue] })
    doc = replaceColor(doc, [s.frame], 'FF0000', { r: 0, g: 1, b: 0, a: 1 })
    expect(colorOf(doc, s.frame)).toEqual({ r: 0, g: 1, b: 0, a: 1 })
    expect(colorOf(doc, s.inner)).toEqual({ r: 0, g: 1, b: 0, a: 0.5 })
    expect(doc.nodes[s.inner].strokes).toEqual([blue])
    expect(doc.nodes[s.a]).toBe(s.doc.nodes[s.a])
  })

  it('skips paints linked to a style', () => {
    const s = scene()
    const doc = patch(s.doc, [s.inner], { fillStyle: 'style1' })
    expect(selectionColors(doc, [s.frame])[0].count).toBe(1)
    expect(replaceColor(doc, [s.frame], 'FF0000', BLUE).nodes[s.inner].fills).toEqual(doc.nodes[s.inner].fills)
  })

  it('one recolour is one undo step', () => {
    const { store, frame } = open()
    store.update((d) => replaceColor(d, [frame], 'FF0000', BLUE), { key: 'panel:selection-colors' })
    store.update((d) => replaceColor(d, [frame], '0000FF', { r: 0, g: 1, b: 0, a: 1 }), { key: 'panel:selection-colors' })
    store.undo()
    expect(selectionColors(store.get().doc, [frame])[0].hex).toBe('FF0000')
  })
})
