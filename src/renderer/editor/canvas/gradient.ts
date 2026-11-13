// Gradient paints for the canvas renderer.
import type { Gradient } from '../../../shared/document'
import { css } from './render'

type Part = { style: CanvasGradient; clip?: [number, number, number, number] }

/**
 * Canvas gradients for `g` in a space where the node's box spans (0,0)–(sx,sy). With sx = sy = 1 (drawn under a
 * scale to the node's size) every kind is exact. In pixel space linear stays exact; the others use a circle.
 */
function parts(ctx: CanvasRenderingContext2D, g: Gradient, sx: number, sy: number): Part[] {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos)
  const add = (grad: CanvasGradient) => {
    for (const s of stops) grad.addColorStop(Math.min(1, Math.max(0, s.pos)), css(s.color))
    return grad
  }
  const f = { x: g.from.x * sx, y: g.from.y * sy }, t = { x: g.to.x * sx, y: g.to.y * sy }
  if (g.kind === 'LINEAR') {
    // In the box, value = dot(p − from, v) / |v|². Under the scale S its gradient is S⁻¹v / |v|²; the pixel-space end
    // point is from + u with u = that gradient / |gradient|².
    const vx = g.to.x - g.from.x, vy = g.to.y - g.from.y, v2 = vx * vx + vy * vy
    if (!v2) return []
    const gx = vx / sx / v2, gy = vy / sy / v2, g2 = gx * gx + gy * gy
    return [{ style: add(ctx.createLinearGradient(f.x, f.y, f.x + gx / g2, f.y + gy / g2)) }]
  }
  // shortcut: in pixel space (text, strokes) radial/angular/diamond use a circle of the mapped radius; exact only for square boxes.
  const r = Math.hypot(t.x - f.x, t.y - f.y)
  if (g.kind === 'RADIAL') return [{ style: add(ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)) }]
  if (g.kind === 'ANGULAR') return [{ style: add(ctx.createConicGradient(Math.atan2(t.y - f.y, t.x - f.x), f.x, f.y)) }]
  // Diamond: |dx| + |dy| is linear inside each quadrant, so it is four clipped linear gradients.
  const far = 1e6
  return [1, -1].flatMap((qx) => [1, -1].map((qy): Part => ({
    style: add(ctx.createLinearGradient(f.x, f.y, f.x + (qx * r) / 2, f.y + (qy * r) / 2)),
    clip: [qx > 0 ? f.x : f.x - far, qy > 0 ? f.y : f.y - far, far, far],
  })))
}

function each(ctx: CanvasRenderingContext2D, list: Part[], draw: (style: CanvasGradient) => void) {
  for (const p of list) {
    ctx.save()
    if (p.clip) { ctx.beginPath(); ctx.rect(...p.clip); ctx.clip() }
    draw(p.style)
    ctx.restore()
  }
}

/** Fills a path (in the node's own coordinates) exactly: the path is drawn in the normalized box under a scale. */
export function fillGradient(ctx: CanvasRenderingContext2D, g: Gradient, path: Path2D, rule: CanvasFillRule, w: number, h: number) {
  if (!w || !h) return
  const unit = new Path2D()
  unit.addPath(path, new DOMMatrix().scale(1 / w, 1 / h))
  ctx.save()
  ctx.scale(w, h)
  each(ctx, parts(ctx, g, 1, 1), (style) => { ctx.fillStyle = style; ctx.fill(unit, rule) })
  ctx.restore()
}

/** A size×size PNG data URL of the gradient over the whole box, or undefined without a canvas (tests). For SVG export. */
export function gradientImage(g: Gradient, size: number): string | undefined {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  canvas.width = canvas.height = size
  ctx.scale(size, size)
  each(ctx, parts(ctx, g, 1, 1), (style) => { ctx.fillStyle = style; ctx.fillRect(0, 0, 1, 1) })
  return canvas.toDataURL('image/png')
}

/** Paints text or a stroke in pixel space; `draw` fills or strokes with the style it is given. */
export function paintGradient(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number, draw: (style: CanvasGradient) => void) {
  each(ctx, parts(ctx, g, w || 1, h || 1), draw) // a line has no height; treat it as 1px so the mapping stays finite
}
