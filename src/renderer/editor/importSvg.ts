// SVG file → a FRAME of editable VECTOR nodes. Shapes become paths with their transforms baked in; groups are flattened.
// shortcut: solid fills/strokes only (no gradients, clip paths, masks, filters, <use>, <text>, <image> or CSS classes); each skipped kind is reported.
import { makeNode, type Color, type Node, type Paint } from '../../shared/document'
import { IDENTITY, mul, rad, apply, type Mat } from './model/geometry'
import { mapSubs, parsePath, pathData, withAnchors } from './model/path'
import { absolutePath } from './model/svgPath'
import { orderBetween } from '../../shared/order'

export type SvgImport = { nodes: Node[]; root: Node; skipped: string[] }

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080' }
const SKIP = new Set(['linearGradient', 'radialGradient', 'clipPath', 'mask', 'filter', 'use', 'text', 'image', 'style', 'pattern', 'foreignObject'])
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])

function colorOf(v: string | undefined, skip: (what: string) => void): Color | null | undefined {
  if (v === undefined) return undefined // not set: inherit
  v = v.trim().toLowerCase()
  if (v === 'none' || v === 'transparent') return null
  if (v === 'currentcolor') return { r: 0, g: 0, b: 0, a: 1 }
  if (v.startsWith('url(')) { skip('gradient or pattern paint'); return null }
  v = NAMED[v] ?? v
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1]
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const h = hex.length < 6 ? [...hex].map((c) => c + c).join('') : hex
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/.exec(v)
  if (rgb) return { r: +rgb[1] / 255, g: +rgb[2] / 255, b: +rgb[3] / 255, a: rgb[4] === undefined ? 1 : +rgb[4] }
  skip(`colour "${v}"`)
  return null
}

function transformOf(s: string | null): Mat {
  let m = IDENTITY
  for (const [, name, args] of s?.matchAll(/(\w+)\s*\(([^)]*)\)/g) ?? []) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number)
    let t: Mat | null = null
    if (name === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
    else if (name === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
    else if (name === 'rotate') {
      const c = Math.cos(rad(a[0] ?? 0)), sn = Math.sin(rad(a[0] ?? 0)), cx = a[1] ?? 0, cy = a[2] ?? 0
      t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy]
    } else if (name === 'matrix' && a.length === 6) t = a as Mat
    else if (name === 'skewX') t = [1, 0, Math.tan(rad(a[0] ?? 0)), 1, 0, 0]
    else if (name === 'skewY') t = [1, Math.tan(rad(a[0] ?? 0)), 0, 1, 0, 0]
    if (t && t.every(Number.isFinite)) m = mul(m, t)
  }
  return m
}

type Style = { fill: Color | null; stroke: Color | null; strokeWidth: number; opacity: number; rule: 'nonzero' | 'evenodd'; cap?: string; join?: string; dash?: number[] }

const ELLIPSE = (cx: number, cy: number, rx: number, ry: number) => `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`

