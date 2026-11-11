// Pure document operations: (doc, …) → new doc. Documents are immutable; unchanged nodes keep their identity.
import { isContainer, makeNode, solid, type Document, type Node } from '../../../shared/document'
import { orderBetween } from '../../../shared/order'
import { apply, bounds, boxCorners, invert, localMatrix, worldMatrix, worldRotation, type Pt } from './geometry'

const byOrder = (a: Node, b: Node) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)
const indexes = new WeakMap<Document, Map<string, Node[]>>()

/** Children of a node, bottom-most first. Cached per document. */
export function childrenOf(doc: Document, parentId: string): Node[] {
  let index = indexes.get(doc)
  if (!index) {
    index = new Map()
    for (const n of Object.values(doc.nodes)) if (n.parentId) index.set(n.parentId, [...(index.get(n.parentId) ?? []), n])
    for (const list of index.values()) list.sort(byOrder)
    indexes.set(doc, index)
  }
  return index.get(parentId) ?? []
}
export const descendants = (doc: Document, id: string): Node[] => childrenOf(doc, id).flatMap((c) => [c, ...descendants(doc, c.id)])
export function pageOf(doc: Document, id: string): string | null {
  let n: Node | undefined = doc.nodes[id]
  while (n && n.type !== 'PAGE') n = n.parentId ? doc.nodes[n.parentId] : undefined
  return n?.id ?? null
}
export function isAncestor(doc: Document, ancestor: string, id: string): boolean {
  for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) if (n.parentId === ancestor) return true
  return false
}
function depth(doc: Document, id: string) {
  let d = 0
  for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) d++
  return d
}
/** Existing non-page ids with no selected ancestor, in document (z) order. */
export function topLevel(doc: Document, ids: string[]): string[] {
  const set = new Set(ids.filter((id) => doc.nodes[id] && doc.nodes[id].type !== 'PAGE'))
  // ' ' sorts below every order-key character, so a node's subtree sorts right after the node itself
  const path = (id: string): string => (doc.nodes[id].parentId ? `${path(doc.nodes[id].parentId!)} ${doc.nodes[id].order}` : '')
  return [...set].filter((id) => ![...set].some((a) => isAncestor(doc, a, id))).sort((a, b) => (path(a) < path(b) ? -1 : 1))
}

export const put = (doc: Document, nodes: Node[]): Document => ({ ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(nodes.map((n) => [n.id, n])) } })
export const patch = (doc: Document, ids: string[], change: Partial<Node> | ((n: Node) => Partial<Node>)): Document =>
  put(doc, ids.filter((id) => doc.nodes[id]).map((id) => ({ ...doc.nodes[id], ...(typeof change === 'function' ? change(doc.nodes[id]) : change) })))

/** "Rectangle 3": the next free number for a base name. */
export function nextName(doc: Document, base: string): string {
  let max = 0
  for (const n of Object.values(doc.nodes)) if (n.name.startsWith(`${base} `)) max = Math.max(max, Number(n.name.slice(base.length + 1)) || 0)
  return `${base} ${max + 1}`
}

const topOrder = (doc: Document, parentId: string) => orderBetween(childrenOf(doc, parentId).at(-1)?.order)

/** Adds a node on top of its parent's children. */
export const insert = (doc: Document, node: Node, parentId: string): Document => put(doc, [{ ...node, parentId, order: topOrder(doc, parentId) }])

export function remove(doc: Document, ids: string[]): Document {
  const gone = new Set(ids.filter((id) => doc.nodes[id] && doc.nodes[id].type !== 'PAGE').flatMap((id) => [id, ...descendants(doc, id).map((n) => n.id)]))
  if (!gone.size) return doc
  return { ...doc, nodes: Object.fromEntries(Object.entries(doc.nodes).filter(([id]) => !gone.has(id))) }
}

/** Moves each node by a page-space delta. */
export function translate(doc: Document, ids: string[], d: Pt): Document {
  return patch(doc, ids, (n) => {
    const m = invert(worldMatrix(doc, n.parentId)) // only the linear part matters for a delta
    return { x: n.x + m[0] * d.x + m[2] * d.y, y: n.y + m[1] * d.x + m[3] * d.y }
  })
}

