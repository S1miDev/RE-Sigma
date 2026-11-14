// Crop mode: drag the image of a CROP fill to move it, drag one of its corners to scale it about its centre.
import { cropCorners, handleAt } from '../canvas/overlay'
import { invert, worldMatrix } from '../model/geometry'
import { patch } from '../model/ops'
import { gestureStep, NO_MODE, type EditorStore, type Mode } from '../store'
import type { Gesture, Pointer } from './pointer'

export function cropGesture(store: EditorStore, p: Pointer, mode: Extract<Mode, { kind: 'crop' }>): Gesture | null {
  const { doc, view } = store.get(), crop = cropCorners(doc, mode, view, store.image)
  if (!crop) return void store.set({ mode: NO_MODE }), null
  const n = doc.nodes[mode.id], start = crop.paint, tag = gestureStep()
  const write = (change: Partial<typeof start>) => store.update(() => patch(doc, [n.id], { fills: n.fills.map((f, i) => (i === mode.paint ? { ...start, ...change } : f)) }), tag)
  if (handleAt(crop.corners.map((at) => ({ kind: 'resize' as const, hx: 0, hy: 0, at })), p.screen)) {
    const c = { x: (crop.corners[0].x + crop.corners[2].x) / 2, y: (crop.corners[0].y + crop.corners[2].y) / 2 }
    const from = Math.hypot(p.screen.x - c.x, p.screen.y - c.y) || 1
    return { move: (q) => write({ scale: Math.min(100, Math.max(0.01, (start.scale ?? 1) * (Math.hypot(q.screen.x - c.x, q.screen.y - c.y) / from))) }), up() {} }
  }
  const toLocal = invert(worldMatrix(doc, n.id)) // only its linear part moves a delta
  return {
    move(q) {
      const dx = q.world.x - p.world.x, dy = q.world.y - p.world.y
      write({ offsetX: (start.offsetX ?? 0) + toLocal[0] * dx + toLocal[2] * dy, offsetY: (start.offsetY ?? 0) + toLocal[1] * dx + toLocal[3] * dy })
    },
    up() {},
  }
}
