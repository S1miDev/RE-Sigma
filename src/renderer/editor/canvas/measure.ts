// Alt-hover measurement: the distances between two boxes, as labelled segments in world coordinates.
import type { Box } from '../model/geometry'

export interface Segment { x1: number; y1: number; x2: number; y2: number; label: string }

const mid = (a0: number, a1: number, b0: number, b1: number) => (Math.max(a0, b0) + Math.min(a1, b1)) / 2

/** Gaps between `a` (the selection) and `b` (the hovered layer). Boxes that overlap on an axis give edge offsets instead of a gap. */
export function measure(a: Box, b: Box): Segment[] {
  const ar = a.x + a.w, ab = a.y + a.h, br = b.x + b.w, bb = b.y + b.h
  const xOver = a.x < br && b.x < ar, yOver = a.y < bb && b.y < ab, out: Segment[] = []
  const add = (x1: number, y1: number, x2: number, y2: number, len: number) => { if (len > 0) out.push({ x1, y1, x2, y2, label: String(Math.round(len * 10) / 10) }) }
  const cx = xOver ? mid(a.x, ar, b.x, br) : (a.x + ar) / 2, cy = yOver ? mid(a.y, ab, b.y, bb) : (a.y + ab) / 2
  if (!xOver) { const [l, r] = ar <= b.x ? [ar, b.x] : [br, a.x]; add(l, cy, r, cy, r - l) }
  if (!yOver) { const [t, u] = ab <= b.y ? [ab, b.y] : [bb, a.y]; add(cx, t, cx, u, u - t) }
  if (xOver && yOver) {
    add(Math.min(a.x, b.x), cy, Math.max(a.x, b.x), cy, Math.abs(a.x - b.x))
    add(Math.min(ar, br), cy, Math.max(ar, br), cy, Math.abs(ar - br))
    add(cx, Math.min(a.y, b.y), cx, Math.max(a.y, b.y), Math.abs(a.y - b.y))
    add(cx, Math.min(ab, bb), cx, Math.max(ab, bb), Math.abs(ab - bb))
  }
  return out
}
