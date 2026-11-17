import { worldBox, type Box, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'
import type { EditorStore } from '../store'

/** screen = world · zoom + (x, y) */
export interface View { x: number; y: number; zoom: number }
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 256

export const toWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom })
export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y })

/** Sets the zoom while keeping the world point under screen point `p` fixed. */
export function zoomAt(v: View, p: Pt, zoom: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), w = toWorld(v, p)
  return { zoom: z, x: p.x - w.x * z, y: p.y - w.y * z }
}

/** Centres `box` in a viewport of `size`. An empty box gives 100 % around the origin. */
export function fitView(box: Box | null, size: { w: number; h: number }, pad = 48, maxZoom = MAX_ZOOM): View {
  if (!box || (!box.w && !box.h)) {
    const c = box ?? { x: 0, y: 0 }
    return { zoom: 1, x: size.w / 2 - c.x, y: size.h / 2 - c.y }
  }
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.min((size.w - pad * 2) / (box.w || 1), (size.h - pad * 2) / (box.h || 1))))
  return { zoom, x: size.w / 2 - (box.x + box.w / 2) * zoom, y: size.h / 2 - (box.y + box.h / 2) * zoom }
}

/** Zooms to fit the whole page (never past `maxZoom`: 100 % when a page opens, any zoom on request). */
export function zoomToFit(store: EditorStore, maxZoom?: number) {
  const s = store.get()
  store.set({ view: fitView(worldBox(s.doc, childrenOf(s.doc, s.pageId).map((n) => n.id)), s.size, 48, maxZoom) })
}
