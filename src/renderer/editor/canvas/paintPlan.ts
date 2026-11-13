// What a node draws, decided once for both renderers: the canvas (render.ts) and SVG export (export/svg.ts).
// Each renderer only maps these decisions onto its own API.
import type { DropShadow, Node, Paint } from '../../../shared/document'

export type Drawable = Exclude<Paint, { type: 'IMAGE' }>

/**
 * The paints a node draws, in paint order. Lines take no fill and text no image; strokes need a weight and are never
 * images. A group draws no fills or shadows of its own. A shadow is cast when the node has any visible fill or stroke.
 */
export function paintsOf(n: Node): { fills: Paint[]; strokes: Drawable[]; shadows: DropShadow[] } {
  const visible = <T extends { visible: boolean }>(list: T[]) => list.filter((p) => p.visible)
  const stroked = n.strokeWeight > 0 ? visible(n.strokes) : []
  const strokes = stroked.filter((p): p is Drawable => p.type !== 'IMAGE')
  if (n.type === 'GROUP') return { fills: [], strokes, shadows: [] }
  const fills = n.type === 'LINE' ? [] : visible(n.fills).filter((p) => !(p.type === 'IMAGE' && n.type === 'TEXT'))
  return { fills, strokes, shadows: visible(n.fills).length || stroked.length ? visible(n.effects) : [] }
}

/** How far a stroke's centre line sits outside the node's outline: inside strokes in, outside ones out. Lines centre. */
export const strokeGrow = (n: Node) =>
  n.type === 'LINE' || n.strokeAlign === 'CENTER' ? 0 : n.strokeAlign === 'INSIDE' ? -n.strokeWeight / 2 : n.strokeWeight / 2

/** The node's box grown outward by `grow` on every side, its corner radius grown to match (clamped to fit). */
export function grownBox(n: Node, grow: number): { w: number; h: number; r: number } {
  const w = Math.max(0, n.width + grow * 2), h = Math.max(0, n.height + grow * 2)
  return { w, h, r: n.cornerRadius ? Math.max(0, Math.min(n.cornerRadius + grow, w / 2, h / 2)) : 0 }
}

/** A VECTOR imported with its stroke already outlined: the stroke is drawn by filling those paths. */
export const outlinedStroke = (n: Node) => n.type === 'VECTOR' && n.vector!.stroke.length > 0
