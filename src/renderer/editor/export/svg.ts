// SVG serializer for documents. What each node draws comes from canvas/paintPlan, shared with canvas/render.ts.
import { BLEND_CSS, gradientMatrix, sortedStops, type Color, type Document, type Gradient, type Node } from '../../../shared/document'
import { rgb } from '../canvas/color'
import { gradientImage } from '../canvas/gradient'
import { endMarks, grownBox, imageBox, hasPath, isMask, outlinedStroke, paintsOf, sidesPath, strokeGrow, strokeStyle, type Drawable } from '../canvas/paintPlan'
import { fontOf, layoutText } from '../canvas/text'
import { fmt as f, localMatrix, worldBox, worldMatrix } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { vectorScale } from '../model/path'
import { arcPath, cornerPath } from '../model/shapes'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')

/** `imageUrl` maps an image hash to a data URL. The result's size is the nodes' bounding box on the page. */
export function toSvg(doc: Document, ids: string[], imageUrl: (hash: string) => string | undefined, imageSize: (hash: string) => { w: number; h: number } | undefined = () => undefined): string {
  const box = worldBox(doc, ids) ?? { x: 0, y: 0, w: 1, h: 1 }
  let defs = '', uid = 0

  /** A VECTOR's fill or outlined-stroke paths, scaled to the node's size; strokes keep their width under the scale. */
  const vec = (n: Node, which: 'fill' | 'stroke', attrs: string): string => {
    const v = n.vector!, s = vectorScale(n), scale = `scale(${f(s.x)} ${f(s.y)})`
    return v[which].map((p) => `<path d="${esc(p.d)}" fill-rule="${p.rule}" clip-rule="${p.rule}" transform="${scale}" vector-effect="non-scaling-stroke" ${attrs}/>`).join('')
  }
  const shape = (n: Node, grow: number, attrs: string): string => {
    if (hasPath(n)) return vec(n, 'fill', attrs) // shortcut: ignores grow, so shadow spread and stroke align don't apply to vectors
    const { w, h, r, radii, plain } = grownBox(n, grow)
    if (n.type === 'ELLIPSE' && n.arc) return `<path d="${arcPath(n.width, n.height, n.arc)}" ${attrs}/>` // shortcut: an arc ignores `grow`
    if (n.type === 'ELLIPSE') return `<ellipse cx="${f(n.width / 2)}" cy="${f(n.height / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}" ${attrs}/>`
    if (n.type === 'LINE') return `<line x1="0" y1="0" x2="${f(n.width)}" y2="0" ${attrs}/>`
    if (!plain) return `<path d="${cornerPath(w, h, radii, n.cornerSmoothing)}" transform="translate(${f(-grow)} ${f(-grow)})" ${attrs}/>`
    return `<rect x="${f(-grow)}" y="${f(-grow)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ''} ${attrs}/>`
  }
  /** One <tspan> per styled segment, placed from the shared layout. `runFill`: let runs with their own colour use it (not for shadows or strokes). */
  const text = (n: Node, attrs: string, runFill = false): string => {
    const spans = layoutText(n).lines.flatMap((l) => l.segs.map((s) => {
      const st = s.style, deco = st.textDecoration === 'UNDERLINE' ? 'underline' : st.textDecoration === 'STRIKETHROUGH' ? 'line-through' : ''
      const family = fontOf(st).replace(/^(italic )?S+ S+ /, '') // drop style, weight and size from the shorthand
      const fill = runFill && s.fill ? ` fill="${rgb(s.fill)}" fill-opacity="${f(s.fill.a)}"` : ''
      return `<tspan x="${f(s.x)}" y="${f(l.y)}" font-family="${esc(family)}" font-size="${f(st.fontSize ?? 16)}" font-weight="${st.fontWeight ?? 400}" letter-spacing="${f(st.letterSpacing ?? 0)}"${st.fontItalic ? ' font-style="italic"' : ''}${deco && !s.mark ? ` text-decoration="${deco}"` : ''}${fill}>${esc(s.text)}</tspan>`
    })).join('')
    return `<text xml:space="preserve" ${attrs}>${spans}</text>`
  }
  const clip = (n: Node): string => {
    const id = `c${++uid}`
    defs += `<clipPath id="${id}">${shape(n, 0, '')}</clipPath>`
    return id
  }
  /** Canonical gradient space → a w×h box, as an SVG transform (see gradientMatrix). */
  const space = (m: number[], w: number, h: number) => `scale(${f(w || 1)} ${f(h || 1)}) matrix(${m.map(f).join(' ')})`
  /**
   * A gradient in defs, drawn in canonical space: linear x 0 → 1 (or `along` for a diamond quadrant), radial centred on
   * (½, ½) with radius ½. Vector paths carry their own scale, so their user space is the vector's box, not the node's.
   */
  const gradientDef = (g: Gradient, m: number[], n: Node, along?: [number, number, number, number]): string => {
    const id = `g${++uid}`, stops = sortedStops(g.stops)
      .map((s) => `<stop offset="${f(Math.min(1, Math.max(0, s.pos)))}" stop-color="${rgb(s.color)}" stop-opacity="${f(s.color.a)}"/>`).join('')
    const [w, h] = hasPath(n) ? [n.vector!.w, n.vector!.h] : [n.width, n.height]
    const common = `id="${id}" gradientUnits="userSpaceOnUse" gradientTransform="${space(m, w, h)}"`
    const [x1, y1, x2, y2] = along ?? [0, 0, 1, 0]
    defs += g.kind === 'RADIAL'
      ? `<radialGradient ${common} cx="0.5" cy="0.5" fx="0.5" fy="0.5" r="0.5">${stops}</radialGradient>`
      : `<linearGradient ${common} x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops}</linearGradient>`
    return `url(#${id})`
  }
  /**
   * Draws something painted with a solid colour or a gradient. `draw` gets the paint attributes for `prop`.
   * `raster` allows an angular gradient to become a clipped image of the node's shape.
   */
  const painted = (n: Node, p: Drawable, prop: 'fill' | 'stroke', draw: (attrs: string) => string, raster: boolean): string => {
    const color = (c: Color) => draw(`${prop}="${rgb(c)}" ${prop}-opacity="${f(c.a)}"`)
    if (p.type === 'SOLID') return color(p.color)
    const first = sortedStops(p.stops)[0].color, m = gradientMatrix(p)
    if (!m) return color(first) // degenerate handles
    if (p.kind === 'LINEAR' || p.kind === 'RADIAL') return draw(`${prop}="${gradientDef(p, m, n)}"`)
    if (p.kind === 'DIAMOND') {
      // |x−½| + |y−½| is linear in each canonical quadrant: four clipped linear gradients. The clip lives in the
      // node's space (the <g>'s), the gradient in the painted element's.
      const far = 1e4
      return [1, -1].flatMap((qx) => [1, -1].map((qy) => {
        const id = `c${++uid}`, pts = [[0.5, 0.5], [0.5 + qx * far, 0.5], [0.5 + qx * far, 0.5 + qy * far], [0.5, 0.5 + qy * far]]
        defs += `<clipPath id="${id}"><polygon points="${pts.map((q) => q.map(f).join(',')).join(' ')}" transform="${space(m, n.width, n.height)}"/></clipPath>`
        return `<g clip-path="url(#${id})">${draw(`${prop}="${gradientDef(p, m, n, [0.5, 0.5, 0.5 + qx / 4, 0.5 + qy / 4])}"`)}</g>`
      })).join('')
    }
    // shortcut: SVG has no conic gradient; a shape fill becomes a raster image, text and strokes take the first stop.
    const url = raster ? gradientImage(p, 256) : undefined
    if (url) return `<image href="${esc(url)}" width="${f(n.width)}" height="${f(n.height)}" preserveAspectRatio="none" clip-path="url(#${clip(n)})"/>`
    return color(first)
  }

  /** Siblings bottom to top. A visible mask draws nothing and clips the siblings above it: they go in one <g> using its outline. */
  const siblings = (kids: Node[]): string => {
    const i = kids.findIndex((k) => isMask(k) && k.visible)
    if (i < 0) return kids.map(node).join('')
    const id = `c${++uid}`
    defs += `<clipPath id="${id}" transform="matrix(${localMatrix(kids[i]).map(f).join(' ')})">${shape(kids[i], 0, '')}</clipPath>`
    return kids.slice(0, i).map(node).join('') + `<g clip-path="url(#${id})">${siblings(kids.slice(i + 1))}</g>`
  }

  const node = (n: Node): string => {
    if (!n.visible) return ''
    const { fills, strokes, shadows, inner, layerBlur } = paintsOf(n)
    let out = ''
    for (const s of shadows) {
      const id = `s${++uid}`, pad = s.blur * 2 + Math.abs(s.spread) + n.strokeWeight
      defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${f(-pad)}" y="${f(-pad)}" width="${f(n.width + pad * 2)}" height="${f(n.height + pad * 2)}"><feGaussianBlur stdDeviation="${f(s.blur / 2)}"/></filter>`
      const paint = `fill="${rgb(s.color)}" fill-opacity="${f(s.color.a)}"`
      const body =
        n.type === 'TEXT' ? text(n, paint)
        : n.type === 'LINE' ? shape(n, 0, `fill="none" stroke="${rgb(s.color)}" stroke-opacity="${f(s.color.a)}" stroke-width="${f(n.strokeWeight + s.spread * 2)}"`)
        : hasPath(n) ? vec(n, 'fill', paint) + vec(n, 'stroke', paint)
        : shape(n, s.spread, paint)
      out += `<g transform="translate(${f(s.x)} ${f(s.y)})" filter="url(#${id})">${body}</g>`
    }
    const alpha = (p: { opacity?: number }, svg: string) => (p.opacity !== undefined && p.opacity < 1 ? `<g opacity="${f(p.opacity)}">${svg}</g>` : svg)
    for (const p of fills) {
      if (p.type !== 'IMAGE') out += alpha(p, painted(n, p, 'fill', (attrs) => (n.type === 'TEXT' ? text(n, attrs, true) : shape(n, 0, attrs)), n.type !== 'TEXT'))
      else {
        const url = imageUrl(p.hash)
        const size = imageSize(p.hash)
        if (!url) continue
        if (!size) out += alpha(p, `<image href="${esc(url)}" width="${f(n.width)}" height="${f(n.height)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip(n)})"/>`) // size unknown: cover
        else {
          const b = imageBox(p, n.width, n.height, size.w, size.h)
          if (b.tile) {
            const id = `t${++uid}`
            defs += `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}"><image href="${esc(url)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="none"/></pattern>`
            out += alpha(p, shape(n, 0, `fill="url(#${id})"`))
          } else out += alpha(p, `<image href="${esc(url)}" x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" preserveAspectRatio="none" clip-path="url(#${clip(n)})"/>`)
        }
      }
    }
    for (const s of inner) {
      const f1 = `s${++uid}`, mask = `m${++uid}`, big = 10_000, pad = s.blur * 2 + Math.abs(s.x) + Math.abs(s.y) + n.strokeWeight
      defs += `<filter id="${f1}" filterUnits="userSpaceOnUse" x="${f(-pad)}" y="${f(-pad)}" width="${f(n.width + pad * 2)}" height="${f(n.height + pad * 2)}"><feGaussianBlur stdDeviation="${f(s.blur / 2)}"/></filter>`
      // the colour everywhere except the shape (spread shrinks the hole), blurred, moved, and clipped to the shape
      defs += `<mask id="${mask}" maskUnits="userSpaceOnUse" x="${-big}" y="${-big}" width="${n.width + 2 * big}" height="${n.height + 2 * big}"><rect x="${-big}" y="${-big}" width="${n.width + 2 * big}" height="${n.height + 2 * big}" fill="#fff"/>${shape(n, -s.spread, 'fill="#000"')}</mask>`
      out += `<g clip-path="url(#${clip(n)})"><g transform="translate(${f(s.x)} ${f(s.y)})"><g filter="url(#${f1})"><rect x="${-big}" y="${-big}" width="${n.width + 2 * big}" height="${n.height + 2 * big}" fill="${rgb(s.color)}" fill-opacity="${f(s.color.a)}" mask="url(#${mask})"/></g></g></g>`
    }
    const kids = n.type === 'BOOLEAN' ? '' : siblings(childrenOf(doc, n.id)) // a boolean's children are its operands
    if (kids) out += n.type === 'FRAME' && n.clipsContent ? `<g clip-path="url(#${clip(n)})">${kids}</g>` : kids
    const look = strokeStyle(n), sides = sidesPath(n), marks = endMarks(n), grow = strokeGrow(n), outlined = outlinedStroke(n)
    const width = `stroke-width="${f(n.strokeWeight)}" stroke-linecap="${look.cap}" stroke-linejoin="${look.join}"${look.dash.length ? ` stroke-dasharray="${look.dash.map(f).join(' ')}"` : ''}`
    for (const p of strokes) {
      out += alpha(p, painted(n, p, outlined || sides ? 'fill' : 'stroke', (attrs) =>
        n.type === 'TEXT' ? text(n, `fill="none" ${attrs} ${width}`) : outlined ? vec(n, 'stroke', attrs) : sides ? `<path d="${sides}" ${attrs}/>` : shape(n, grow, `fill="none" ${attrs} ${width}`), false))
      if (marks.length && !outlined && !sides)
        out += alpha(p, painted(n, p, 'fill', (attrs) => marks.map((m) => `<polygon points="${m.map((q) => q.map(f).join(',')).join(' ')}" ${attrs}/>`).join(''), false))
    }
    let blur = ''
    if (layerBlur) {
      const id = `s${++uid}`, pad = layerBlur * 3 // shortcut: a group's box is unknown here, so it blurs inside its bounding box + 50%; background blur has no SVG equivalent and is skipped
      defs += `<filter id="${id}" ${n.type === 'GROUP' ? 'x="-50%" y="-50%" width="200%" height="200%"' : `filterUnits="userSpaceOnUse" x="${f(-pad)}" y="${f(-pad)}" width="${f(n.width + pad * 2)}" height="${f(n.height + pad * 2)}"`}><feGaussianBlur stdDeviation="${f(layerBlur / 2)}"/></filter>`
      blur = ` filter="url(#${id})"`
    }
    return `<g transform="matrix(${localMatrix(n).map(f).join(' ')})"${blur}${n.opacity < 1 ? ` opacity="${f(n.opacity)}"` : ''}${n.blendMode && n.blendMode !== 'NORMAL' ? ` style="mix-blend-mode:${BLEND_CSS[n.blendMode]}"` : ''}>${out}</g>`
  }

  const body = ids.map((id) => `<g transform="matrix(${worldMatrix(doc, doc.nodes[id].parentId).map(f).join(' ')})">${node(doc.nodes[id])}</g>`).join('')
  const w = f(Math.max(1, box.w)), h = f(Math.max(1, box.h))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${f(box.x)} ${f(box.y)} ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}
