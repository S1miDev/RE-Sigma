import type { Document, Node } from '../../../shared/document'
import { apply, contains, intersects, invert, localMatrix, worldBox, worldMatrix, type Box, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { hasPath, isMask } from './paintPlan'

/** Whether a point (in the node's own coordinates) is on the node's shape. Vectors use their box, with slack so flat ones stay clickable. */
function containsPoint(n: Node, q: Pt, tol: number): boolean {
  if (n.type === 'ELLIPSE') {
    const rx = n.width / 2, ry = n.height / 2
    return !!rx && !!ry && ((q.x - rx) / rx) ** 2 + ((q.y - ry) / ry) ** 2 <= 1
  }
  if (n.type === 'LINE') {
    const reach = Math.max(n.strokeWeight / 2, tol)
    return Math.abs(q.y) <= reach && q.x >= -reach && q.x <= n.width + reach
  }
  const reach = hasPath(n) ? Math.max(n.strokeWeight / 2, tol) : 0
  return q.x >= -reach && q.x <= n.width + reach && q.y >= -reach && q.y <= n.height + reach
}

/**
 * Top-most visible, unlocked node under a page point. A group answers for its children unless `deep`;
 * a frame's children are always reachable directly (as in Figma).
 */
export function hitTest(doc: Document, pageId: string, p: Pt, opts: { deep?: boolean; tolerance?: number } = {}): string | null {
  const tol = opts.tolerance ?? 0
  const hit = (parentId: string, at: Pt): string | null => {
    const kids = childrenOf(doc, parentId), masks: Node[] = []
    const clipped = (n: Node) => masks.some((m) => !containsPoint(m, apply(invert(localMatrix(m)), at), 0)) // outside a mask below it
    const order = kids.map((n) => { const out = { n, hidden: clipped(n) }; if (isMask(n) && n.visible) masks.push(n); return out })
    for (const { n, hidden } of order.toReversed()) {
      if (!n.visible || n.locked || hidden) continue
      const q = apply(invert(localMatrix(n)), at)
      const inside = q.x >= 0 && q.x <= n.width && q.y >= 0 && q.y <= n.height
      if (n.type === 'FRAME') {
        if (n.clipsContent && !inside) continue
        const inner = hit(n.id, q)
        if (inner || inside) return inner ?? n.id
      } else if (n.type === 'GROUP' || n.type === 'BOOLEAN') {
        const inner = hit(n.id, q)
        if (inner) return opts.deep ? inner : n.id
      } else if (containsPoint(n, q, tol)) return n.id
    }
    return null
  }
  return hit(pageId, p)
}

/** Nodes touched by a marquee. A frame is taken whole only when fully enclosed; otherwise its children are tested. */
export function marqueeHits(doc: Document, pageId: string, box: Box): string[] {
  const out: string[] = []
  const collect = (parentId: string) => {
    for (const n of childrenOf(doc, parentId)) {
      if (!n.visible || n.locked) continue
      const b = worldBox(doc, [n.id])!
      if (!intersects(b, box)) continue
      if (n.type === 'FRAME' && !contains(box, b)) collect(n.id)
      else out.push(n.id)
    }
  }
  collect(pageId)
  return out
}

/** The deepest frame under a page point (where a dropped or new node should live), or the page. */
export function frameAt(doc: Document, pageId: string, p: Pt, exclude: string[] = []): string {
  const find = (parentId: string): string => {
    for (const n of childrenOf(doc, parentId).toReversed()) {
      if (n.type !== 'FRAME' || !n.visible || n.locked || n.instanceOf || exclude.includes(n.id)) continue // instances take no new children
      const q = apply(invert(worldMatrix(doc, n.id)), p)
      if (q.x >= 0 && q.x <= n.width && q.y >= 0 && q.y <= n.height) return find(n.id)
    }
    return parentId
  }
  return find(pageId)
}
