// What every gesture works with: the pointer, and the distances and snaps shared between tools.
import type { Pt } from '../model/geometry'

export interface Pointer { screen: Pt; world: Pt; shift: boolean; alt: boolean; ctrl: boolean }
export interface Gesture { move(p: Pointer): void; up(p: Pointer): void }

export const SNAP_PX = 5
export const DRAG_PX = 3
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
/** Rounds the direction from → to to a multiple of 45°, keeping the length. */
export function snapAngle(from: Pt, to: Pt): Pt {
  const len = dist(from, to), a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len }
}
