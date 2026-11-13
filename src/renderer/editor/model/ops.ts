// Pure document operations: (doc, …) → new doc. Documents are immutable; unchanged nodes keep their identity.
import { isContainer, makeNode, solid, type Constraint, type Document, type Node } from '../../../shared/document'
import { orderBetween } from '../../../shared/order'
import { apply, bounds, boxCorners, invert, localMatrix, worldBox, worldMatrix, worldRotation, type Pt } from './geometry'

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

const shift = (axis: 'x' | 'y', by: number): Pt => (axis === 'x' ? { x: by, y: 0 } : { x: 0, y: by })

/** Aligns nodes to the edge/centre (to = 0 | 0.5 | 1) of their shared bounds; a lone node aligns to its parent (not a page). */
export function align(doc: Document, ids: string[], axis: 'x' | 'y', to: 0 | 0.5 | 1): Document {
  const top = topLevel(doc, ids).filter((id) => !doc.nodes[id].locked), size = axis === 'x' ? 'w' : 'h'
  const parent = top.length === 1 ? doc.nodes[doc.nodes[top[0]].parentId ?? ''] : undefined
  const ref = top.length > 1 ? worldBox(doc, top) : parent && parent.type !== 'PAGE' ? worldBox(doc, [parent.id]) : null
  if (!ref) return doc
  return top.reduce((d, id) => {
    const b = worldBox(doc, [id])!
    return translate(d, [id], shift(axis, ref[axis] + ref[size] * to - (b[axis] + b[size] * to)))
  }, doc)
}

/** Spaces three or more nodes evenly along an axis; the outermost two stay put. */
export function distribute(doc: Document, ids: string[], axis: 'x' | 'y'): Document {
  const size = axis === 'x' ? 'w' : 'h'
  const items = topLevel(doc, ids).filter((id) => !doc.nodes[id].locked).map((id) => ({ id, b: worldBox(doc, [id])! })).sort((p, q) => p.b[axis] - q.b[axis])
  if (items.length < 3) return doc
  const end = Math.max(...items.map(({ b }) => b[axis] + b[size]))
  const gap = (end - items[0].b[axis] - items.reduce((sum, { b }) => sum + b[size], 0)) / (items.length - 1)
  let at = items[0].b[axis] + items[0].b[size] + gap
  return items.slice(1, -1).reduce((d, { id, b }) => {
    const next = translate(d, [id], shift(axis, at - b[axis]))
    at += b[size] + gap
    return next
  }, doc)
}

/**
 * Reparents nodes, keeping their place on the page. `at` positions them in z-order: above `after`, below `before`,
 * or on top by default. Nodes can't move into themselves or their descendants.
 */
