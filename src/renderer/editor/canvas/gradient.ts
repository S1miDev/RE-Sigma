// Gradient paints for the canvas renderer. Every kind is drawn in canonical gradient space (see gradientMatrix),
// mapped onto the node's box, so rotated, skewed and elliptical gradients from Figma come out right.
import { gradientMatrix, sortedStops, type Gradient } from '../../../shared/document'
import { css } from './color'

type Pt = { x: number; y: number }
type Part = { style: CanvasGradient; clip?: Pt[] } // clip: a polygon in the same space as the style
const FAR = 1e4 // reaches past any box in canonical space

function addStops(g: Gradient, grad: CanvasGradient) {
  for (const s of sortedStops(g.stops)) grad.addColorStop(Math.min(1, Math.max(0, s.pos)), css(s.color))
  return grad
}
/** A linear gradient whose value is 0 at `at` and grows by 1 per unit along `grad` (the value's gradient vector). */
function linearAlong(ctx: CanvasRenderingContext2D, at: Pt, grad: Pt) {
  const g2 = grad.x * grad.x + grad.y * grad.y || 1
  return ctx.createLinearGradient(at.x, at.y, at.x + grad.x / g2, at.y + grad.y / g2)
}
/** The four quadrants of a diamond around canonical (½, ½): in each, |x−½| + |y−½| is linear. */
const QUADRANTS = [1, -1].flatMap((qx) => [1, -1].map((qy) => ({ qx, qy, poly: [{ x: 0.5, y: 0.5 }, { x: 0.5 + qx * FAR, y: 0.5 }, { x: 0.5 + qx * FAR, y: 0.5 + qy * FAR }, { x: 0.5, y: 0.5 + qy * FAR }] })))

/** Styles in canonical space, for drawing under the gradient's matrix. Exact for every kind. */
function canonicalParts(ctx: CanvasRenderingContext2D, g: Gradient): Part[] {
  if (g.kind === 'LINEAR') return [{ style: addStops(g, ctx.createLinearGradient(0, 0, 1, 0)) }]
  if (g.kind === 'RADIAL') return [{ style: addStops(g, ctx.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5)) }]
  if (g.kind === 'ANGULAR') return [{ style: addStops(g, ctx.createConicGradient(0, 0.5, 0.5)) }]
  return QUADRANTS.map(({ qx, qy, poly }) => ({ style: addStops(g, linearAlong(ctx, { x: 0.5, y: 0.5 }, { x: qx * 2, y: qy * 2 })), clip: poly }))
}

/**
 * Styles in pixel space, for text and strokes (which can't be drawn under a skewing transform). Linear and diamond are
 * exact: their value is an affine function of the pixel. Radial and angular use the circle through the first handle.
 */
function pixelParts(ctx: CanvasRenderingContext2D, g: Gradient, P: DOMMatrix): Part[] {
  const inv = P.inverse(), at = (x: number, y: number) => P.transformPoint({ x, y })
  // canonical x and y as functions of the pixel: their gradient vectors are the rows of the inverse's linear part
  const gx = { x: inv.a, y: inv.c }, gy = { x: inv.b, y: inv.d }
  if (g.kind === 'LINEAR') return [{ style: addStops(g, linearAlong(ctx, at(0, 0), gx)) }]
  if (g.kind === 'DIAMOND') return QUADRANTS.map(({ qx, qy, poly }) => ({
    style: addStops(g, linearAlong(ctx, at(0.5, 0.5), { x: (qx * gx.x + qy * gy.x) * 2, y: (qx * gx.y + qy * gy.y) * 2 })),
    clip: poly.map((p) => at(p.x, p.y)),
  }))
  // shortcut: radial/angular text and strokes use a circle; exact unless the gradient is skewed or the box isn't square.
  const c = at(0.5, 0.5), e = at(1, 0.5), r = Math.hypot(e.x - c.x, e.y - c.y)
  return [{ style: addStops(g, g.kind === 'RADIAL' ? ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r) : ctx.createConicGradient(Math.atan2(e.y - c.y, e.x - c.x), c.x, c.y)) }]
}

function each(ctx: CanvasRenderingContext2D, list: Part[], draw: (style: CanvasGradient) => void) {
  for (const p of list) {
    ctx.save()
    if (p.clip) {
      ctx.beginPath()
      p.clip.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
      ctx.clip()
    }
    draw(p.style)
    ctx.restore()
  }
}
/** Box → canonical gradient space for a w×h node, or null for degenerate handles. A flat box counts as 1px thick. */
function boxMatrix(g: Gradient, w: number, h: number): DOMMatrix | null {
  const m = gradientMatrix(g)
  return m && new DOMMatrix().scale(w || 1, h || 1).multiply(new DOMMatrix(m))
}

/** Fills a path (in the node's own coordinates) exactly, drawing it in canonical gradient space. */
export function fillGradient(ctx: CanvasRenderingContext2D, g: Gradient, path: Path2D, rule: CanvasFillRule, w: number, h: number) {
  const P = boxMatrix(g, w, h)
  if (!P) return
  const canonical = new Path2D()
  canonical.addPath(path, P.inverse())
  ctx.save()
  ctx.transform(P.a, P.b, P.c, P.d, P.e, P.f)
  each(ctx, canonicalParts(ctx, g), (style) => { ctx.fillStyle = style; ctx.fill(canonical, rule) })
  ctx.restore()
}

/** Paints text or a stroke in the node's own coordinates; `draw` fills or strokes with the style it is given. */
export function paintGradient(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number, draw: (style: CanvasGradient) => void) {
  const P = boxMatrix(g, w, h)
  if (P) each(ctx, pixelParts(ctx, g, P), draw)
}

/** A size×size PNG data URL of the gradient over the whole box, or undefined without a canvas (tests). For SVG export. */
export function gradientImage(g: Gradient, size: number): string | undefined {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), P = boxMatrix(g, size, size)
  if (!ctx || !P) return undefined
  canvas.width = canvas.height = size
  ctx.transform(P.a, P.b, P.c, P.d, P.e, P.f)
  each(ctx, canonicalParts(ctx, g), (style) => { ctx.fillStyle = style; ctx.fillRect(-FAR, -FAR, FAR * 2, FAR * 2) })
  return canvas.toDataURL('image/png')
}
