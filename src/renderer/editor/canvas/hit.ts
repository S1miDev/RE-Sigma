import type { Document } from '../../../shared/document'
import { apply, contains, intersects, invert, localMatrix, worldBox, worldMatrix, type Box, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'

/**
 * Top-most visible, unlocked node under a page point. A group answers for its children unless `deep`;
 * a frame's children are always reachable directly (as in Figma).
 */
export function hitTest(doc: Document, pageId: string, p: Pt, opts: { deep?: boolean; tolerance?: number } = {}): string | null {
  const tol = opts.tolerance ?? 0
  const hit = (parentId: string, at: Pt): string | null => {
    for (const n of childrenOf(doc, parentId).toReversed()) {
      if (!n.visible || n.locked) continue
      const q = apply(invert(localMatrix(n)), at)
      const inside = q.x >= 0 && q.x <= n.width && q.y >= 0 && q.y <= n.height
      if (n.type === 'FRAME') {
        if (n.clipsContent && !inside) continue
        const inner = hit(n.id, q)
        if (inner || inside) return inner ?? n.id
      } else if (n.type === 'GROUP') {
        const inner = hit(n.id, q)
        if (inner) return opts.deep ? inner : n.id
      } else if (n.type === 'ELLIPSE') {
        const rx = n.width / 2, ry = n.height / 2
        if (rx && ry && ((q.x - rx) / rx) ** 2 + ((q.y - ry) / ry) ** 2 <= 1) return n.id
      } else if (n.type === 'LINE') {
        const reach = Math.max(n.strokeWeight / 2, tol)
        if (Math.abs(q.y) <= reach && q.x >= -reach && q.x <= n.width + reach) return n.id
      } else if (inside) return n.id
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
      if (n.type !== 'FRAME' || !n.visible || n.locked || exclude.includes(n.id)) continue
      const q = apply(invert(worldMatrix(doc, n.id)), p)
      if (q.x >= 0 && q.x <= n.width && q.y >= 0 && q.y <= n.height) return find(n.id)
    }
    return parentId
  }
  return find(pageId)
}
