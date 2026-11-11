// SVG serializer for documents. Mirrors canvas/render.ts: same shapes, paint order, stroke alignment and shadows.
import type { Color, Document, Node } from '../../../shared/document'
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

  const shape = (n: Node, grow: number, attrs: string): string => {
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
            : shape(n, s.spread, paint)
          out += `<g transform="translate(${f(s.x)} ${f(s.y)})" filter="url(#${id})">${body}</g>`
        }
      for (const p of fills) {
        if (p.type === 'SOLID') {
          const paint = `fill="${rgb(p.color)}" fill-opacity="${f(p.color.a)}"`
          if (n.type === 'TEXT') out += text(n, paint)
          else if (n.type !== 'LINE') out += shape(n, 0, paint)
        } else if (n.type !== 'TEXT' && n.type !== 'LINE') {
          const url = imageUrl(p.hash)
          if (url) out += `<image href="${esc(url)}" width="${f(n.width)}" height="${f(n.height)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip(n)})"/>`
        }
      }
    }
    const kids = childrenOf(doc, n.id).map(node).join('')
    if (kids) out += n.type === 'FRAME' && n.clipsContent ? `<g clip-path="url(#${clip(n)})">${kids}</g>` : kids
    for (const p of strokes) {
      if (p.type !== 'SOLID') continue
      const paint = `fill="none" stroke="${rgb(p.color)}" stroke-opacity="${f(p.color.a)}" stroke-width="${f(n.strokeWeight)}"`
      if (n.type === 'TEXT') out += text(n, paint)
      else out += shape(n, n.type === 'LINE' || n.strokeAlign === 'CENTER' ? 0 : n.strokeAlign === 'INSIDE' ? -n.strokeWeight / 2 : n.strokeWeight / 2, paint)
    }
    return `<g transform="matrix(${localMatrix(n).map(f).join(' ')})"${n.opacity < 1 ? ` opacity="${f(n.opacity)}"` : ''}>${out}</g>`
  }

  const body = ids.map((id) => `<g transform="matrix(${worldMatrix(doc, doc.nodes[id].parentId).map(f).join(' ')})">${node(doc.nodes[id])}</g>`).join('')
  const w = f(Math.max(1, box.w)), h = f(Math.max(1, box.h))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${f(box.x)} ${f(box.y)} ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}
