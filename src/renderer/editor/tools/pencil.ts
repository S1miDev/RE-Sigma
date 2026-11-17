// The pencil tool: drag to draw a freehand VECTOR, smoothed into Bézier anchors when the pointer is released.
import { makeNode, solid } from '../../../shared/document'
import { frameAt } from '../canvas/hit'
import { apply, invert, worldMatrix, type Pt } from '../model/geometry'
import { insert, nextName, put, remove } from '../model/ops'
import { fitStroke, withAnchors, type Anchor } from '../model/path'
import { gestureStep, type EditorStore } from '../store'
import { dist, type Gesture, type Pointer } from './pointer'

const SAMPLE_PX = 2 // a new point once the pointer moved this far (screen px)
const TOLERANCE_PX = 1.5 // how far the smoothed curve may stray from the drawn points (screen px)

/** Pencil: the stroke shows as a polyline while dragging, then becomes a smooth path (one undo step). A click draws nothing. */
export function pencilGesture(store: EditorStore, p: Pointer): Gesture {
  const { doc, pageId, view } = store.get(), parentId = frameAt(doc, pageId, p.world), toParent = invert(worldMatrix(doc, parentId))
  const at = (q: Pointer) => apply(toParent, q.world)
  const node = makeNode('VECTOR', { name: nextName(doc, 'Vector'), strokes: [solid(0, 0, 0)], strokeAlign: 'CENTER', vector: { w: 0, h: 0, fill: [], stroke: [] } })
  const tag = gestureStep(`pencil-${node.id}`)
  const points: Pt[] = [at(p)]
  let last = p, drawn = false
  const write = (anchors: Anchor[]) => store.update((d) => {
    const n = withAnchors({ ...(d.nodes[node.id] ?? node), x: 0, y: 0, width: 0, height: 0, rotation: 0 }, [{ anchors, closed: false }])
    return { doc: d.nodes[node.id] ? put(d, [n]) : insert(d, n, parentId), ids: [node.id] }
  }, tag)
  return {
    move(q) {
      if (dist(q.screen, last.screen) < SAMPLE_PX) return
      last = q, drawn = true
      points.push(at(q))
      write(points)
    },
    up() {
      if (!drawn) return
      const anchors = fitStroke(points, TOLERANCE_PX / view.zoom)
      if (anchors.length < 2) return void store.update((d) => remove(d, [node.id]), tag)
      write(anchors)
      store.set({ selection: [node.id] })
    },
  }
}
