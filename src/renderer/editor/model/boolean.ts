// Boolean operations: a BOOLEAN node's `vector` is its children (the operands, bottom one first) combined by `boolOp`.
// The engine is paper.js (paper-core); everything here converts nodes to paper paths and back to anchors.
import paper from 'paper/dist/paper-core'
import type { BoolOp as Op, Document, Node } from '../../../shared/document'
import { localMatrix } from './geometry'
import { childrenOf, depth, group, nextName, put, remove } from './ops'
import { hasPath } from '../canvas/paintPlan'
import { arcPath, cornerPath, isPlainBox, radiiOf } from './shapes'
import { anchorsOf, parsePath, pathData, withAnchors, type Anchor, type Sub } from './path'

const METHOD = { UNION: 'unite', SUBTRACT: 'subtract', INTERSECT: 'intersect', EXCLUDE: 'exclude' } as const
const LABEL: Record<Op, string> = { UNION: 'Union', SUBTRACT: 'Subtract', INTERSECT: 'Intersect', EXCLUDE: 'Exclude' }

let ready = false
const ensure = () => { if (!ready) { paper.setup(new paper.Size(1, 1)); ready = true } } // a project with no canvas: booleans need none
const NEW = { insert: false } // paper items stay out of the project, so nothing piles up in it

const fromSubs = (subs: Sub[], rule: 'nonzero' | 'evenodd'): paper.PathItem => {
  const paths = subs.filter((s) => s.anchors.length > 1).map((s) => new paper.Path({
    ...NEW, closed: true, // a filled shape is closed whether or not its last segment was drawn back to the start
    segments: s.anchors.map((a) => new paper.Segment(new paper.Point(a.x, a.y), a.in && new paper.Point(a.in.x - a.x, a.in.y - a.y), a.out && new paper.Point(a.out.x - a.x, a.out.y - a.y))),
  }))
  return new paper.CompoundPath({ ...NEW, children: paths, fillRule: rule })
}

/** The node's filled shape in its own coordinates, or null if it has none (text and lines are not supported yet). */
function shapeOf(doc: Document, n: Node): paper.PathItem | null {
  if (!n.visible) return null
  ensure()
  if (n.type === 'RECTANGLE' || n.type === 'FRAME') {
    if (!n.width || !n.height) return null
    if (!isPlainBox(n)) return fromSubs(parsePath(cornerPath(n.width, n.height, radiiOf(n), n.cornerSmoothing)), 'nonzero')
    return new paper.Path.Rectangle({ ...NEW, point: [0, 0], size: [n.width, n.height], radius: Math.min(n.cornerRadius, n.width / 2, n.height / 2) })
  }
  if (n.type === 'ELLIPSE' && n.arc && n.width && n.height) return fromSubs(parsePath(arcPath(n.width, n.height, n.arc)), 'nonzero')
  if (n.type === 'ELLIPSE') return n.width && n.height ? new paper.Path.Ellipse({ ...NEW, center: [n.width / 2, n.height / 2], radius: [n.width / 2, n.height / 2] }) : null
  if (hasPath(n)) {
    const subs = anchorsOf(n)
    return subs.length ? fromSubs(subs, n.vector!.fill[0]?.rule ?? 'nonzero') : null
  }
  if (n.type === 'GROUP') return combine(childrenOf(doc, n.id).map((k) => inParent(doc, k)), 'UNION')
  return null
}
/** The node's shape in its parent's coordinates. */
function inParent(doc: Document, n: Node): paper.PathItem | null {
  const s = shapeOf(doc, n)
  s?.transform(new paper.Matrix(...localMatrix(n)))
  return s
}

/** Operands (bottom first) folded with `op`: each later one is united with, subtracted from, intersected with or excluded from the result so far. */
function combine(items: (paper.PathItem | null)[], op: Op): paper.PathItem | null {
  ensure()
  const shapes = items.filter((i): i is paper.PathItem => !!i)
  return shapes.length ? shapes.reduce((acc, i) => acc[METHOD[op]](i, NEW)) : null
}

