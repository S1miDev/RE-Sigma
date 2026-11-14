// The arrow tool: drag from the tail to the head; a VECTOR with a shaft and a filled triangular head.
import { makeNode, solid } from '../../../shared/document'
import { frameAt } from '../canvas/hit'
import { apply, invert, worldMatrix } from '../model/geometry'
import { insert, nextName, put } from '../model/ops'
import { withAnchors } from '../model/path'
import { arrowSubs } from '../model/shapes'
import { gestureStep, type EditorStore } from '../store'
import { DRAG_PX, dist, snapAngle, type Gesture, type Pointer } from './pointer'

const HEAD = 12 // arrowhead length (px in the parent's space)

/** Drag to draw (Shift keeps 45° steps). A click draws nothing. The tool returns to Move when the arrow is done. */
export function arrowGesture(store: EditorStore, p: Pointer): Gesture {
  const { doc, pageId } = store.get(), tag = gestureStep(), parentId = frameAt(doc, pageId, p.world), toParent = invert(worldMatrix(doc, parentId))
  const a = apply(toParent, p.world)
  const node = makeNode('VECTOR', { name: nextName(doc, 'Arrow'), fills: [solid(0, 0, 0)], strokes: [solid(0, 0, 0)], strokeAlign: 'CENTER', strokeWeight: 2, vector: { w: 0, h: 0, fill: [], stroke: [] } })
  let drawn = false
  return {
    move(q) {
      if (!drawn && dist(q.screen, p.screen) < DRAG_PX) return
      drawn = true
      const free = apply(toParent, q.world), b = q.shift ? snapAngle(a, free) : free
      store.update((d) => {
        const n = withAnchors({ ...(d.nodes[node.id] ?? node), x: 0, y: 0, width: 0, height: 0, rotation: 0 }, arrowSubs(a, b, HEAD))
        return { doc: d.nodes[node.id] ? put(d, [n]) : insert(d, n, parentId), ids: [node.id] }
      }, tag)
    },
    up() {
      store.set({ tool: 'move' })
    },
  }
}