export function moveTo(doc: Document, ids: string[], parentId: string, at: { before?: string; after?: string } = {}): Document {
  const parent = doc.nodes[parentId]
  // an instance's content comes from its main component: nothing moves into it, its own nodes don't move out
  if (!parent || !isContainer(parent) || parent.instanceOf || parent.ref) return doc
  const moving = topLevel(doc, ids).filter((id) => id !== parentId && !isAncestor(doc, id, parentId) && !doc.nodes[id].ref)
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

type Rect = { x: number; y: number; width: number; height: number }
/** A child's [position, size] on one axis after its parent goes from size `from` to `to`. */
export function follow(c: Constraint, p: number, s: number, from: number, to: number): [number, number] {
  const d = to - from
  if (c === 'MAX') return [p + d, s]
  if (c === 'CENTER') return [p + d / 2, s]
  if (c === 'STRETCH') return [p, Math.max(0, s + d)]
  if (c === 'SCALE') return from ? [(p * to) / from, (s * to) / from] : [p, s]
  return [p, s]
}
/** Sets a node's box. Resizing a group scales its children with it. */
function setBox(doc: Document, id: string, box: Rect): Document {
  const n = doc.nodes[id]
  if (n.type === 'GROUP' && n.width && n.height) {
    // shortcut: a rotated child is scaled along the group's axes, not sheared; exact only for unrotated children.
    const sx = box.width / n.width, sy = box.height / n.height
    for (const k of childrenOf(doc, id)) doc = setBox(doc, k.id, { x: k.x * sx, y: k.y * sy, width: k.width * sx, height: k.height * sy })
  } else if (n.type === 'FRAME' && !n.layout && (box.width !== n.width || box.height !== n.height)) {
    // shortcut: rotated children follow constraints by their unrotated box; fine until that matters.
    for (const k of childrenOf(doc, id)) {
      if (!k.constraints) continue
      const [x, width] = follow(k.constraints.h, k.x, k.width, n.width, box.width)
      const [y, height] = follow(k.constraints.v, k.y, k.height, n.height, box.height)
      if (x !== k.x || y !== k.y || width !== k.width || height !== k.height) doc = setBox(doc, k.id, { x, y, width, height })
    }
  }
  return patch(doc, [id], { ...box, ...(n.type === 'TEXT' && box.width !== n.width && { textAutoWidth: false }) })
}
/** A user resize: like setBox, and a manual size on an axis replaces hug/fill on that axis. */
export function resizeNode(doc: Document, id: string, box: Rect): Document {
  const n = doc.nodes[id], w = box.width !== n.width, h = box.height !== n.height
  doc = setBox(doc, id, box)
  return patch(doc, [id], {
    ...(n.layout && (w || h) && { layout: { ...n.layout, hugW: n.layout.hugW && !w, hugH: n.layout.hugH && !h } }),
    ...(w && n.fillW && { fillW: false }), ...(h && n.fillH && { fillH: false }),
  })
}

function layoutFrame(doc: Document, id: string): Document {
  const f = doc.nodes[id], L = f.layout!, horizontal = L.mode === 'HORIZONTAL', [pt, pr, pb, pl] = L.padding
  const P = horizontal ? { pos: 'x', size: 'width', fill: 'fillW', hug: L.hugW, a: pl, b: pr } as const : { pos: 'y', size: 'height', fill: 'fillH', hug: L.hugH, a: pt, b: pb } as const
  const C = horizontal ? { pos: 'y', size: 'height', fill: 'fillH', hug: L.hugH, a: pt, b: pb } as const : { pos: 'x', size: 'width', fill: 'fillW', hug: L.hugW, a: pl, b: pr } as const
  // shortcut: rotated children are laid out by their unrotated box; fine until rotation inside auto layout matters.
  const kids = childrenOf(doc, id).filter((k) => k.visible)
  const fillP = (k: Node) => !P.hug && !!k[P.fill], fillC = (k: Node) => !C.hug && !!k[C.fill] // hug on an axis overrides fill on it
  const gaps = L.gap * Math.max(0, kids.length - 1)
  const fixed = kids.filter((k) => !fillP(k)).reduce((s, k) => s + k[P.size], 0), fills = kids.filter(fillP).length
  const primary = P.hug ? P.a + P.b + gaps + fixed : f[P.size]
  const share = fills ? Math.max(0, (primary - P.a - P.b - gaps - fixed) / fills) : 0
  const cross = C.hug ? C.a + C.b + Math.max(0, ...kids.filter((k) => !fillC(k)).map((k) => k[C.size])) : f[C.size]
  const inner = Math.max(0, cross - C.a - C.b)
  if (f[P.size] !== primary || f[C.size] !== cross) doc = patch(doc, [id], { [P.size]: primary, [C.size]: cross })
  let at = P.a
  for (const k of kids) {
    const ps = fillP(k) ? share : k[P.size], cs = fillC(k) ? inner : k[C.size]
    const box = { [P.pos]: at, [C.pos]: C.a + (L.align === 'MIN' ? 0 : L.align === 'CENTER' ? (inner - cs) / 2 : inner - cs), [P.size]: ps, [C.size]: cs } as Rect
    if (box.x !== k.x || box.y !== k.y || box.width !== k.width || box.height !== k.height) doc = setBox(doc, k.id, box)
    at += ps + L.gap
  }
  return doc
}
/** Places the children of every auto-layout frame, deepest frames first. */
export function autoLayout(doc: Document): Document {
  const frames = Object.values(doc.nodes).filter((n) => n.layout).sort((a, b) => depth(doc, b.id) - depth(doc, a.id))
  // shortcut: two passes settle one level of fill-inside-hug nesting; deeper chains may lag one edit behind.
  for (let pass = 0; pass < 2; pass++) for (const f of frames) doc = layoutFrame(doc, f.id)
  return doc
}

/** Turns on auto layout for a frame: children sorted by position, direction, gap and padding read off the current arrangement. */
export function addAutoLayout(doc: Document, id: string): Document {
  const f = doc.nodes[id], kids = childrenOf(doc, id)
  const b = bounds(kids.flatMap((k) => boxCorners(k).map((p) => apply(localMatrix(k), p))))
  const horizontal = b ? b.w >= b.h : f.width >= f.height
  const pos = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height'
  const sorted = [...kids].sort((p, q) => p[pos] - q[pos])
  const gaps = sorted.slice(1).map((k, i) => k[pos] - sorted[i][pos] - sorted[i][size])
  const gap = gaps.length ? Math.max(0, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)) : 10
  const pad = (v: number) => Math.max(0, Math.round(v))
  const padding: [number, number, number, number] = b ? [pad(b.y), pad(f.width - b.x - b.w), pad(f.height - b.y - b.h), pad(b.x)] : [0, 0, 0, 0]
  let order = ''
  doc = put(doc, sorted.map((k) => ({ ...k, order: (order = orderBetween(order)) })))
  return patch(doc, [id], { layout: { mode: horizontal ? 'HORIZONTAL' : 'VERTICAL', gap, padding, align: 'MIN', hugW: true, hugH: true } })
}

/** The sibling a node dropped at page point p should go before in an auto-layout frame (undefined = last). */
export function layoutSlot(doc: Document, frameId: string, p: Pt, exclude: string[]): string | undefined {
  const axis = doc.nodes[frameId].layout?.mode === 'VERTICAL' ? 'y' : 'x', size = axis === 'x' ? 'w' : 'h'
  return childrenOf(doc, frameId).find((k) => {
    if (!k.visible || exclude.includes(k.id)) return false
    const b = worldBox(doc, [k.id])!
    return b[axis] + b[size] / 2 > p[axis]
  })?.id
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
    if ((g.type !== 'GROUP' && g.type !== 'FRAME') || g.instanceOf) continue // an instance's children can't leave it; detach it first
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
