import { describe, expect, it } from 'vitest'
import { toHex } from '../ui'
import { documentColors, pushColor, RECENT } from './model/colors'
import { patch } from './model/ops'
import { scene } from './testkit'

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
