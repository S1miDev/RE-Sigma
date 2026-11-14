// What a node draws, decided once for both renderers: the canvas (render.ts) and SVG export (export/svg.ts).
// Each renderer only maps these decisions onto its own API.
import type { Blur, DropShadow, ImagePaint, InnerShadow, Node, Paint } from '../../../shared/document'
import { vectorScale } from '../model/path'
import { isPlainBox, radiiOf } from '../model/shapes'

export type Drawable = Exclude<Paint, { type: 'IMAGE' }>

/** Where an image is drawn in a `w`×`h` node (node px), given its pixel size. `tile`: repeat it from there in both directions. */
export function imageBox(p: ImagePaint, w: number, h: number, iw: number, ih: number): { x: number; y: number; w: number; h: number; tile: boolean } {
  const mode = p.scaleMode ?? 'FILL', s = p.scale ?? 1, ox = p.offsetX ?? 0, oy = p.offsetY ?? 0
  if (mode === 'TILE') return { x: ox, y: oy, w: iw * s, h: ih * s, tile: true }
  const k = mode === 'FIT' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih) * (mode === 'CROP' ? s : 1)
  const dx = mode === 'CROP' ? ox : 0, dy = mode === 'CROP' ? oy : 0
  return { x: (w - iw * k) / 2 + dx, y: (h - ih * k) / 2 + dy, w: iw * k, h: ih * k, tile: false }
}

/**
 * The paints a node draws, in paint order. Lines take no fill and text no image; strokes need a weight and are never
 * images. A group draws no fills or shadows of its own. A shadow is cast when the node has any visible fill or stroke.
 * Blurs are radii (the largest visible one wins); a group takes a layer blur only, and text and lines no background blur.
 */
export function paintsOf(n: Node): { fills: Paint[]; strokes: Drawable[]; shadows: DropShadow[]; inner: InnerShadow[]; layerBlur: number; bgBlur: number } {
  const visible = <T extends { visible: boolean }>(list: T[]) => list.filter((p) => p.visible)
  const stroked = n.strokeWeight > 0 ? visible(n.strokes) : []
  const strokes = stroked.filter((p): p is Drawable => p.type !== 'IMAGE')
  const fx = visible(n.effects)
  const radius = (t: Blur['type']) => Math.max(0, ...fx.filter((e): e is Blur => e.type === t).map((e) => e.blur))
  const layerBlur = radius('LAYER_BLUR')
  if (n.type === 'GROUP') return { fills: [], strokes, shadows: [], inner: [], layerBlur, bgBlur: 0 }
  const fills = n.type === 'LINE' ? [] : visible(n.fills).filter((p) => !(p.type === 'IMAGE' && n.type === 'TEXT'))
  const cast = visible(n.fills).length || stroked.length
  const canBackdrop = n.type !== 'TEXT' && n.type !== 'LINE'
  return {
    fills, strokes, layerBlur, bgBlur: canBackdrop ? radius('BACKGROUND_BLUR') : 0,
    shadows: cast ? fx.filter((e): e is DropShadow => e.type === undefined || e.type === 'DROP_SHADOW') : [],
    inner: cast && canBackdrop ? fx.filter((e): e is InnerShadow => e.type === 'INNER_SHADOW') : [],
  }
}

/** How far a stroke's centre line sits outside the node's outline: inside strokes in, outside ones out. Lines centre. */
export const strokeGrow = (n: Node) =>
  n.type === 'LINE' || n.strokeAlign === 'CENTER' ? 0 : n.strokeAlign === 'INSIDE' ? -n.strokeWeight / 2 : n.strokeWeight / 2

/**
 * The node's box grown outward by `grow` on every side, its corner radii grown to match (clamped to fit).
 * `plain`: one radius for every corner and no smoothing, so a plain rounded rectangle (radius `r`) draws it.
 */
export function grownBox(n: Node, grow: number): { w: number; h: number; r: number; radii: number[]; plain: boolean } {
  const w = Math.max(0, n.width + grow * 2), h = Math.max(0, n.height + grow * 2)
  const radii = radiiOf(n).map((r) => (r ? Math.max(0, Math.min(r + grow, w / 2, h / 2)) : 0))
  return { w, h, r: radii[0], radii, plain: isPlainBox(n) }
}

/** Nodes drawn from `n.vector`'s paths: a VECTOR, a BOOLEAN (whose children are only its operands and are not drawn), a STAR or POLYGON (computed). */
export const hasPath = (n: Node) => ['VECTOR', 'BOOLEAN', 'STAR', 'POLYGON'].includes(n.type)

