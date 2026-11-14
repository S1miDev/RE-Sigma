// Outlines for the shapes that are not a plain box: rounded and "smoothed" rectangles, ellipse arcs, stars, polygons, arrows.
// Paths use the .refig vocabulary (absolute M L C Z) in the node's own box, so every renderer can draw them as path data.
import type { Arc, Document, Node } from '../../../shared/document'
import { fmt as f, rad, type Pt } from './geometry'
import type { Sub } from './path'

const KAPPA = 0.5522847498 // a quarter circle as one cubic Bézier

/** The four corner radii (top-left, top-right, bottom-right, bottom-left). */
export const radiiOf = (n: Pick<Node, 'cornerRadius' | 'cornerRadii'>): [number, number, number, number] => n.cornerRadii ?? [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius]
/** Whether a box draws as a plain `roundRect`/`<rect rx>`: one radius for every corner and no smoothing. */
export const isPlainBox = (n: Pick<Node, 'cornerRadius' | 'cornerRadii' | 'cornerSmoothing'>) => !n.cornerSmoothing && radiiOf(n).every((r) => r === radiiOf(n)[0])

const pt = (p: Pt) => `${f(p.x)} ${f(p.y)}`

/**
 * One corner in a local frame: the vertex at (0, 0), the path arriving along +x and leaving along +y. `p` is how far
 * before the vertex the curve starts. Figma's smoothing (as in the open "figma-squircle" construction): the circular
 * arc shrinks to 90°·(1−s) and a Bézier on each side eases the curvature in and out. Returns [start, ...cubics].
 */
function corner(r: number, s: number, budget: number): { start: Pt; curves: [Pt, Pt, Pt][]; end: Pt } {
  if (r <= 0) return { start: { x: 0, y: 0 }, curves: [], end: { x: 0, y: 0 } }
  r = Math.min(r, budget)
  if (!s) {
    const k = KAPPA * r
    return { start: { x: -r, y: 0 }, curves: [[{ x: -r + k, y: 0 }, { x: 0, y: r - k }, { x: 0, y: r }]], end: { x: 0, y: r } }
  }
  s = Math.min(s, Math.max(0, budget / r - 1)) // the eased corner must still fit the box
  const p = Math.min((1 + s) * r, budget), measure = 90 * (1 - s), beta = 45 * s
  const half = Math.sin(rad(measure / 2)) * r * Math.SQRT2 // each component of the arc's chord
  const toP4 = r * Math.tan(rad((90 - measure) / 4))
  const c = toP4 * Math.cos(rad(beta)), d = c * Math.tan(rad(beta))
  const b = (p - half - c - d) / 3, a = 2 * b
  const e0 = { x: -p + a + b + c, y: d }, e1 = { x: e0.x + half, y: e0.y + half }
  const k = (4 / 3) * Math.tan(rad(measure / 4)) * r
  return {
    start: { x: -p, y: 0 },
    curves: [
      [{ x: -p + a, y: 0 }, { x: -p + a + b, y: 0 }, e0],
      [{ x: e0.x + k * Math.cos(rad(beta)), y: e0.y + k * Math.sin(rad(beta)) }, { x: e1.x - k * Math.cos(rad(beta + measure)), y: e1.y - k * Math.sin(rad(beta + measure)) }, e1],
      [{ x: e1.x + d, y: e1.y + c }, { x: e1.x + d, y: e1.y + b + c }, { x: 0, y: p }],
    ],
    end: { x: 0, y: p },
  }
}

/** A w×h rectangle with these corner radii (top-left, top-right, bottom-right, bottom-left) and smoothing (0–1), as path data. */
export function cornerPath(w: number, h: number, radii: number[], smoothing = 0): string {
  const budget = Math.min(w, h) / 2
  // each corner: its vertex and the directions the path arrives and leaves along (clockwise from the top-right)
  const corners = [
    { r: radii[1], v: { x: w, y: 0 }, u: { x: 1, y: 0 }, o: { x: 0, y: 1 } },
    { r: radii[2], v: { x: w, y: h }, u: { x: 0, y: 1 }, o: { x: -1, y: 0 } },
    { r: radii[3], v: { x: 0, y: h }, u: { x: -1, y: 0 }, o: { x: 0, y: -1 } },
    { r: radii[0], v: { x: 0, y: 0 }, u: { x: 0, y: -1 }, o: { x: 1, y: 0 } },
  ]
  let d = ''
  corners.forEach(({ r, v, u, o }, i) => {
    const place = (q: Pt): Pt => ({ x: v.x + q.x * u.x + q.y * o.x, y: v.y + q.x * u.y + q.y * o.y })
    const { start, curves } = corner(r, smoothing, budget)
    d += `${i ? 'L' : 'M'}${pt(place(start))}`
    for (const [c1, c2, e] of curves) d += `C${pt(place(c1))} ${pt(place(c2))} ${pt(place(e))}`
  })
  return d + 'Z'
}

