// Editable paths: a VECTOR's path data as anchors with Bézier handles, and back.
import type { Node } from '../../../shared/document'
import { apply, bounds, boxAt, fmt, localMatrix, type Pt } from './geometry'

/** A point on a path. `in`/`out` are its Bézier handles, in the same coordinates as the point. */
export type Anchor = { x: number; y: number; in?: Pt; out?: Pt }
export type Sub = { anchors: Anchor[]; closed: boolean }

const ARGS: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 }
const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

/** Path data using absolute M L C Q Z (the .refig vocabulary) → subpaths. A quadratic becomes the equal cubic. */
export function parsePath(d: string): Sub[] {
  const tokens = d.match(/[MLCQZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gi) ?? []
  const subs: Sub[] = []
  let cmd = '', i = 0
  const num = () => Number(tokens[i++])
  const close = (s: Sub) => {
    s.closed = true
    // a closing segment back onto the start point is folded into the start anchor
    const first = s.anchors[0], last = s.anchors.at(-1)!
    if (s.anchors.length > 1 && same(first, last)) { first.in = last.in; s.anchors.pop() }
  }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++].toUpperCase()
    else if (!cmd || cmd === 'Z') { i++; continue } // a stray number
    const sub = subs.at(-1)
    if (cmd === 'Z') { if (sub && !sub.closed) close(sub); continue }
    if (i + ARGS[cmd] > tokens.length) break
    if (cmd === 'M' || !sub || sub.closed) {
      // M starts a subpath; drawing on after Z starts a new one at the same point, as SVG does
      const at = cmd === 'M' ? { x: num(), y: num() } : { ...sub!.anchors[0] }
      subs.push({ anchors: [{ x: at.x, y: at.y }], closed: false })
      if (cmd === 'M') { cmd = 'L'; continue } // further pairs after M are line-tos
    }
    const s = subs.at(-1)!, prev = s.anchors.at(-1)!
    if (cmd === 'L') s.anchors.push({ x: num(), y: num() })
    else if (cmd === 'C') {
      const c1 = { x: num(), y: num() }, c2 = { x: num(), y: num() }, p = { x: num(), y: num() }
      // a control point on its own anchor is no handle (a curve with one straight end is written that way)
      if (!same(c1, prev)) prev.out = c1
      s.anchors.push(same(c2, p) ? p : { ...p, in: c2 })
    } else {
      const q = { x: num(), y: num() }, p = { x: num(), y: num() }
      prev.out = { x: prev.x + (2 / 3) * (q.x - prev.x), y: prev.y + (2 / 3) * (q.y - prev.y) }
      s.anchors.push({ ...p, in: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) } })
    }
  }
  return subs
}

const f = fmt
const seg = (a: Anchor, b: Anchor) => (a.out || b.in ? `C${f((a.out ?? a).x)} ${f((a.out ?? a).y)} ${f((b.in ?? b).x)} ${f((b.in ?? b).y)} ${f(b.x)} ${f(b.y)}` : `L${f(b.x)} ${f(b.y)}`)

/** Subpaths → path data with M L C Z only. */
export function pathData(subs: Sub[]): string {
  return subs.filter((s) => s.anchors.length).map(({ anchors: a, closed }) => {
    let d = `M${f(a[0].x)} ${f(a[0].y)}`
    for (let i = 1; i < a.length; i++) d += seg(a[i - 1], a[i])
    if (closed) d += (a.at(-1)!.out || a[0].in ? seg(a.at(-1)!, a[0]) : '') + 'Z'
    return d
  }).join('')
}

/** Distance from `p` to the segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/**
 * A freehand stroke (sampled points) → a few smooth anchors: Ramer–Douglas–Peucker to `tol`, then a Catmull-Rom spline
 * through the kept points written as Bézier handles. Fewer than two distinct points → no anchors.
 * shortcut: Catmull-Rom through the kept points can wobble at sharp corners; swap for Schneider curve fitting if it shows.
 */
export function fitStroke(points: Pt[], tol: number): Anchor[] {
  const pts = points.filter((p, i) => i === 0 || !same(p, points[i - 1]))
  if (pts.length < 2) return []
  const keep = new Set([0, pts.length - 1])
  const rdp = (lo: number, hi: number) => {
    let at = -1, far = tol
    for (let i = lo + 1; i < hi; i++) { const d = segDist(pts[i], pts[lo], pts[hi]); if (d > far) { far = d; at = i } }
    if (at >= 0) { keep.add(at); rdp(lo, at); rdp(at, hi) }
  }
  rdp(0, pts.length - 1)
  const k = [...keep].sort((a, b) => a - b).map((i) => pts[i])
  if (k.length === 2) return k.map((p) => ({ x: p.x, y: p.y }))
  return k.map((p, i) => {
    const a = k[Math.max(0, i - 1)], b = k[Math.min(k.length - 1, i + 1)], tx = (b.x - a.x) / 6, ty = (b.y - a.y) / 6
    return { x: p.x, y: p.y, ...(i > 0 && { in: { x: p.x - tx, y: p.y - ty } }), ...(i < k.length - 1 && { out: { x: p.x + tx, y: p.y + ty } }) }
  })
}

/** Every point (anchors and handles) of the subpaths mapped by `fn`. */
export const mapSubs = (subs: Sub[], fn: (p: Pt) => Pt): Sub[] =>
  subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...fn(a), ...(a.in && { in: fn(a.in) }), ...(a.out && { out: fn(a.out) }) })) }))

/** How a VECTOR's path data (drawn at vector.w × vector.h) scales to the node's current size. */
export function vectorScale(n: Node): Pt {
  const v = n.vector!
  return { x: v.w ? n.width / v.w : 1, y: v.h ? n.height / v.h : 1 }
}

/** A VECTOR's fill paths as subpaths in its own box (node-local px). */
export function anchorsOf(n: Node): Sub[] {
  if (!n.vector) return []
  const s = vectorScale(n)
  return mapSubs(n.vector.fill.flatMap((p) => parsePath(p.d)), (p) => ({ x: p.x * s.x, y: p.y * s.y }))
}

/**
 * The node with these subpaths (node-local px of `n`) as its only path. The box is re-fitted to the points and placed
 * so that every point stays where it was on the page, rotation included. An imported outlined stroke is dropped: it
 * would no longer match, and a VECTOR without one strokes its fill path.
 */
export function withAnchors(n: Node, subs: Sub[]): Node {
  // shortcut: the box wraps the handles too, so it can be a little larger than a curve; compute exact Bézier bounds if that matters.
  const b = bounds(subs.flatMap((s) => s.anchors.flatMap((a) => [a, ...(a.in ? [a.in] : []), ...(a.out ? [a.out] : [])]))) ?? { x: 0, y: 0, w: 0, h: 0 }
  const local = mapSubs(subs, (p) => ({ x: p.x - b.x, y: p.y - b.y }))
  const box = boxAt(n.rotation, b.w, b.h, apply(localMatrix(n), { x: b.x, y: b.y }))
  return { ...n, ...box, vector: { w: b.w, h: b.h, fill: [{ d: pathData(local), rule: n.vector?.fill[0]?.rule ?? 'nonzero' }], stroke: [] } }
}