const anchorOf = (s: paper.Segment): Anchor => ({
  x: s.point.x, y: s.point.y,
  ...(!s.handleIn.isZero() && { in: { x: s.point.x + s.handleIn.x, y: s.point.y + s.handleIn.y } }),
  ...(!s.handleOut.isZero() && { out: { x: s.point.x + s.handleOut.x, y: s.point.y + s.handleOut.y } }),
})
const subsOf = (item: paper.PathItem | null): Sub[] =>
  !item ? [] : ((item.className === 'CompoundPath' ? item.children : [item]) as paper.Path[]).filter((p) => p.segments.length > 1).map((p) => ({ closed: p.closed, anchors: p.segments.map(anchorOf) }))

/** What a BOOLEAN node's `vector` should be: its visible children combined, in the node's own coordinates. */
export function booleanVector(doc: Document, b: Node): NonNullable<Node['vector']> {
  const subs = subsOf(combine(childrenOf(doc, b.id).map((k) => inParent(doc, k)), b.boolOp ?? 'UNION')), d = pathData(subs)
  return { w: b.width, h: b.height, fill: d ? [{ d, rule: 'evenodd' }] : [], stroke: [] }
}

const withVector = (doc: Document, b: Node): Document => {
  const vector = booleanVector(doc, b)
  return vector.fill[0]?.d === b.vector?.fill[0]?.d && vector.w === b.vector?.w && vector.h === b.vector?.h ? doc : put(doc, [{ ...b, vector }])
}

/** Recomputes the result of every boolean node whose operands (or itself) changed from `prev` to `next`. Innermost first. */
export function syncBooleans(prev: Document, next: Document): Document {
  const booleans = Object.values(next.nodes).filter((n) => n.type === 'BOOLEAN').sort((a, b) => depth(next, b.id) - depth(next, a.id))
  const changed = (n: Node): boolean => prev.nodes[n.id] !== n || childrenOf(next, n.id).some(changed)
  for (const b of booleans) if (changed(next.nodes[b.id])) next = withVector(next, next.nodes[b.id])
  return next
}

/** Wraps the nodes in a new BOOLEAN node (named after the operation) that takes the bottom operand's paints. */
export function makeBoolean(doc: Document, ids: string[], op: Op): { doc: Document; ids: string[] } {
  const made = group(doc, ids, 'BOOLEAN', { boolOp: op, name: nextName(doc, LABEL[op]), vector: { w: 0, h: 0, fill: [], stroke: [] } })
  if (!made.ids.length) return made
  const id = made.ids[0], base = childrenOf(made.doc, id)[0]
  const paints = { fills: base.fills, strokes: base.strokes, strokeWeight: base.strokeWeight, strokeAlign: base.strokeAlign }
  const d = put(made.doc, [{ ...made.doc.nodes[id], ...paints }])
  return { doc: withVector(d, d.nodes[id]), ids: [id] }
}

/** Turns each node into a plain VECTOR of its outline: a boolean keeps its result and loses its operands; a group becomes the union of its children. */
export function flatten(doc: Document, ids: string[]): { doc: Document; ids: string[] } {
  const out: string[] = []
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n || n.type === 'VECTOR') continue
    ensure()
    const subs = n.type === 'BOOLEAN' ? anchorsOf(n) : subsOf(shapeOf(doc, n))
    if (!subs.length) continue
    const kid = n.type === 'GROUP' || n.type === 'BOOLEAN' ? childrenOf(doc, id)[0] : n
    const { boolOp: _, ...rest } = n
    const vec = withAnchors({ ...rest, type: 'VECTOR', fills: n.type === 'GROUP' ? kid.fills : n.fills, strokes: n.type === 'GROUP' ? kid.strokes : n.strokes, cornerRadius: 0, vector: { w: n.width, h: n.height, fill: [{ d: '', rule: 'evenodd' }], stroke: [] } }, subs)
    doc = put(remove(doc, childrenOf(doc, id).map((k) => k.id)), [vec])
    out.push(id)
  }
  return { doc, ids: out }
}
