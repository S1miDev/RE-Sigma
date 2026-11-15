import { describe, expect, it } from 'vitest'
import { gradient, makeNode, solid } from '../../shared/document'
import { cssOf, htmlOf } from './model/code'
import { bindVariable, createCollection, createVariable } from './model/variables'
import { patch } from './model/ops'
import { scene } from './testkit'

const get = (css: [string, string][], k: string) => css.find(([p]) => p === k)?.[1]

describe('code export', () => {
  it('writes size, fill, radius and shadow of a rectangle', () => {
    const s = scene()
    const doc = patch(s.doc, [s.a], {
      width: 80, height: 40, cornerRadius: 8, fills: [solid(1, 0, 0)],
      effects: [{ type: 'DROP_SHADOW', visible: true, x: 0, y: 4, blur: 8, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }],
    })
    const css = cssOf(doc, doc.nodes[s.a])
    expect(get(css, 'width')).toBe('80px')
    expect(get(css, 'background')).toBe('#ff0000')
    expect(get(css, 'border-radius')).toBe('8px')
    expect(get(css, 'box-shadow')).toBe('0px 4px 8px 0px rgba(0, 0, 0, 0.25)')
  })

  it('writes a gradient and text styles', () => {
    const s = scene()
    let doc = patch(s.doc, [s.a], { fills: [gradient('LINEAR', { r: 0, g: 0, b: 1, a: 1 })] })
    expect(get(cssOf(doc, doc.nodes[s.a]), 'background')).toMatch(/^linear-gradient\(180deg, #0000ff 0%, rgba\(0, 0, 255, 0\) 100%\)$/)
    const t = makeNode('TEXT', { parentId: s.b, characters: 'Hi <b>', fontSize: 20, fontWeight: 700, fills: [solid(0, 0, 0)] })
    doc = { ...doc, nodes: { ...doc.nodes, [t.id]: t } }
    const css = cssOf(doc, t)
    expect(get(css, 'color')).toBe('#000000')
    expect(get(css, 'font-size')).toBe('20px')
    expect(get(css, 'font-weight')).toBe('700')
    expect(htmlOf(doc, t.id)).toContain('>Hi &#60;b&#62;</span>')
  })

  it('uses flex for auto layout and var() for a bound variable', () => {
    const s = scene()
    let doc = createCollection(s.doc, 'Brand', 'c1', 'm1')
    doc = createVariable(doc, 'c1', 'NUMBER', 'Radius', 6, 'v1')
    doc = patch(doc, [s.a], { cornerRadius: 6, layout: { mode: 'HORIZONTAL', gap: 4, padding: [1, 2, 3, 4], align: 'CENTER', hugW: false, hugH: false } })
    doc = bindVariable(doc, [s.a], 'cornerRadius', 'v1')
    const css = cssOf(doc, doc.nodes[s.a])
    expect(get(css, 'display')).toBe('flex')
    expect(get(css, 'padding')).toBe('1px 2px 3px 4px')
    expect(get(css, 'border-radius')).toBe('var(--brand-radius, 6px)')
  })

  it('nests children in HTML with one class per layer', () => {
    const s = scene()
    const html = htmlOf(s.doc, s.a)
    expect(html).toMatch(/<div class="[^"]+">/)
    expect(html).toContain('<style>')
  })
})
