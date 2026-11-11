import type { Document } from '../../../shared/document'
import { worldBox, type Box } from '../model/geometry'
import { childrenOf } from '../model/ops'

export interface Guides { x?: number; y?: number }

/** Nudges moving x/y lines onto the nearest target edge or centre within `threshold`. */
export function snap(xs: number[], ys: number[], targets: Box[], threshold: number): { dx: number; dy: number; guides: Guides } {
  const axis = (moving: number[], lines: number[]) => {
    let best: { d: number; at: number } | null = null
    for (const m of moving) for (const t of lines) if (Math.abs(t - m) <= threshold && (!best || Math.abs(t - m) < Math.abs(best.d))) best = { d: t - m, at: t }
    return best
  }
  const x = axis(xs, targets.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w]))
  const y = axis(ys, targets.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h]))
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, guides: { ...(x && { x: x.at }), ...(y && { y: y.at }) } }
}

/** Boxes to snap to: visible siblings under `parentId` that aren't moving, plus the parent itself unless it's the page. */
export function snapTargets(doc: Document, parentId: string, moving: string[]): Box[] {
  const ids = childrenOf(doc, parentId).filter((n) => n.visible && !moving.includes(n.id)).map((n) => n.id)
  if (doc.nodes[parentId].type !== 'PAGE') ids.push(parentId)
  return ids.map((id) => worldBox(doc, [id])!)
}
