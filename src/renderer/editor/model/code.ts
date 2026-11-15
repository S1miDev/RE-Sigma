// Dev mode: a layer as CSS, and a layer tree as HTML + CSS. Pure; reads the document, changes nothing.
import { BLEND_CSS, gradientAngle, sortedStops, type Color, type Document, type Node, type Paint } from '../../../shared/document'
import { fmt as n2 } from './geometry'
import { childrenOf } from './ops'

export type Css = [prop: string, value: string][]

const px = (v: number) => `${n2(v)}px`
export const rgba = (c: Color, opacity = 1) => {
  const a = c.a * opacity, ch = [c.r, c.g, c.b].map((v) => Math.round(v * 255))
  return a >= 1 ? `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}` : `rgba(${ch.join(', ')}, ${n2(a)})`
}
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'

/** `var(--collection-name, fallback)` when the node binds `key` to a variable that still exists, else the plain value. */
function bound(doc: Document, n: Node, key: string, value: string): string {
  const id = n.bindings?.[key]
  for (const c of doc.collections) for (const v of c.variables) if (v.id === id) return `var(--${slug(c.name)}-${slug(v.name)}, ${value})`
  return value
}

function background(doc: Document, n: Node, p: Paint, i: number, key = 'fills'): string | null {
  if (!p.visible) return null
  if (p.type === 'IMAGE') return '/* image fill: export the layer as an asset */'
  if (p.type === 'SOLID') return bound(doc, n, `${key}.${i}.color`, rgba(p.color, p.opacity))
  const stops = sortedStops(p.stops).map((s) => `${rgba(s.color, p.opacity)} ${n2(s.pos * 100)}%`).join(', ')
  // shortcut: handles beyond direction/centre (a distorted gradient's width handle) are ignored; upgrade with gradientMatrix if designers notice
  if (p.kind === 'LINEAR') return `linear-gradient(${n2(gradientAngle(p) + 90)}deg, ${stops})`
  if (p.kind === 'RADIAL') return `radial-gradient(circle at ${n2(p.from.x * 100)}% ${n2(p.from.y * 100)}%, ${stops})`
  return `conic-gradient(from ${n2(gradientAngle(p) + 90)}deg at ${n2(p.from.x * 100)}% ${n2(p.from.y * 100)}%, ${stops})` // ANGULAR; DIAMOND has no CSS form
}