function shapeData(el: Element): string {
  const n = (k: string, d = 0) => Number.parseFloat(el.getAttribute(k) ?? '') || d
  switch (el.localName) {
    case 'path': return el.getAttribute('d') ?? ''
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height')
      if (w <= 0 || h <= 0) return ''
      const rxA = el.getAttribute('rx'), ryA = el.getAttribute('ry')
      let rx = Math.min(Number.parseFloat(rxA ?? ryA ?? '') || 0, w / 2), ry = Math.min(Number.parseFloat(ryA ?? rxA ?? '') || 0, h / 2)
      if (!rx || !ry) rx = ry = 0
      return rx ? `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z` : `M${x} ${y}H${x + w}V${y + h}H${x}Z`
    }
    case 'circle': return n('r') > 0 ? ELLIPSE(n('cx'), n('cy'), n('r'), n('r')) : ''
    case 'ellipse': return n('rx') > 0 && n('ry') > 0 ? ELLIPSE(n('cx'), n('cy'), n('rx'), n('ry')) : ''
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
    default: { // polyline, polygon
      const p = (el.getAttribute('points') ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
      if (p.length < 4) return ''
      let d = `M${p[0]} ${p[1]}`
      for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`
      return d + (el.localName === 'polygon' ? 'Z' : '')
    }
  }
}

/** Parses SVG text. Throws when it isn't SVG or draws nothing. */
export function importSvg(text: string, name: string): SvgImport {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = xml.documentElement
  if (!svg || svg.localName !== 'svg' || xml.getElementsByTagName('parsererror').length) throw new Error('Not a valid SVG file')
  const skipped = new Set<string>(), skip = (what: string) => skipped.add(what)
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  const hasVb = !!vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0
  const w = Number.parseFloat(svg.getAttribute('width') ?? '') || (hasVb ? vb![2] : 100)
  const h = Number.parseFloat(svg.getAttribute('height') ?? '') || (hasVb ? vb![3] : 100)
  const root: Mat = hasVb ? [w / vb![2], 0, 0, h / vb![3], (-vb![0] * w) / vb![2], (-vb![1] * h) / vb![3]] : IDENTITY
  const frame = makeNode('FRAME', { name: name.replace(/\.svg$/i, '') || 'SVG', width: w, height: h, clipsContent: false, fills: [] })
  const nodes: Node[] = [frame]
  let order: string | undefined

  const walk = (el: Element, m: Mat, inherited: Style) => {
    for (const child of el.children) {
      const tag = child.localName
      if (SKIP.has(tag)) { skip(`<${tag}>`); continue }
      if (tag !== 'g' && tag !== 'a' && tag !== 'svg' && !SHAPES.has(tag)) continue
      if (child.getAttribute('display') === 'none' || child.getAttribute('visibility') === 'hidden') continue
      if (child.hasAttribute('class')) skip('CSS classes')
      const css = Object.fromEntries((child.getAttribute('style') ?? '').split(';').map((s) => s.split(':').map((x) => x.trim())).filter((p) => p.length === 2))
      const get = (k: string) => css[k] ?? child.getAttribute(k) ?? undefined
      const fill = colorOf(get('fill'), skip), stroke = colorOf(get('stroke'), skip)
      const style: Style = {
        fill: fill === undefined ? inherited.fill : fill,
        stroke: stroke === undefined ? inherited.stroke : stroke,
        strokeWidth: get('stroke-width') !== undefined ? Number.parseFloat(get('stroke-width')!) || 0 : inherited.strokeWidth,
        opacity: inherited.opacity * (get('opacity') !== undefined ? Math.min(1, Math.max(0, Number(get('opacity')) || 0)) : 1),
        rule: get('fill-rule') === 'evenodd' ? 'evenodd' : get('fill-rule') === 'nonzero' ? 'nonzero' : inherited.rule,
        cap: get('stroke-linecap') ?? inherited.cap, join: get('stroke-linejoin') ?? inherited.join,
        dash: get('stroke-dasharray') ? get('stroke-dasharray')!.split(/[\s,]+/).map(Number).filter(Number.isFinite) : inherited.dash,
      }
      const cm = mul(m, transformOf(child.getAttribute('transform')))
      if (!SHAPES.has(tag)) { walk(child, cm, style); continue }
      const subs = mapSubs(parsePath(absolutePath(shapeData(child))), (p) => apply(cm, p))
      if (!subs.length) continue
      const paint = (c: Color): Paint => ({ type: 'SOLID', visible: true, color: { ...c, a: 1 }, ...(c.a < 1 && { opacity: c.a }) })
      const scale = Math.sqrt(Math.abs(cm[0] * cm[3] - cm[1] * cm[2])) // uniform part of the transform scales the stroke width
      order = orderBetween(order)
      const base = makeNode('VECTOR', {
        name: child.getAttribute('id') ?? `${tag[0].toUpperCase()}${tag.slice(1)}`, parentId: frame.id, order, opacity: style.opacity,
        fills: style.fill && tag !== 'line' ? [paint(style.fill)] : [],
        strokes: style.stroke && style.strokeWidth > 0 ? [paint(style.stroke)] : [],
        strokeWeight: style.stroke ? style.strokeWidth * scale : 0, strokeAlign: 'CENTER',
        ...(style.cap === 'round' && { strokeCap: 'ROUND' as const }), ...(style.cap === 'square' && { strokeCap: 'SQUARE' as const }),
        ...(style.join === 'round' && { strokeJoin: 'ROUND' as const }), ...(style.join === 'bevel' && { strokeJoin: 'BEVEL' as const }),
        ...(style.dash?.some((d) => d > 0) && { strokeDash: style.dash.map((d) => d * scale) }),
        vector: { w: 0, h: 0, fill: [{ d: '', rule: style.rule }], stroke: [] },
      })
      nodes.push(withAnchors(base, subs))
    }
  }
  walk(svg, root, { fill: { r: 0, g: 0, b: 0, a: 1 }, stroke: null, strokeWidth: 1, opacity: 1, rule: 'nonzero' })
  if (nodes.length === 1) throw new Error('This SVG has nothing drawable in it')
  return { nodes, root: frame, skipped: [...skipped] }
}
