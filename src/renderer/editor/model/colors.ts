// Colours the user can pick again: ones already in the document, and the ones picked recently.
import type { Color, Document } from '../../../shared/document'
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
