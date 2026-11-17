// Scale tool: resizes nodes and everything measured in px inside them (strokes, radii, text, effects, spacing) by one factor.
import type { Document, Effect, Node, Paint } from '../../../shared/document'
import { apply, worldMatrix, type Pt } from './geometry'
import { descendants, patch, put, topLevel } from './ops'

const scalePaint = (p: Paint, f: number): Paint => (p.type === 'IMAGE' && (p.offsetX || p.offsetY) ? { ...p, offsetX: (p.offsetX ?? 0) * f, offsetY: (p.offsetY ?? 0) * f } : p)
const scaleEffect = (e: Effect, f: number): Effect => ('x' in e ? { ...e, x: e.x * f, y: e.y * f, blur: e.blur * f, spread: e.spread * f } : { ...e, blur: e.blur * f })
const four = (v: [number, number, number, number], f: number): [number, number, number, number] => [v[0] * f, v[1] * f, v[2] * f, v[3] * f]

/** The px-valued fields of one node scaled by `f` (position and size excluded). */
function look(n: Node, f: number): Partial<Node> {
  const out: Partial<Node> = { strokeWeight: n.strokeWeight * f, cornerRadius: n.cornerRadius * f }
  if (n.strokeSides) out.strokeSides = four(n.strokeSides, f)
  if (n.strokeDash) out.strokeDash = n.strokeDash.map((d) => d * f)
  if (n.cornerRadii) out.cornerRadii = four(n.cornerRadii, f)
  if (n.effects.length) out.effects = n.effects.map((e) => scaleEffect(e, f))
  if (n.fills.some((p) => p.type === 'IMAGE')) out.fills = n.fills.map((p) => scalePaint(p, f))
  if (n.layout) out.layout = { ...n.layout, gap: n.layout.gap * f, padding: four(n.layout.padding, f) }
  if (n.layoutGrids) out.layoutGrids = n.layoutGrids.map((g) => ({ ...g, size: g.size * f, gutter: g.gutter * f, margin: g.margin * f }))
  if (n.type === 'TEXT') {
    if (n.fontSize) out.fontSize = n.fontSize * f
    if (n.lineHeight) out.lineHeight = n.lineHeight * f
    if (n.letterSpacing) out.letterSpacing = n.letterSpacing * f
    if (n.runs) out.runs = n.runs.map((r) => ({ len: r.len, style: { ...r.style, ...(r.style.fontSize && { fontSize: r.style.fontSize * f }), ...(r.style.lineHeight && { lineHeight: r.style.lineHeight * f }), ...(r.style.letterSpacing && { letterSpacing: r.style.letterSpacing * f }) } }))
  }
  return out
}

/**
 * Scales the selected nodes and their subtrees by `f` about `origin` (a world point; the selection's top-left is the usual choice).
 * shortcut: the origin is mapped into each parent by its position only, so a rotated parent shifts its children a little; upgrade with a full inverse transform.
 */
export function scaleTree(doc: Document, ids: string[], f: number, origin: Pt): Document {
  if (!(f > 0) || !Number.isFinite(f) || f === 1) return doc
  let out = doc
  for (const id of topLevel(doc, ids).filter((i) => !doc.nodes[i].locked)) {
    const n = doc.nodes[id], p = apply(worldMatrix(doc, n.parentId), { x: 0, y: 0 }), o = { x: origin.x - p.x, y: origin.y - p.y }
    out = put(out, [{ ...n, ...look(n, f), x: o.x + (n.x - o.x) * f, y: o.y + (n.y - o.y) * f, width: n.width * f, height: n.height * f }])
    for (const c of descendants(doc, id)) out = patch(out, [c.id], { ...look(c, f), x: c.x * f, y: c.y * f, width: c.width * f, height: c.height * f })
  }
  return out
}
