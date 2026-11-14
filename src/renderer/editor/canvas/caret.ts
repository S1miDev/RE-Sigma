// Caret geometry over a text layout: where an index is, which index a point is at, and the boxes a selection covers.
// All coordinates are in the text node's own space (origin at its top-left corner).
import { measure, type Seg, type TextLayout, type TextLine } from './text'

export interface CaretBox { x: number; y: number; h: number; line: number }

const prefixWidth = (s: Seg, k: number) => (k <= 0 ? 0 : k >= s.text.length ? s.width : measure(s.text.slice(0, k), s.style))
/** Whether the next line continues this one without a paragraph break (a wrap), so `end` belongs to the next line's start. */
const wrapsInto = (layout: TextLayout, i: number) => layout.lines[i + 1]?.start === layout.lines[i].end

/** The line holding `index`; at a wrap boundary that is the line that starts there. */
function lineOf(layout: TextLayout, index: number): number {
  const ls = layout.lines
  for (let i = 0; i < ls.length; i++) if (index >= ls[i].start && (index < ls[i].end || (index === ls[i].end && !wrapsInto(layout, i)))) return i
  return index < (ls[0]?.start ?? 0) ? 0 : ls.length - 1
}

function xIn(line: TextLine, index: number): number {
  for (const s of line.segs) if (!s.mark && index >= s.start && index <= s.end) return s.x + prefixWidth(s, index - s.start)
  const last = line.segs.at(-1)
  return last ? last.x + last.width : line.x
}

export function caretPos(layout: TextLayout, index: number): CaretBox {
  const line = lineOf(layout, index), l = layout.lines[line]
  return { x: xIn(l, Math.min(Math.max(index, l.start), l.end)), y: l.top, h: l.height, line }
}

/** The index nearest to a point: the line by y, then the nearest character boundary by x. */
export function indexAt(layout: TextLayout, x: number, y: number): number {
  const ls = layout.lines
  let li = 0
  while (li < ls.length - 1 && y >= ls[li + 1].top) li++
  const l = ls[li]
  let best = l.start, bestD = Infinity
  const own = l.segs.filter((s) => !s.mark)
  for (const s of own) for (let k = 0; k <= s.text.length; k++) {
    const d = Math.abs(x - (s.x + prefixWidth(s, k)))
    if (d < bestD) { bestD = d; best = s.start + k }
  }
  // never land on a wrap boundary from the left: that index is the next line's start
  return best === l.end && wrapsInto(layout, li) && l.end > l.start ? best - 1 : best
}

/** First and last index of the caret's line, for Home and End. */
export function lineBounds(layout: TextLayout, index: number): [number, number] {
  const i = lineOf(layout, index), l = layout.lines[i]
  return [l.start, wrapsInto(layout, i) && l.end > l.start ? l.end - 1 : l.end]
}

/** The boxes a selection [a, b) covers, one per line (an empty line or a paragraph break gets a narrow stub). */
export function selectionRects(layout: TextLayout, a: number, b: number): { x: number; y: number; w: number; h: number }[] {
  if (a === b) return []
  const out: { x: number; y: number; w: number; h: number }[] = []
  layout.lines.forEach((l, i) => {
    const lo = Math.max(a, l.start), hi = Math.min(b, l.end), breaks = !wrapsInto(layout, i) && a <= l.end && b > l.end // the selection takes this line's newline
    if (hi < lo || (hi === lo && !breaks)) return
    const x0 = xIn(l, lo), x1 = xIn(l, hi)
    out.push({ x: x0, y: l.top, w: x1 - x0 + (breaks ? 4 : 0), h: l.height })
  })
  return out
}

/** The word around `index` ([start, end)): a run of word characters, or of spaces/punctuation, between line breaks. */
export function wordAt(text: string, index: number): [number, number] {
  const kind = (c: string | undefined) => (c === undefined || c === '\n' ? 0 : /[\p{L}\p{N}_]/u.test(c) ? 1 : /\s/u.test(c) ? 2 : 3)
  const k = kind(text[index]) || kind(text[index - 1])
  if (!k) return [index, index]
  let a = index, b = index
  while (a > 0 && kind(text[a - 1]) === k) a--
  while (b < text.length && kind(text[b]) === k) b++
  return [a, b]
}
