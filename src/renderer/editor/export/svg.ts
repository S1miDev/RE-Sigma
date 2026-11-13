// SVG serializer for documents. Mirrors canvas/render.ts: same shapes, paint order, stroke alignment and shadows.
import type { Color, Document, Gradient, Node, Paint } from '../../../shared/document'
import { gradientImage } from '../canvas/gradient'
import { fontOf, layoutText, lineX } from '../canvas/text'
import { localMatrix, worldBox, worldMatrix } from '../model/geometry'
import { childrenOf } from '../model/ops'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
const f = (v: number) => String(Math.round(v * 1000) / 1000)
const rgb = (c: Color) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`

/** `imageUrl` maps an image hash to a data URL. The result's size is the nodes' bounding box on the page. */
export function toSvg(doc: Document, ids: string[], imageUrl: (hash: string) => string | undefined): string {
  const box = worldBox(doc, ids) ?? { x: 0, y: 0, w: 1, h: 1 }
  let defs = '', uid = 0

  /** A VECTOR's fill or outlined-stroke paths, scaled to the node's size; strokes keep their width under the scale. */
  const vec = (n: Node, which: 'fill' | 'stroke', attrs: string): string => {
    const v = n.vector!, scale = `scale(${f(v.w ? n.width / v.w : 1)} ${f(v.h ? n.height / v.h : 1)})`
    return v[which].map((p) => `<path d="${esc(p.d)}" fill-rule="${p.rule}" transform="${scale}" vector-effect="non-scaling-stroke" ${attrs}/>`).join('')
  }
  const shape = (n: Node, grow: number, attrs: string): string => {
    if (n.type === 'VECTOR') return vec(n, 'fill', attrs) // shortcut: ignores grow, so shadow spread and stroke align don't apply to vectors
    const w = Math.max(0, n.width + grow * 2), h = Math.max(0, n.height + grow * 2)
    if (n.type === 'ELLIPSE') return `<ellipse cx="${f(n.width / 2)}" cy="${f(n.height / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}" ${attrs}/>`
    if (n.type === 'LINE') return `<line x1="0" y1="0" x2="${f(n.width)}" y2="0" ${attrs}/>`
    const r = n.cornerRadius ? Math.max(0, Math.min(n.cornerRadius + grow, w / 2, h / 2)) : 0
    return `<rect x="${f(-grow)}" y="${f(-grow)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ''} ${attrs}/>`
  }
  const text = (n: Node, attrs: string): string => {
    const layout = layoutText(n), size = n.fontSize ?? 16
    const family = fontOf(n).replace(/^\S+ \S+ /, '') // drop weight and size from the shorthand
    const spans = layout.lines.map((l, i) => `<tspan x="${f(lineX(n, l.width, n.width))}" y="${f(i * layout.lineHeight + layout.lineHeight / 2)}">${esc(l.text)}</tspan>`).join('')
    return `<text font-family="${esc(family)}" font-size="${f(size)}" font-weight="${n.fontWeight ?? 400}" letter-spacing="${f(n.letterSpacing ?? 0)}" dominant-baseline="central" xml:space="preserve" ${attrs}>${spans}</text>`
  }
  const clip = (n: Node): string => {
    const id = `c${++uid}`
    defs += `<clipPath id="${id}">${shape(n, 0, '')}</clipPath>`
    return id
  }
  /** A linear or radial gradient in defs. Its coordinates are the node's normalized box, scaled to the node's size. */
  const gradientDef = (g: Gradient, n: Node): string => {
    const id = `g${++uid}`, stops = [...g.stops].sort((a, b) => a.pos - b.pos)
      .map((s) => `<stop offset="${f(Math.min(1, Math.max(0, s.pos)))}" stop-color="${rgb(s.color)}" stop-opacity="${f(s.color.a)}"/>`).join('')
    // vector paths carry their own scale, so their user space is the vector's box, not the node's
    const [w, h] = n.type === 'VECTOR' ? [n.vector!.w, n.vector!.h] : [n.width, n.height]
    const common = `id="${id}" gradientUnits="userSpaceOnUse" gradientTransform="scale(${f(w || 1)} ${f(h || 1)})"`
    defs += g.kind === 'LINEAR'
      ? `<linearGradient ${common} x1="${f(g.from.x)}" y1="${f(g.from.y)}" x2="${f(g.to.x)}" y2="${f(g.to.y)}">${stops}</linearGradient>`
      : `<radialGradient ${common} cx="${f(g.from.x)}" cy="${f(g.from.y)}" fx="${f(g.from.x)}" fy="${f(g.from.y)}" r="${f(Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y))}">${stops}</radialGradient>`
    return `url(#${id})`
  }
  /**
   * Draws something painted with a solid colour or a gradient. `draw` gets the paint attributes for `prop`.
   * `raster` allows an angular gradient to become a clipped image of the node's shape.
   */
  const painted = (n: Node, p: Exclude<Paint, { type: 'IMAGE' }>, prop: 'fill' | 'stroke', draw: (attrs: string) => string, raster: boolean): string => {
    const color = (c: Color) => draw(`${prop}="${rgb(c)}" ${prop}-opacity="${f(c.a)}"`)
    if (p.type === 'SOLID') return color(p.color)
    if (p.kind === 'LINEAR' || p.kind === 'RADIAL') return draw(`${prop}="${gradientDef(p, n)}"`)
    if (p.kind === 'DIAMOND') {
      // |dx| + |dy| is linear in each quadrant: four clipped linear gradients
      const r = Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y), cx = p.from.x * n.width, cy = p.from.y * n.height, far = 1e6
      return [1, -1].flatMap((qx) => [1, -1].map((qy) => {
        const id = `c${++uid}`
        defs += `<clipPath id="${id}"><rect x="${f(qx > 0 ? cx : cx - far)}" y="${f(qy > 0 ? cy : cy - far)}" width="${far}" height="${far}"/></clipPath>`
        const quarter: Gradient = { ...p, kind: 'LINEAR', to: { x: p.from.x + (qx * r) / 2, y: p.from.y + (qy * r) / 2 } }
        return `<g clip-path="url(#${id})">${draw(`${prop}="${gradientDef(quarter, n)}"`)}</g>`
      })).join('')
    }
    // shortcut: SVG has no conic gradient; a shape fill becomes a raster image, text and strokes take the first stop.
    const url = raster ? gradientImage(p, 256) : undefined
    if (url) return `<image href="${esc(url)}" width="${f(n.width)}" height="${f(n.height)}" preserveAspectRatio="none" clip-path="url(#${clip(n)})"/>`
    return color([...p.stops].sort((a, b) => a.pos - b.pos)[0].color)
  }

  const node = (n: Node): string => {
    if (!n.visible) return ''
    const fills = n.fills.filter((p) => p.visible), strokes = n.strokeWeight > 0 ? n.strokes.filter((p) => p.visible) : []
    let out = ''
    if (n.type !== 'GROUP') {
      if (fills.length || strokes.length)
        for (const s of n.effects.filter((e) => e.visible)) {
          const id = `s${++uid}`, pad = s.blur * 2 + Math.abs(s.spread) + n.strokeWeight
          defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${f(-pad)}" y="${f(-pad)}" width="${f(n.width + pad * 2)}" height="${f(n.height + pad * 2)}"><feGaussianBlur stdDeviation="${f(s.blur / 2)}"/></filter>`
          const paint = `fill="${rgb(s.color)}" fill-opacity="${f(s.color.a)}"`
          const body =
            n.type === 'TEXT' ? text(n, paint)
            : n.type === 'LINE' ? shape(n, 0, `fill="none" stroke="${rgb(s.color)}" stroke-opacity="${f(s.color.a)}" stroke-width="${f(n.strokeWeight + s.spread * 2)}"`)
            : n.type === 'VECTOR' ? vec(n, 'fill', paint) + vec(n, 'stroke', paint)
            : shape(n, s.spread, paint)
          out += `<g transform="translate(${f(s.x)} ${f(s.y)})" filter="url(#${id})">${body}</g>`
        }
      for (const p of fills) {
        if (p.type !== 'IMAGE') {
          if (n.type !== 'LINE') out += painted(n, p, 'fill', (attrs) => (n.type === 'TEXT' ? text(n, attrs) : shape(n, 0, attrs)), n.type !== 'TEXT')
        } else if (n.type !== 'TEXT' && n.type !== 'LINE') {
          const url = imageUrl(p.hash)
          if (url) out += `<image href="${esc(url)}" width="${f(n.width)}" height="${f(n.height)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip(n)})"/>`
        }
      }
    }
    const kids = childrenOf(doc, n.id).map(node).join('')
    if (kids) out += n.type === 'FRAME' && n.clipsContent ? `<g clip-path="url(#${clip(n)})">${kids}</g>` : kids
    for (const p of strokes) {
      if (p.type === 'IMAGE') continue
      const outlined = n.type === 'VECTOR' && n.vector!.stroke.length > 0, width = `stroke-width="${f(n.strokeWeight)}"`
      const grow = n.type === 'LINE' || n.strokeAlign === 'CENTER' ? 0 : n.strokeAlign === 'INSIDE' ? -n.strokeWeight / 2 : n.strokeWeight / 2
      out += painted(n, p, outlined ? 'fill' : 'stroke', (attrs) =>
        n.type === 'TEXT' ? text(n, `fill="none" ${attrs} ${width}`) : outlined ? vec(n, 'stroke', attrs) : shape(n, grow, `fill="none" ${attrs} ${width}`), false)
    }
    return `<g transform="matrix(${localMatrix(n).map(f).join(' ')})"${n.opacity < 1 ? ` opacity="${f(n.opacity)}"` : ''}>${out}</g>`
  }

  const body = ids.map((id) => `<g transform="matrix(${worldMatrix(doc, doc.nodes[id].parentId).map(f).join(' ')})">${node(doc.nodes[id])}</g>`).join('')
  const w = f(Math.max(1, box.w)), h = f(Math.max(1, box.h))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${f(box.x)} ${f(box.y)} ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}
