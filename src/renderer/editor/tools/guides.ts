// User guides: drag from a ruler to make one, drag an existing one to move it, drag it back into the ruler (or off the canvas) to remove it.
import type { Guide } from '../../../shared/document'
import { RULER } from '../canvas/aids'
import { patch } from '../model/ops'
import { gestureStep, type EditorStore } from '../store'
import type { Gesture, Pointer } from './pointer'

/** The page's guides that things snap to (none while guides are hidden). */
export function snapLines(store: EditorStore): Guide[] {
  const s = store.get()
  return s.guidesVisible ? s.doc.nodes[s.pageId]?.guides ?? [] : []
}

/** A press in a ruler strip starts a new guide (the top ruler makes a horizontal one); null elsewhere. */
export function rulerGesture(store: EditorStore, p: Pointer): Gesture | null {
  if (!store.get().rulers) return null
  if (p.screen.y < RULER && p.screen.x >= RULER) return guideGesture(store, p, null, 'y')
  if (p.screen.x < RULER && p.screen.y >= RULER) return guideGesture(store, p, null, 'x')
  return p.screen.x < RULER && p.screen.y < RULER ? { move() {}, up() {} } : null // the corner swallows the press
}

/** Moves guide `index` (null: a new one) on `axis` while the pointer drags; one undo step. */
export function guideGesture(store: EditorStore, p: Pointer, index: number | null, axis: 'x' | 'y'): Gesture {
  const { doc, pageId } = store.get(), tag = gestureStep(), old = doc.nodes[pageId].guides ?? []
  const commit = (guides: Guide[]) => store.update(() => patch(doc, [pageId], { guides: guides.length ? guides : undefined }), tag)
  return {
    move(q) {
      const edge = store.get().rulers ? RULER : 0, pos = Math.round(q.world[axis])
      if (q.screen[axis] < edge) { // back in the ruler: the guide goes
        commit(index === null ? old : old.filter((_, i) => i !== index))
        return void store.set({ overlay: {} })
      }
      commit(index === null ? [...old, { axis, pos }] : old.map((g, i) => (i === index ? { ...g, pos } : g)))
      store.set({ overlay: { guide: { axis, pos } } })
    },
    up: () => store.set({ overlay: {} }),
  }
}