/** `sweep` degrees of the unit circle from `start` as cubic segments: [control 1, control 2, end] on the ellipse (cx, cy, rx, ry). */
function arcSegments(cx: number, cy: number, rx: number, ry: number, start: number, sweep: number): [Pt, Pt, Pt][] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9)), step = sweep / n, k = (4 / 3) * Math.tan(rad(step / 4))
  const at = (deg: number, dist = 1): Pt => ({ x: cx + rx * dist * Math.cos(rad(deg)), y: cy + ry * dist * Math.sin(rad(deg)) })
  return Array.from({ length: n }, (_, i) => {
    const a0 = start + i * step, a1 = a0 + step
    const p0 = at(a0), p1 = at(a1)
    const t0 = { x: -rx * Math.sin(rad(a0)) * k, y: ry * Math.cos(rad(a0)) * k }, t1 = { x: -rx * Math.sin(rad(a1)) * k, y: ry * Math.cos(rad(a1)) * k }
    return [{ x: p0.x + t0.x, y: p0.y + t0.y }, { x: p1.x - t1.x, y: p1.y - t1.y }, p1]
  })
}
const run = (segs: [Pt, Pt, Pt][]) => segs.map(([a, b, c]) => `C${pt(a)} ${pt(b)} ${pt(c)}`).join('')

/** An ellipse sector (inner 0) or ring segment in a w×h box. Angles run clockwise from 3 o'clock; a full ring is two opposite circles. */
export function arcPath(w: number, h: number, { start, sweep, inner }: Arc): string {
  const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2, full = Math.abs(sweep) >= 360
  const s = full ? Math.sign(sweep || 1) * 360 : sweep, end = start + s
  const ri = Math.min(Math.max(inner, 0), 0.999)
  const onOuter = (deg: number) => ({ x: cx + rx * Math.cos(rad(deg)), y: cy + ry * Math.sin(rad(deg)) })
  const onInner = (deg: number) => ({ x: cx + rx * ri * Math.cos(rad(deg)), y: cy + ry * ri * Math.sin(rad(deg)) })
  const outer = run(arcSegments(cx, cy, rx, ry, start, s))
  if (full) return `M${pt(onOuter(start))}${outer}Z` + (ri ? `M${pt(onInner(start))}${run(arcSegments(cx, cy, rx * ri, ry * ri, start, -s))}Z` : '')
  if (!ri) return `M${pt({ x: cx, y: cy })}L${pt(onOuter(start))}${outer}Z`
  return `M${pt(onOuter(start))}${outer}L${pt(onInner(end))}${run(arcSegments(cx, cy, rx * ri, ry * ri, end, -s))}Z`
}

/** A star (`inner` < 1: 2·points vertices alternating outer and inner) or regular polygon (`inner` 1: `points` vertices) inscribed in the box, first vertex up. */
export function starPath(w: number, h: number, points: number, inner: number): string {
  const n = Math.max(3, Math.round(points)), star = inner < 1, count = star ? 2 * n : n
  const rx = w / 2, ry = h / 2
  return Array.from({ length: count }, (_, i) => {
    const deg = -90 + (i * 360) / count, k = star && i % 2 ? inner : 1
    return `${i ? 'L' : 'M'}${f(rx + rx * k * Math.cos(rad(deg)))} ${f(ry + ry * k * Math.sin(rad(deg)))}`
  }).join('') + 'Z'
}

/** A line from `a` to `b` with a filled triangular head at `b`, as two subpaths. */
export function arrowSubs(a: Pt, b: Pt, head: number): Sub[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, size = Math.min(head, len), dx = (b.x - a.x) / len, dy = (b.y - a.y) / len
  const base = { x: b.x - dx * size, y: b.y - dy * size }
  return [
    { anchors: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], closed: false },
    { anchors: [{ x: b.x, y: b.y }, { x: base.x - dy * size * 0.45, y: base.y + dx * size * 0.45 }, { x: base.x + dy * size * 0.45, y: base.y - dx * size * 0.45 }], closed: true },
  ]
}

/** The `vector` a STAR or POLYGON should have. */
export function starVector(n: Node): NonNullable<Node['vector']> {
  return { w: n.width, h: n.height, fill: [{ d: starPath(n.width, n.height, n.points ?? 5, n.type === 'STAR' ? (n.innerRatio ?? 0.38) : 1), rule: 'nonzero' }], stroke: [] }
}

/** Rebuilds the outline of every star and polygon edited from `prev` to `next`. */
export function syncShapes(prev: Document, next: Document): Document {
  let out = next
  for (const n of Object.values(next.nodes)) {
    if ((n.type !== 'STAR' && n.type !== 'POLYGON') || prev.nodes[n.id] === n) continue
    const vector = starVector(n), old = n.vector
    if (old && old.w === vector.w && old.h === vector.h && old.fill[0]?.d === vector.fill[0].d) continue
    out = { ...out, nodes: { ...out.nodes, [n.id]: { ...n, vector } } }
  }
  return out
}
