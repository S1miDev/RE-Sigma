// Pointer gestures for the tools: Move (select, drag, marquee, resize, rotate), Hand, Frame, Rectangle, Ellipse, Line, Text.
import { makeNode, solid, type Node, type NodeType } from '../../../shared/document'
import { frameAt, hitTest, marqueeHits } from '../canvas/hit'
import { handleAt, handlesOf, type Handle } from '../canvas/overlay'
import { snap, snapTargets } from '../canvas/snap'
import { toScreen } from '../canvas/viewport'
import { apply, bounds, deg, invert, lineBetween, localMatrix, resizeBox, worldBox, worldMatrix, worldRotation, type Pt } from '../model/geometry'
import { insert, layoutSlot, moveTo, nextName, patch, put, remove, resizeNode, topLevel, translate } from '../model/ops'
import { anchorsOf, withAnchors, type Anchor, type Sub } from '../model/path'
import { gestureStep, type EditorStore, type Tool } from '../store'

export interface Pointer { screen: Pt; world: Pt; shift: boolean; alt: boolean; ctrl: boolean }
export interface Gesture { move(p: Pointer): void; up(p: Pointer): void }

const SNAP_PX = 5
const DRAG_PX = 3
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
/** Rounds the direction from → to to a multiple of 45°, keeping the length. */
function snapAngle(from: Pt, to: Pt): Pt {
  const len = dist(from, to), a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len }
}

export function beginGesture(store: EditorStore, p: Pointer, pan = false): Gesture | null {
  const { tool } = store.get()
  if (pan || tool === 'hand') return panGesture(store, p)
  if (tool === 'move') return moveToolGesture(store, p)
  if (tool === 'text') return textGesture(store, p)
  if (tool === 'pen') return penGesture(store, p)
  return shapeGesture(store, p, tool)
}

/** Switches tools. A path the pen is drawing is finished first, and point editing ends. */
export function setTool(store: EditorStore, tool: Tool) {
  finishPen(store)
  store.set({ tool, vectorEdit: null })
}

// ── pen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CLOSE_PX = 8
const penStep = (id: string) => gestureStep(`pen-${id}`) // the whole path is one undo step

/** Writes points given in the parent's coordinates to the node (the pen node is never rotated while drawing). */
const fromParent = (n: Node, subs: Sub[]): Node => withAnchors({ ...n, x: 0, y: 0, width: 0, height: 0, rotation: 0 }, subs)

/** Ends the path being drawn: selects it, or removes it if it is a single point. Back to the Move tool. */
export function finishPen(store: EditorStore) {
  const { pen, doc } = store.get(), n = pen && doc.nodes[pen.id]
  if (!pen) return
  if (n && pen.anchors.length < 2) store.update((d) => remove(d, [n.id]), penStep(n.id))
  store.set({ pen: null, tool: 'move', selection: n && store.get().doc.nodes[n.id] ? [n.id] : [] })
}

/**
 * Pen: a click adds a corner point, a drag pulls out symmetric handles, Shift keeps the segment at 45° steps.
 * Clicking the first point closes the path and finishes it.
 */
