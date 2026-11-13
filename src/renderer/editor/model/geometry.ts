// 2D affine maths for nodes. A node's box is rotated about its centre and placed in its parent's space.
import type { Document, Node } from '../../../shared/document'

export type Pt = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (same layout as canvas/SVG matrices). */
export type Mat = [number, number, number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
export const rad = (deg: number) => (deg * Math.PI) / 180
export const deg = (r: number) => (r * 180) / Math.PI
export const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
/** m ∘ n: apply n first, then m. */
export const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

/** Box-local coordinates → parent coordinates. */
export function localMatrix(n: Pick<Node, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Mat {
  const c = Math.cos(rad(n.rotation)), s = Math.sin(rad(n.rotation)), hw = n.width / 2, hh = n.height / 2
  return [c, s, -s, c, n.x + hw - (c * hw - s * hh), n.y + hh - (s * hw + c * hh)]
}
/** The x/y of a w×h box with this rotation whose local (0, 0) lands on `origin` (parent coordinates). Inverse of localMatrix's translation. */
export function boxAt(rotation: number, width: number, height: number, origin: Pt) {
  const c = Math.cos(rad(rotation)), s = Math.sin(rad(rotation)), hw = width / 2, hh = height / 2
  return { x: origin.x - hw + (c * hw - s * hh), y: origin.y - hh + (s * hw + c * hh), width, height }
}
/** Box-local coordinates → page coordinates. A PAGE is the identity. */
export function worldMatrix(doc: Document, id: string | null): Mat {
  let m = IDENTITY
  for (let n = id ? doc.nodes[id] : undefined; n && n.type !== 'PAGE'; n = n.parentId ? doc.nodes[n.parentId] : undefined) m = mul(localMatrix(n), m)
  return m
}
export function worldRotation(doc: Document, id: string | null): number {
  let r = 0
  for (let n = id ? doc.nodes[id] : undefined; n && n.type !== 'PAGE'; n = n.parentId ? doc.nodes[n.parentId] : undefined) r += n.rotation
  return r
}

export const boxCorners = (n: Pick<Node, 'width' | 'height'>): Pt[] => [{ x: 0, y: 0 }, { x: n.width, y: 0 }, { x: n.width, y: n.height }, { x: 0, y: n.height }]
/** The node's four corners in page coordinates. */
export const corners = (doc: Document, id: string): Pt[] => boxCorners(doc.nodes[id]).map((p) => apply(worldMatrix(doc, id), p))

export function bounds(pts: Pt[]): Box | null {
  if (!pts.length) return null
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
/** Axis-aligned bounding box of the nodes, in page coordinates. */
export const worldBox = (doc: Document, ids: string[]): Box | null => bounds(ids.filter((id) => doc.nodes[id]).flatMap((id) => corners(doc, id)))
export const intersects = (a: Box, b: Box) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
export const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h

/** New box for a resize handle (hx, hy ∈ -1|0|1) dragged to p (parent coordinates). The opposite edge stays put. */
export function resizeBox(n: Node, hx: number, hy: number, p: Pt, mod: { shift?: boolean; alt?: boolean } = {}) {
  const c = Math.cos(rad(n.rotation)), s = Math.sin(rad(n.rotation))
  const cx = n.x + n.width / 2, cy = n.y + n.height / 2
  // pointer in the box's own axes, relative to its centre
  const qx = c * (p.x - cx) + s * (p.y - cy), qy = -s * (p.x - cx) + c * (p.y - cy)
  let l = -n.width / 2, r = n.width / 2, t = -n.height / 2, b = n.height / 2
  if (hx > 0) r = qx
  if (hx < 0) l = qx
  if (hy > 0) b = qy
  if (hy < 0) t = qy
  if (mod.shift && n.width && n.height) {
    const ratio = n.width / n.height
    if (hx && hy) {
      const w = Math.max(Math.abs(r - l), Math.abs(b - t) * ratio), h = w / ratio
      if (hx > 0) r = l + w * Math.sign(r - l || 1); else l = r - w * Math.sign(r - l || 1)
      if (hy > 0) b = t + h * Math.sign(b - t || 1); else t = b - h * Math.sign(b - t || 1)
    } else if (hx) { const h = Math.abs(r - l) / ratio; t = -h / 2; b = h / 2 }
    else { const w = Math.abs(b - t) * ratio; l = -w / 2; r = w / 2 }
  }
  if (mod.alt) {
    if (hx > 0) l = -r; else if (hx < 0) r = -l
    if (hy > 0) t = -b; else if (hy < 0) b = -t
  }
  const width = Math.max(1, Math.abs(r - l)), height = hy || n.height ? Math.max(n.height ? 1 : 0, Math.abs(b - t)) : 0
  const mx = (l + r) / 2, my = (t + b) / 2 // new centre in box axes
  return { x: cx + c * mx - s * my - width / 2, y: cy + s * mx + c * my - height / 2, width, height }
}

/** A LINE node's geometry from its two end points (parent coordinates). */
export function lineBetween(a: Pt, b: Pt) {
  const width = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (a.x + b.x) / 2 - width / 2, y: (a.y + b.y) / 2, width, height: 0, rotation: deg(Math.atan2(b.y - a.y, b.x - a.x)) }
}
