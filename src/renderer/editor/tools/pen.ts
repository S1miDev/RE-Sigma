// The pen tool and point editing: drawing a VECTOR's path, then dragging or deleting its points and handles.
import { makeNode, solid, type Node } from '../../../shared/document'
import { frameAt } from '../canvas/hit'
import { toScreen } from '../canvas/viewport'
import { apply, invert, worldMatrix, type Pt } from '../model/geometry'
import { insert, nextName, put, remove } from '../model/ops'
import { anchorsOf, withAnchors, type Anchor, type Sub } from '../model/path'
import { gestureStep, NO_MODE, type EditorStore } from '../store'
import { DRAG_PX, dist, snapAngle, type Gesture, type Pointer } from './pointer'

// ── pen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CLOSE_PX = 8
const penStep = (id: string) => gestureStep(`pen-${id}`) // the whole path is one undo step

/** Writes points given in the parent's coordinates to the node (the pen node is never rotated while drawing). */
const fromParent = (n: Node, subs: Sub[]): Node => withAnchors({ ...n, x: 0, y: 0, width: 0, height: 0, rotation: 0 }, subs)

/** Ends the path being drawn: selects it, or removes it if it is a single point. Back to the Move tool. */
export function finishPen(store: EditorStore) {
  const { mode, doc } = store.get()
  if (mode.kind !== 'pen') return
  const n = doc.nodes[mode.id]
  if (n && mode.anchors.length < 2) store.update((d) => remove(d, [n.id]), penStep(n.id))
  store.set({ mode: NO_MODE, tool: 'move', selection: n && store.get().doc.nodes[n.id] ? [n.id] : [] })
}

/**
 * Pen: a click adds a corner point, a drag pulls out symmetric handles, Shift keeps the segment at 45° steps.
 * Clicking the first point closes the path and finishes it.
 */
export function penGesture(store: EditorStore, p: Pointer): Gesture {
  const s = store.get(), { doc, view } = s
  const current = s.mode.kind === 'pen' && doc.nodes[s.mode.id] ? s.mode : null, existing = current && doc.nodes[current.id]
  const parentId = existing ? existing.parentId! : frameAt(doc, s.pageId, p.world)
  const toPage = worldMatrix(doc, parentId), toParent = invert(toPage)
  if (current && current.anchors.length >= 2 && dist(toScreen(view, apply(toPage, current.anchors[0])), p.screen) <= CLOSE_PX) {
    store.update((d) => put(d, [fromParent(d.nodes[current.id], [{ anchors: current.anchors, closed: true }])]), penStep(current.id))
    finishPen(store)
    return { move() {}, up() {} }
  }
  const base = current?.anchors ?? [], prev = base.at(-1)
  const at = (q: Pointer) => apply(toParent, q.world)
  const point = prev && p.shift ? snapAngle(prev, at(p)) : at(p)
  const node = existing ?? makeNode('VECTOR', { name: nextName(doc, 'Vector'), strokes: [solid(0, 0, 0)], strokeAlign: 'CENTER', vector: { w: 0, h: 0, fill: [], stroke: [] } })
  const write = (anchor: Anchor) => {
    const anchors = [...base, anchor]
    store.update((d) => {
      const n = fromParent(d.nodes[node.id] ?? node, [{ anchors, closed: false }])
      return { doc: d.nodes[node.id] ? put(d, [n]) : insert(d, n, parentId), ids: [node.id] }
    }, penStep(node.id))
    store.set({ mode: { kind: 'pen', id: node.id, anchors } })
  }
  write(point)
  return {
    move(q) {
      if (dist(q.screen, p.screen) < DRAG_PX) return
      const out = at(q)
      write({ ...point, out, in: { x: 2 * point.x - out.x, y: 2 * point.y - out.y } })
    },
    up() {},
  }
}

// ── point editing ────────────────────────────────────────────────────────────────────────────────────────────────────
const POINT_PX = 6
type PointHit = { s: number; i: number; part: 'anchor' | 'in' | 'out' }
/** The anchor or handle of the edited vector under a screen point. Handles first: they sit on top. */
export function pointAt(store: EditorStore, screen: Pt): PointHit | null {
  const { doc, view, mode } = store.get(), n = mode.kind === 'points' ? doc.nodes[mode.id] : undefined
  if (!n) return null
  const m = worldMatrix(doc, n.id), subs = anchorsOf(n), near = (q: Pt) => dist(toScreen(view, apply(m, q)), screen) <= POINT_PX
  for (const part of ['in', 'out', 'anchor'] as const)
    for (const [si, sub] of subs.entries())
      for (const [i, a] of sub.anchors.entries()) {
        const q = part === 'anchor' ? a : a[part]
        if (q && near(q)) return { s: si, i, part }
      }
  return null
}

/** Drags an anchor (with its handles) or one handle of the vector being edited. */
export function pointGesture(store: EditorStore, p: Pointer, id: string, hit: PointHit): Gesture {
  const { doc } = store.get(), n = doc.nodes[id], tag = gestureStep()
  const subs = anchorsOf(n), toLocal = invert(worldMatrix(doc, id)), from = apply(toLocal, p.world)
  store.set({ mode: { kind: 'points', id, sel: { s: hit.s, i: hit.i } } })
  return {
    move(q) {
      const to = apply(toLocal, q.world), dx = to.x - from.x, dy = to.y - from.y
      const shift = (pt?: Pt) => pt && { x: pt.x + dx, y: pt.y + dy }
      const next = subs.map((sub, si) => si !== hit.s ? sub : {
        ...sub,
        anchors: sub.anchors.map((a, i) => i !== hit.i ? a
          : hit.part === 'anchor' ? { ...a, ...shift(a)!, ...(a.in && { in: shift(a.in) }), ...(a.out && { out: shift(a.out) }) }
          : { ...a, [hit.part]: shift(a[hit.part]) }),
      })
      store.update(() => put(doc, [withAnchors(n, next)]), tag)
    },
    up() {},
  }
}

/** Removes the selected anchor of the vector being edited; a subpath left with one point goes, and so does an empty vector. */
export function deletePoint(store: EditorStore) {
  const { mode } = store.get()
  if (mode.kind !== 'points' || !mode.sel) return
  const { id, sel } = mode
  store.update((d) => {
    const subs = anchorsOf(d.nodes[id]).map((sub, si) => si === sel.s ? { ...sub, anchors: sub.anchors.filter((_, i) => i !== sel.i) } : sub).filter((sub) => sub.anchors.length >= 2)
    return subs.length ? put(d, [withAnchors(d.nodes[id], subs)]) : remove(d, [id])
  })
  if (store.get().mode.kind === 'points') store.set({ mode: { kind: 'points', id, sel: null } })
}