/** Shapes that can be a mask: they have a filled outline to clip with. Text, lines and groups can't (yet). */
export const canMask = (n: Node) => ['RECTANGLE', 'FRAME', 'ELLIPSE', 'VECTOR', 'BOOLEAN', 'STAR', 'POLYGON'].includes(n.type)
/** Marked as a mask and able to be one: it draws nothing and clips the siblings above it. */
export const isMask = (n: Node) => !!n.mask && canMask(n)

/** A VECTOR imported with its stroke already outlined: the stroke is drawn by filling those paths. */
export const outlinedStroke = (n: Node) => n.type === 'VECTOR' && n.vector!.stroke.length > 0

/** Dash, cap and join of a node's stroke, in the names both canvas and SVG use. */
export const strokeStyle = (n: Node) => ({
  dash: (n.strokeDash ?? []).some((d) => d > 0) ? n.strokeDash! : [],
  cap: ({ NONE: 'butt', ROUND: 'round', SQUARE: 'square' } as const)[n.strokeCap ?? 'NONE'],
  join: ({ MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' } as const)[n.strokeJoin ?? 'MITER'],
})

/** Per-side stroke weights as path data of four edge rectangles (inside the box), or undefined for a uniform stroke. */
export function sidesPath(n: Node): string | undefined {
  if (!n.strokeSides || (n.type !== 'RECTANGLE' && n.type !== 'FRAME')) return undefined
  const [t, r, b, l] = n.strokeSides, w = n.width, h = n.height
  const rect = (x: number, y: number, rw: number, rh: number) => `M${x} ${y}L${x + rw} ${y}L${x + rw} ${y + rh}L${x} ${y + rh}Z`
  // shortcut: corner radii and stroke align are ignored; upgrade by clipping to the rounded outline
  return rect(0, 0, w, t) + rect(w - r, 0, r, h) + rect(0, h - b, w, b) + rect(0, 0, l, h)
}

/** The end markers (arrowheads) of a LINE or open VECTOR, as filled polygons in the node's space. */
export function endMarks(n: Node): number[][][] {
  const start = n.strokeStart ?? 'NONE', end = n.strokeEnd ?? 'NONE'
  if ((start === 'NONE' && end === 'NONE') || !paintsOf(n).strokes.length) return []
  let pts: number[][] | undefined // shortcut: a curve's end direction is taken from its neighbouring control point, only the first path counts
  if (n.type === 'LINE') pts = [[0, 0], [n.width, 0]]
  else if (n.type === 'VECTOR' && n.vector!.fill.length && !/[Zz]/.test(n.vector!.fill[0].d)) {
    const nums = (n.vector!.fill[0].d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number), s = vectorScale(n)
    pts = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] * s.x, nums[i + 1] * s.y])
  }
  if (!pts || pts.length < 2) return []
  const size = Math.max(6, n.strokeWeight * 4), marks: number[][][] = []
  const mark = (kind: (typeof start), tip: number[], from: number[]) => {
    const dx = tip[0] - from[0], dy = tip[1] - from[1], len = Math.hypot(dx, dy)
    if (kind === 'NONE' || !len) return
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux
    const at = (a: number, b: number) => [tip[0] - ux * a + nx * b, tip[1] - uy * a + ny * b] // a back along the line, b sideways
    marks.push(
      kind === 'TRIANGLE' ? [at(0, 0), at(size, size * 0.6), at(size, -size * 0.6)]
      : kind === 'ARROW' ? [at(0, 0), at(size, size * 0.6), at(size * 0.6, 0), at(size, -size * 0.6)]
      : kind === 'DIAMOND' ? [at(0, 0), at(size / 2, size * 0.4), at(size, 0), at(size / 2, -size * 0.4)]
      : Array.from({ length: 16 }, (_, i) => at(size / 2 + (Math.cos((i / 16) * 2 * Math.PI) * size) / 2, (Math.sin((i / 16) * 2 * Math.PI) * size) / 2)),
    )
  }
  // direction points outward from the path: use the nearest point that isn't the tip itself
  const far = (from: number, step: number) => { let i = from + step; while (pts![i] && Math.hypot(pts![i][0] - pts![from][0], pts![i][1] - pts![from][1]) < 1e-6) i += step; return pts![i] ?? pts![from - step] }
  mark(start, pts[0], far(0, 1))
  mark(end, pts[pts.length - 1], far(pts.length - 1, -1))
  return marks
}
