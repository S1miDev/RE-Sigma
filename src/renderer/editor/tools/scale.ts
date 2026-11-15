// The scale tool (K): drag away from or towards the selection's top-left corner to scale it and everything inside it.
import { hitTest } from '../canvas/hit'
import { worldBox } from '../model/geometry'
import { topLevel } from '../model/ops'
import { scaleTree } from '../model/scale'
import { gestureStep, type EditorStore } from '../store'
import { dist, type Gesture, type Pointer } from './pointer'

export function scaleGesture(store: EditorStore, p: Pointer): Gesture | null {
  let { doc, pageId, selection, view } = store.get()
  if (!selection.length) {
    const hit = hitTest(doc, pageId, p.world, { tolerance: 4 / view.zoom })
    if (!hit) return null
    selection = [hit]
    store.set({ selection })
  }
  const ids = topLevel(doc, selection), box = worldBox(doc, ids), tag = gestureStep()
  if (!box) return null
  const o = { x: box.x, y: box.y }, start = Math.max(dist(p.world, o), 1)
  return {
    move: (q) => store.update(() => scaleTree(doc, ids, Math.max(0.01, dist(q.world, o) / start), o), tag),
    up: () => store.set({ tool: 'move' }),
  }
}