/** The CSS of one layer (not its children). Position is absolute unless the parent lays its children out. */
export function cssOf(doc: Document, n: Node): Css {
  const out: Css = [], parent = n.parentId ? doc.nodes[n.parentId] : undefined
  const add = (k: string, v: string | number | undefined | false) => { if (v !== undefined && v !== false && v !== '') out.push([k, `${v}`]) }
  const flowed = !!parent?.layout, root = !parent || parent.type === 'PAGE'
  if (!flowed && !root) { add('position', 'absolute'); add('left', px(n.x)); add('top', px(n.y)) }
  if (!(n.type === 'TEXT' && n.textAutoWidth)) add('width', n.fillW && flowed ? undefined : px(n.width))
  if (n.type !== 'TEXT' && !n.layout?.hugH) add('height', n.fillH && flowed ? undefined : px(n.height))
  if (n.fillW && flowed) add(parent!.layout!.mode === 'HORIZONTAL' ? 'flex' : 'align-self', parent!.layout!.mode === 'HORIZONTAL' ? '1' : 'stretch')
  if (n.fillH && flowed) add(parent!.layout!.mode === 'VERTICAL' ? 'flex' : 'align-self', parent!.layout!.mode === 'VERTICAL' ? '1' : 'stretch')
  if (n.rotation) add('transform', `rotate(${n2(n.rotation)}deg)`)
  if (n.opacity < 1) add('opacity', n2(n.opacity))
  if (n.blendMode && n.blendMode !== 'NORMAL') add('mix-blend-mode', BLEND_CSS[n.blendMode])
  if (n.layout) {
    const l = n.layout, align = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end' }[l.align]
    add('display', 'flex'); add('flex-direction', l.mode === 'HORIZONTAL' ? 'row' : 'column'); add('align-items', align)
    add('gap', l.gap && bound(doc, n, 'layout.gap', px(l.gap)))
    if (l.padding.some(Boolean)) add('padding', l.padding.map((v, i) => bound(doc, n, `layout.padding.${i}`, px(v))).join(' '))
  }
  if (n.clipsContent && n.type === 'FRAME') add('overflow', 'hidden')

  const fills = n.fills.map((p, i) => background(doc, n, p, i)).filter((v): v is string => !!v)
  if (n.type === 'TEXT') {
    if (fills.length) add('color', fills[0])
    add('font-family', `"${(n.fontFamily ?? 'Inter').replace(/["\\]/g, '')}", sans-serif`)
    add('font-size', bound(doc, n, 'fontSize', px(n.fontSize ?? 16)))
    add('font-weight', n.fontWeight ?? 400)
    add('font-style', n.fontItalic && 'italic')
    add('line-height', n.lineHeight ? px(n.lineHeight) : undefined)
    add('letter-spacing', n.letterSpacing ? px(n.letterSpacing) : undefined)
    add('text-align', n.textAlign && n.textAlign !== 'LEFT' && n.textAlign.toLowerCase())
    add('text-transform', ({ UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' } as Record<string, string>)[n.textCase ?? ''])
    add('text-decoration', ({ UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' } as Record<string, string>)[n.textDecoration ?? ''])
  } else if (fills.length) {
    add('background', fills.reverse().join(', ')) // CSS paints the first layer on top; fills are stored bottom first
  }

  const stroke = n.strokes.find((p) => p.visible)
  if (stroke && n.type !== 'TEXT' && n.strokeWeight) {
    const i = n.strokes.indexOf(stroke), w = bound(doc, n, 'strokeWeight', px(n.strokeWeight)), style = n.strokeDash?.length ? 'dashed' : 'solid'
    const c = stroke.type === 'SOLID' ? bound(doc, n, `strokes.${i}.color`, rgba(stroke.color, stroke.opacity)) : stroke.type === 'GRADIENT' ? rgba(sortedStops(stroke.stops)[0].color) : '#000' // shortcut: gradient/image strokes use their first colour
    if (n.strokeSides) add('border-width', n.strokeSides.map(px).join(' ')), add('border-style', style), add('border-color', c)
    else add(n.strokeAlign === 'INSIDE' ? 'border' : 'outline', `${w} ${style} ${c}`)
    if (n.strokeAlign === 'OUTSIDE') add('outline-offset', '0')
    else add('box-sizing', 'border-box')
  }

  if (n.type === 'ELLIPSE') add('border-radius', '50%')
  else if (n.cornerRadii) add('border-radius', n.cornerRadii.map(px).join(' '))
  else if (n.cornerRadius) add('border-radius', bound(doc, n, 'cornerRadius', px(n.cornerRadius)))

  const shadows = n.effects.flatMap((e, i) => e.visible && 'color' in e
    ? [`${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${bound(doc, n, `effects.${i}.color`, rgba(e.color))}`] : [])
  add('box-shadow', shadows.join(', '))
  for (const e of n.effects) if (e.visible && (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR')) add(e.type === 'LAYER_BLUR' ? 'filter' : 'backdrop-filter', `blur(${px(e.blur / 2)})`)
  return out
}

export const cssText = (css: Css, indent = '  ') => css.map(([k, v]) => `${indent}${k}: ${v};`).join('\n')
/** Declarations as a rule: `.name { ... }`. */
export const ruleOf = (name: string, css: Css) => `.${name} {\n${cssText(css)}\n}`

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** The layer and everything under it as HTML (one class per layer, unique within the output) followed by the stylesheet. */
export function htmlOf(doc: Document, id: string): string {
  const rules: string[] = [], used = new Set<string>()
  const className = (n: Node) => {
    let base = slug(n.name), name = base
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`
    used.add(name)
    return name
  }
  const emit = (n: Node, depth: number): string => {
    if (!n.visible) return ''
    const cls = className(n), pad = '  '.repeat(depth)
    rules.push(ruleOf(cls, cssOf(doc, n)))
    if (n.type === 'TEXT') return `${pad}<span class="${cls}">${escHtml(n.characters ?? '')}</span>\n`
    const kids = n.type === 'BOOLEAN' ? '' : childrenOf(doc, n.id).map((k) => emit(k, depth + 1)).join('') // shortcut: booleans/vectors have no HTML form; export them as SVG
    return kids ? `${pad}<div class="${cls}">\n${kids}${pad}</div>\n` : `${pad}<div class="${cls}"></div>\n`
  }
  const html = emit(doc.nodes[id], 0)
  return `${html}\n<style>\n${rules.join('\n\n')}\n</style>`
}