/**
 * Reparents nodes, keeping their place on the page. `at` positions them in z-order: above `after`, below `before`,
 * or on top by default. Nodes can't move into themselves or their descendants.
 */
export function moveTo(doc: Document, ids: string[], parentId: string, at: { before?: string; after?: string } = {}): Document {
  const parent = doc.nodes[parentId]
  if (!parent || !isContainer(parent)) return doc
  const moving = topLevel(doc, ids).filter((id) => id !== parentId && !isAncestor(doc, id, parentId))
  if (!moving.length) return doc
  const siblings = childrenOf(doc, parentId).filter((n) => !moving.includes(n.id))
  const i = siblings.findIndex((n) => n.id === (at.before ?? at.after))
  let lo = (i < 0 ? siblings.at(-1) : at.before ? siblings[i - 1] : siblings[i])?.order ?? ''
  const hi = (i < 0 ? undefined : at.before ? siblings[i] : siblings[i + 1])?.order ?? ''
  const toParent = invert(worldMatrix(doc, parentId)), parentRotation = worldRotation(doc, parentId)
  return put(doc, moving.map((id) => {
    const n = doc.nodes[id]
    const centre = apply(toParent, apply(worldMatrix(doc, id), { x: n.width / 2, y: n.height / 2 }))
    lo = orderBetween(lo, hi)
    return { ...n, parentId, order: lo, x: centre.x - n.width / 2, y: centre.y - n.height / 2, rotation: worldRotation(doc, id) - parentRotation }
  }))
}

/** Shrinks/grows a container's box to wrap its children without moving them on the page. */
export function fit(doc: Document, id: string): Document {
  const g = doc.nodes[id], kids = childrenOf(doc, id)
  const b = bounds(kids.flatMap((k) => boxCorners(k).map((p) => apply(localMatrix(k), p))))
  if (!b) return doc
  const near = (a: number, c: number) => Math.abs(a - c) < 1e-6
  if (near(b.x, 0) && near(b.y, 0) && near(b.w, g.width) && near(b.h, g.height)) return doc
  const centre = apply(localMatrix(g), { x: b.x + b.w / 2, y: b.y + b.h / 2 })
  return put(doc, [
    { ...g, x: centre.x - b.w / 2, y: centre.y - b.h / 2, width: b.w, height: b.h },
    ...kids.map((k) => ({ ...k, x: k.x - b.x, y: k.y - b.y })),
  ])
}
/** Groups always wrap their children; a group with no children is removed. */
export function fitGroups(doc: Document): Document {
  const groups = Object.values(doc.nodes).filter((n) => n.type === 'GROUP').sort((a, b) => depth(doc, b.id) - depth(doc, a.id))
  for (const g of groups) doc = childrenOf(doc, g.id).length ? fit(doc, g.id) : remove(doc, [g.id])
  return doc
}

/** Sets a node's box. Resizing a group scales its children with it. */
export function resizeNode(doc: Document, id: string, box: { x: number; y: number; width: number; height: number }): Document {
  const n = doc.nodes[id]
  if (n.type === 'GROUP' && n.width && n.height) {
    // shortcut: a rotated child is scaled along the group's axes, not sheared; exact only for unrotated children.
    const sx = box.width / n.width, sy = box.height / n.height
    for (const k of childrenOf(doc, id)) doc = resizeNode(doc, k.id, { x: k.x * sx, y: k.y * sy, width: k.width * sx, height: k.height * sy })
  }
  return patch(doc, [id], { ...box, ...(n.type === 'TEXT' && box.width !== n.width && { textAutoWidth: false }) })
}