function penGesture(store: EditorStore, p: Pointer): Gesture {
  const s = store.get(), { doc, view } = s
  const current = s.pen && doc.nodes[s.pen.id] ? s.pen : null, existing = current && doc.nodes[current.id]
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
    store.set({ pen: { id: node.id, anchors } })
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
  const { doc, view, vectorEdit } = store.get(), n = vectorEdit && doc.nodes[vectorEdit.id]
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
function pointGesture(store: EditorStore, p: Pointer, hit: PointHit): Gesture {
  const { doc } = store.get(), id = store.get().vectorEdit!.id, n = doc.nodes[id], tag = gestureStep()
  const subs = anchorsOf(n), toLocal = invert(worldMatrix(doc, id)), from = apply(toLocal, p.world)
  store.set({ vectorEdit: { id, sel: { s: hit.s, i: hit.i } } })
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
  const { vectorEdit } = store.get()
  if (!vectorEdit?.sel) return
  const { id, sel } = vectorEdit
  store.update((d) => {
    const subs = anchorsOf(d.nodes[id]).map((sub, si) => si === sel.s ? { ...sub, anchors: sub.anchors.filter((_, i) => i !== sel.i) } : sub).filter((sub) => sub.anchors.length >= 2)
    return subs.length ? put(d, [withAnchors(d.nodes[id], subs)]) : remove(d, [id])
  })
  if (store.get().vectorEdit) store.set({ vectorEdit: { id, sel: null } })
}

function panGesture(store: EditorStore, p: Pointer): Gesture {
  const start = store.get().view
  return { move: (q) => store.set({ view: { ...start, x: start.x + q.screen.x - p.screen.x, y: start.y + q.screen.y - p.screen.y } }), up() {} }
}

function moveToolGesture(store: EditorStore, p: Pointer): Gesture | null {
  if (store.get().vectorEdit) {
    const hit = pointAt(store, p.screen), { doc, pageId, view, vectorEdit } = store.get()
    if (hit) return pointGesture(store, p, hit)
    // a click on the vector's body deselects the point; anywhere else ends point editing
    if (hitTest(doc, pageId, p.world, { deep: true, tolerance: 4 / view.zoom }) === vectorEdit!.id) return void store.set({ vectorEdit: { ...vectorEdit!, sel: null } }), null
    store.set({ vectorEdit: null })
  }
  const s = store.get(), { doc, pageId, view } = s
  if (s.selection.length === 1) {
    const h = handleAt(handlesOf(doc, s.selection[0], view), p.screen)
    if (h) return handleGesture(store, p, s.selection[0], h)
  }
  const hit = hitTest(doc, pageId, p.world, { deep: p.ctrl, tolerance: 4 / view.zoom })
  if (!hit) return marqueeGesture(store, p)
  const was = s.selection.includes(hit)
  let selection = s.selection
  if (p.shift) selection = was ? selection.filter((i) => i !== hit) : [...selection, hit]
  else if (!was) selection = [hit]
  store.set({ selection })
  if (p.shift && was) return null
  return dragGesture(store, p, selection, hit, was && !p.shift)
}

function dragGesture(store: EditorStore, p: Pointer, selection: string[], hit: string, collapseOnClick: boolean): Gesture | null {
  const { doc, pageId, view } = store.get(), tag = gestureStep()
  const ids = topLevel(doc, selection).filter((id) => !doc.nodes[id].locked)
  const box = worldBox(doc, ids)
  if (!box) return null
  const parentId = doc.nodes[ids[0]].parentId!
  const targets = snapTargets(doc, parentId, ids)
  // Children of an auto-layout frame reorder live while the pointer stays in it, and float on the page once it leaves.
  const layoutParent = doc.nodes[parentId].layout && ids.every((id) => doc.nodes[id].parentId === parentId) ? parentId : null
  let moved = false
  return {
    move(q) {
      let dx = q.world.x - p.world.x, dy = q.world.y - p.world.y
      if (!moved && dist(q.screen, p.screen) < DRAG_PX) return
      moved = true
      if (layoutParent && frameAt(doc, pageId, q.world, ids) === layoutParent) {
        store.update(() => moveTo(doc, ids, layoutParent, { before: layoutSlot(doc, layoutParent, q.world, ids) }), tag)
        return void store.set({ overlay: {} })
      }
      if (q.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0) // constrain to one axis
      const sn = snap(
        q.shift && !dx ? [] : [box.x + dx, box.x + box.w / 2 + dx, box.x + box.w + dx],
        q.shift && !dy ? [] : [box.y + dy, box.y + box.h / 2 + dy, box.y + box.h + dy],
        layoutParent ? [] : targets, SNAP_PX / view.zoom,
      )
      store.update(() => translate(layoutParent ? moveTo(doc, ids, pageId) : doc, ids, { x: dx + sn.dx, y: dy + sn.dy }), tag)
      store.set({ overlay: { guides: sn.guides } })
    },
    up(q) {
      store.set({ overlay: {} })
      if (!moved) return void (collapseOnClick && store.set({ selection: [hit] }))
      // Dropping inside a frame parents the node to it; dropping outside moves it back to the page. Group members stay in their group.
      // An auto-layout frame takes the nodes at the slot under the pointer.
      const now = store.get().doc, target = frameAt(now, pageId, q.world, ids), slotted = !!now.nodes[target].layout
      const movers = ids.filter((id) => now.nodes[id] && (slotted || now.nodes[id].parentId !== target) && now.nodes[now.nodes[id].parentId!].type !== 'GROUP')
      if (movers.length) store.update((d) => moveTo(d, movers, target, slotted ? { before: layoutSlot(d, target, q.world, movers) } : {}), tag)
    },
  }
}

function marqueeGesture(store: EditorStore, p: Pointer): Gesture {
  const { doc, pageId, selection } = store.get(), base = p.shift ? selection : []
  let moved = false
  return {
    move(q) {
      if (!moved && dist(q.screen, p.screen) < DRAG_PX) return
      moved = true
      const marquee = bounds([p.world, q.world])!
      store.set({ overlay: { marquee }, selection: [...new Set([...base, ...marqueeHits(doc, pageId, marquee)])] })
    },
    up() {
      store.set(moved || p.shift ? { overlay: {} } : { overlay: {}, selection: [] })
    },
  }
}

function handleGesture(store: EditorStore, p: Pointer, id: string, h: Handle): Gesture {
  const { doc, view } = store.get(), n = doc.nodes[id], tag = gestureStep()
  const toParent = invert(worldMatrix(doc, n.parentId))

  if (h.kind === 'rotate') {
    const c = apply(worldMatrix(doc, id), { x: n.width / 2, y: n.height / 2 })
    const angle = (q: Pointer) => Math.atan2(q.world.y - c.y, q.world.x - c.x)
    const from = angle(p)
    return {
      move(q) {
        let r = n.rotation + deg(angle(q) - from)
        if (q.shift) r = Math.round(r / 15) * 15
        r = ((((r + 180) % 360) + 360) % 360) - 180
        store.update(() => patch(doc, [id], { rotation: r }), tag)
      },
      up() {},
    }
  }

  if (n.type === 'LINE') {
    const m = localMatrix(n), fixed = apply(m, { x: h.hx < 0 ? n.width : 0, y: 0 })
    return {
      move(q) {
        const free = apply(toParent, q.world), end = q.shift ? snapAngle(fixed, free) : free
        store.update(() => patch(doc, [id], h.hx < 0 ? lineBetween(end, fixed) : lineBetween(fixed, end)), tag)
      },
      up() {},
    }
  }

  const upright = worldRotation(doc, id) === 0 // snapping page-aligned edges only makes sense for an unrotated box
  const targets = upright ? snapTargets(doc, n.parentId!, [id]) : []
  return {
    move(q) {
      const sn = snap(h.hx ? [q.world.x] : [], h.hy ? [q.world.y] : [], targets, SNAP_PX / view.zoom)
      const at = apply(toParent, { x: q.world.x + sn.dx, y: q.world.y + sn.dy })
      store.update(() => resizeNode(doc, id, resizeBox(n, h.hx, h.hy, at, q)), tag)
      store.set({ overlay: { guides: sn.guides } })
    },
    up: () => store.set({ overlay: {} }),
  }
}

const SHAPES: Record<Exclude<Tool, 'move' | 'hand' | 'text' | 'pen'>, { type: NodeType; label: string; props: Partial<Node> }> = {
  frame: { type: 'FRAME', label: 'Frame', props: { fills: [solid(1, 1, 1)] } },
  rectangle: { type: 'RECTANGLE', label: 'Rectangle', props: { fills: [solid(0.85, 0.85, 0.85)] } },
  ellipse: { type: 'ELLIPSE', label: 'Ellipse', props: { fills: [solid(0.85, 0.85, 0.85)] } },
  line: { type: 'LINE', label: 'Line', props: { strokes: [solid(0, 0, 0)], strokeAlign: 'CENTER' } },
}

/** Drag to draw; a plain click drops a 100×100 shape. The new node lands in the frame under the pointer. */
function shapeGesture(store: EditorStore, p: Pointer, tool: keyof typeof SHAPES): Gesture {
  const { doc, pageId, view } = store.get(), tag = gestureStep(), shape = SHAPES[tool]
  const parentId = frameAt(doc, pageId, p.world), toParent = invert(worldMatrix(doc, parentId))
  const targets = worldRotation(doc, parentId) === 0 ? snapTargets(doc, parentId, []) : []
  const snapped = (q: Pointer) => {
    const sn = snap([q.world.x], [q.world.y], targets, SNAP_PX / view.zoom)
    return { at: apply(toParent, { x: q.world.x + sn.dx, y: q.world.y + sn.dy }), guides: sn.guides }
  }
  const a = snapped(p).at
  const node = makeNode(shape.type, { name: nextName(doc, shape.label), ...shape.props })
  const place = (geometry: Partial<Node>) => store.update(() => ({ doc: insert(doc, { ...node, ...geometry }, parentId), ids: [node.id] }), tag)
  let drawn = false
  return {
    move(q) {
      if (!drawn && dist(q.screen, p.screen) < DRAG_PX) return
      drawn = true
      const { at: b, guides } = snapped(q)
      if (shape.type === 'LINE') place(lineBetween(a, q.shift ? snapAngle(a, b) : b))
      else {
        let w = b.x - a.x, h = b.y - a.y
        if (q.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = m * Math.sign(w || 1); h = m * Math.sign(h || 1) }
        const x0 = q.alt ? a.x - w : a.x, y0 = q.alt ? a.y - h : a.y // Alt draws from the centre
        place({ x: Math.min(x0, a.x + w), y: Math.min(y0, a.y + h), width: Math.max(1, Math.abs(a.x + w - x0)), height: Math.max(1, Math.abs(a.y + h - y0)) })
      }
      store.set({ overlay: { guides } })
    },
    up() {
      if (!drawn) place({ x: a.x, y: a.y, width: 100, height: shape.type === 'LINE' ? 0 : 100 })
      store.set({ tool: 'move', overlay: {} })
    },
  }
}

/** The step that creates a text node; its first commit joins it. */
export const textStep = (id: string) => gestureStep(`text-${id}`)

/** Click for auto-width text, drag for a fixed-width box. Editing starts immediately. */
function textGesture(store: EditorStore, p: Pointer): Gesture {
  const { doc, pageId } = store.get()
  const parentId = frameAt(doc, pageId, p.world), toParent = invert(worldMatrix(doc, parentId)), a = apply(toParent, p.world)
  return {
    move() {},
    up(q) {
      const b = apply(toParent, q.world), dragged = dist(q.screen, p.screen) > DRAG_PX
      const node = makeNode('TEXT', {
        name: 'Text', fills: [solid(0, 0, 0)], x: dragged ? Math.min(a.x, b.x) : a.x, y: dragged ? Math.min(a.y, b.y) : a.y,
        ...(dragged && { width: Math.max(1, Math.abs(b.x - a.x)), textAutoWidth: false }),
      })
      store.update(() => ({ doc: insert(doc, node, parentId), ids: [node.id] }), textStep(node.id))
      store.set({ tool: 'move', editingText: node.id })
    },
  }
}
