import type { Document, Node } from '../../../shared/document'
import { apply, contains, intersects, invert, localMatrix, worldBox, worldMatrix, type Box, type Pt } from '../model/geometry'
import { childrenOf, lineage } from '../model/ops'
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
export function hitTest(doc: Document, pageId: string, p: Pt, opts: { deep?: boolean; tolerance?: number; ignoreLocked?: boolean } = {}): string | null {
  const tol = opts.tolerance ?? 0
  const hit = (parentId: string, at: Pt): string | null => {
    const kids = childrenOf(doc, parentId), masks: Node[] = []
    const clipped = (n: Node) => masks.some((m) => !containsPoint(m, apply(invert(localMatrix(m)), at), 0)) // outside a mask below it
    const order = kids.map((n) => { const out = { n, hidden: clipped(n) }; if (isMask(n) && n.visible) masks.push(n); return out })
    for (const { n, hidden } of order.toReversed()) {
      if (!n.visible || (n.locked && !opts.ignoreLocked) || hidden) continue
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

/** The layers under a page point, outermost first, down to the deepest one. Sections are left out: like the page, they only hold things. */
export function pathAt(doc: Document, pageId: string, p: Pt, tolerance?: number): string[] {
  const leaf = hitTest(doc, pageId, p, { deep: true, tolerance })
  return lineage(doc, leaf).toReversed().filter((n) => n.type !== 'PAGE' && !n.section).map((n) => n.id)
}

/**
 * What a click selects, as in Figma: the deepest layer with `deep` (Ctrl); a selected layer under the point stays
 * (so it can be dragged); a sibling of a selected layer, or the layer at that level, is the current context;
 * otherwise a top-level layer, or the child of a top-level frame.
 */
export function pick(doc: Document, pageId: string, p: Pt, selection: string[], opts: { deep?: boolean; tolerance?: number } = {}): string | null {
  const path = pathAt(doc, pageId, p, opts.tolerance)
  if (!path.length) return null
  if (opts.deep) return path.at(-1)!
  const kept = path.find((id) => selection.includes(id))
  if (kept) return kept
  for (let i = path.length - 1; i > 0; i--) if (selection.some((id) => doc.nodes[id]?.parentId === path[i - 1])) return path[i]
  return doc.nodes[path[0]].type === 'FRAME' && path.length > 1 ? path[1] : path[0]
}

/** What a double-click does: select one level deeper than the selected layer under the point, or edit that layer once it is the deepest. */
export function dive(doc: Document, pageId: string, p: Pt, selection: string[], tolerance?: number): { select: string } | { edit: string } | null {
  const path = pathAt(doc, pageId, p, tolerance), i = path.findIndex((id) => selection.includes(id))
  if (!path.length) return null
  if (i < 0) return { select: pick(doc, pageId, p, selection, { tolerance })! }
  return i === path.length - 1 ? { edit: path[i] } : { select: path[i + 1] }
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