/** Wraps the nodes in a new GROUP or FRAME placed where the top-most one was. */
export function group(doc: Document, ids: string[], type: 'GROUP' | 'FRAME'): { doc: Document; id: string | null } {
  const items = topLevel(doc, ids)
  if (!items.length) return { doc, id: null }
  const top = doc.nodes[items.at(-1)!], parentId = top.parentId!
  const siblings = childrenOf(doc, parentId)
  const box = makeNode(type, {
    name: nextName(doc, type === 'GROUP' ? 'Group' : 'Frame'), parentId, clipsContent: false,
    order: orderBetween(top.order, siblings[siblings.indexOf(top) + 1]?.order),
  })
  doc = fit(moveTo(put(doc, [box]), items, box.id), box.id)
  return { doc, id: box.id }
}

/** Dissolves groups/frames, leaving their children in place. Returns the freed children. */
export function ungroup(doc: Document, ids: string[]): { doc: Document; ids: string[] } {
  const freed: string[] = []
  for (const id of topLevel(doc, ids)) {
    const g = doc.nodes[id]
    if (g.type !== 'GROUP' && g.type !== 'FRAME') continue
    const kids = childrenOf(doc, id).map((k) => k.id)
    doc = remove(moveTo(doc, kids, g.parentId!, { before: id }), [id])
    freed.push(...kids)
  }
  return { doc, ids: freed }
}

/** Copies a subtree with fresh ids. `kids` lists children of a source node (a document or a clipboard). */
export function cloneTree(root: Node, kids: (id: string) => Node[], parentId: string, order: string): Node[] {
  const copy = { ...root, id: crypto.randomUUID(), parentId, order }
  return [copy, ...kids(root.id).flatMap((k) => cloneTree(k, kids, copy.id, k.order))]
}
/** Duplicates in place, each copy directly above its original. */
export function duplicate(doc: Document, ids: string[]): { doc: Document; ids: string[] } {
  const out: string[] = []
  for (const id of topLevel(doc, ids)) {
    const n = doc.nodes[id], siblings = childrenOf(doc, n.parentId!)
    const copies = cloneTree(n, (i) => childrenOf(doc, i), n.parentId!, orderBetween(n.order, siblings[siblings.indexOf(n) + 1]?.order))
    doc = put(doc, copies)
    out.push(copies[0].id)
  }
  return { doc, ids: out }
}

export function reorder(doc: Document, ids: string[], to: 'forward' | 'backward' | 'front' | 'back'): Document {
  const up = to === 'forward' || to === 'front'
  const items = topLevel(doc, ids)
  for (const id of up ? items.reverse() : items) {
    const n = doc.nodes[id], sibs = childrenOf(doc, n.parentId!).filter((s) => s.id === id || !items.includes(s.id)), i = sibs.indexOf(n)
    const order =
      to === 'front' ? (i === sibs.length - 1 ? n.order : orderBetween(sibs.at(-1)!.order))
      : to === 'back' ? (i === 0 ? n.order : orderBetween('', sibs[0].order))
      : to === 'forward' ? (sibs[i + 1] ? orderBetween(sibs[i + 1].order, sibs[i + 2]?.order) : n.order)
      : sibs[i - 1] ? orderBetween(sibs[i - 2]?.order, sibs[i - 1].order) : n.order
    if (order !== n.order) doc = patch(doc, [id], { order })
  }
  return doc
}

export function addPage(doc: Document): { doc: Document; id: string } {
  const page = makeNode('PAGE', { name: nextName(doc, 'Page'), fills: [solid(0.96, 0.96, 0.96)] })
  return { doc: { ...put(doc, [page]), pages: [...doc.pages, page.id] }, id: page.id }
}
/** The last page can't be removed. */
export function removePage(doc: Document, id: string): Document {
  if (doc.pages.length < 2 || !doc.pages.includes(id)) return doc
  const gone = new Set([id, ...descendants(doc, id).map((n) => n.id)])
  return { ...doc, pages: doc.pages.filter((p) => p !== id), nodes: Object.fromEntries(Object.entries(doc.nodes).filter(([k]) => !gone.has(k))) }
}
export function movePage(doc: Document, id: string, toIndex: number): Document {
  const pages = doc.pages.filter((p) => p !== id)
  pages.splice(toIndex, 0, id)
  return { ...doc, pages }
}
