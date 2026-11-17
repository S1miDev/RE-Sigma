// Colours the user can pick again: ones already in the document, and the ones picked recently.
import type { Color, Document, Node } from '../../../shared/document'
import { descendants, patch } from './ops'
import { toHex } from '../../ui'

export const RECENT = 8
const DOCUMENT = 24

/** Adds `c` (alpha ignored) in front of `list`, dropping its earlier copy and anything past `max`. */
export function pushColor(list: Color[], c: Color, max = RECENT): Color[] {
  const hex = toHex(c)
  return [{ ...c, a: 1 }, ...list.filter((o) => toHex(o) !== hex)].slice(0, max)
}

/** Distinct (by hex) solid, gradient-stop, shadow and text colours of the document, in node order. */
export function documentColors(doc: Document): Color[] {
  const seen = new Map<string, Color>()
  for (const n of Object.values(doc.nodes)) {
    const cs: Color[] = []
    for (const p of [...n.fills, ...n.strokes]) {
      if (p.type === 'SOLID') cs.push(p.color)
      else if (p.type === 'GRADIENT') cs.push(...p.stops.map((s) => s.color))
    }
    for (const e of n.effects) if ('color' in e) cs.push(e.color)
    for (const r of n.runs ?? []) if (r.style.fill) cs.push(r.style.fill)
    for (const c of cs) if (!seen.has(toHex(c))) seen.set(toHex(c), { ...c, a: 1 })
  }
  return [...seen.values()].slice(0, DOCUMENT)
}

export interface UsedColor { hex: string; color: Color; count: number }
// shortcut: solid paints and text run fills only; gradient stops, effects and style-linked paints are left out (a style owns its colour). Add them if users ask.
const own = (n: Node, field: 'fills' | 'strokes') => !(field === 'fills' ? n.fillStyle : n.strokeStyle)

/** Distinct solid colours (by hex, alpha ignored) used by `ids` and everything inside them, with how many paints use each. */
export function selectionColors(doc: Document, ids: string[]): UsedColor[] {
  const out = new Map<string, UsedColor>()
  const add = (c: Color) => {
    const hex = toHex(c), u = out.get(hex)
    if (u) u.count++
    else out.set(hex, { hex, color: { ...c, a: 1 }, count: 1 })
  }
  for (const n of nodesUnder(doc, ids)) colorsOf(n).forEach(add)
  return [...out.values()]
}

/** The colours of one node that the selection colours list and replace. */
function colorsOf(n: Node): Color[] {
  const cs: Color[] = []
  for (const f of ['fills', 'strokes'] as const) if (own(n, f)) for (const p of n[f]) if (p.type === 'SOLID') cs.push(p.color)
  for (const r of n.runs ?? []) if (r.style.fill) cs.push(r.style.fill)
  return cs
}

/** Sets every solid paint and run fill of colour `hex` under `ids` to `to`'s RGB; each paint keeps its own alpha. */
export function replaceColor(doc: Document, ids: string[], hex: string, to: Color): Document {
  const swap = (c: Color) => (toHex(c) === hex ? { ...c, r: to.r, g: to.g, b: to.b } : c)
  const users = nodesUnder(doc, ids).filter((n) => colorsOf(n).some((c) => toHex(c) === hex))
  return patch(doc, users.map((n) => n.id), (n) => ({
    ...(own(n, 'fills') && { fills: n.fills.map((p) => (p.type === 'SOLID' ? { ...p, color: swap(p.color) } : p)) }),
    ...(own(n, 'strokes') && { strokes: n.strokes.map((p) => (p.type === 'SOLID' ? { ...p, color: swap(p.color) } : p)) }),
    ...(n.runs && { runs: n.runs.map((r) => (r.style.fill ? { ...r, style: { ...r.style, fill: swap(r.style.fill) } } : r)) }),
  }))
}

/** `ids` and their descendants, each once (a selection may hold a node and its ancestor). */
function nodesUnder(doc: Document, ids: string[]): Node[] {
  const seen = new Map<string, Node>()
  for (const id of ids) for (const n of doc.nodes[id] ? [doc.nodes[id], ...descendants(doc, id)] : []) seen.set(n.id, n)
  return [...seen.values()]
}
