// Per-range text styles. A TEXT's `runs` cover `characters` in order; each run overrides some of the node's own text fields.
import type { Node, RunStyle, TextRun } from '../../../shared/document'

const KEYS: (keyof RunStyle)[] = ['fontFamily', 'fontWeight', 'fontSize', 'fontItalic', 'textDecoration', 'textCase', 'letterSpacing', 'lineHeight', 'fill']
const same = (a: RunStyle, b: RunStyle) => KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
const clean = (s: RunStyle): RunStyle => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as RunStyle

/** Drops empty runs and merges equal neighbours. */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = []
  for (const r of runs) {
    if (r.len <= 0) continue
    const last = out.at(-1)
    if (last && same(last.style, r.style)) last.len += r.len
    else out.push({ len: r.len, style: clean(r.style) })
  }
  return out.every((r) => !Object.keys(r.style).length) ? [] : out // all-default = no runs
}

/** The node's runs, padded or cut so they always cover `characters` exactly (a patch to `characters` alone can't break them). */
function cover(n: Pick<Node, 'characters' | 'runs'>): TextRun[] {
  const total = (n.characters ?? '').length
  let left = total
  const runs: TextRun[] = []
  for (const r of n.runs ?? []) {
    const len = Math.min(r.len, left)
    if (len > 0) runs.push({ len, style: r.style })
    left -= len
  }
  if (left > 0) runs.push({ len: left, style: runs.at(-1)?.style ?? {} })
  return runs
}

/** The node's runs in canonical form: covering the text, merged, and empty when nothing is overridden. */
export const runsOf = (n: Pick<Node, 'characters' | 'runs'>) => normalizeRuns(cover(n))

/** The override style of the character at `i` (clamped; an empty text has none). */
export function styleAt(n: Pick<Node, 'characters' | 'runs'>, i: number): RunStyle {
  let at = 0
  const runs = cover(n)
  for (const r of runs) { at += r.len; if (i < at) return r.style }
  return runs.at(-1)?.style ?? {}
}

/** The node's text fields with a run's overrides on top. */
export const styleOf = (n: Node, s: RunStyle): Node => ({ ...n, ...clean(s) } as Node)

/** The value of `key` over [from, to): its single value, or `null` when the range mixes values. A collapsed range reads the char before the caret. */
export function commonStyle<K extends keyof RunStyle>(n: Node, from: number, to: number, key: K): RunStyle[K] | null {
  const base = (n as unknown as RunStyle)[key]
  const values = from === to ? [styleAt(n, Math.max(0, from - 1))[key] ?? base] : runsIn(n, from, to).map((r) => r.style[key] ?? base)
  return values.every((v) => JSON.stringify(v) === JSON.stringify(values[0])) ? (values[0] as RunStyle[K]) : null
}

function runsIn(n: Pick<Node, 'characters' | 'runs'>, from: number, to: number): TextRun[] {
  const out: TextRun[] = []
  let at = 0
  for (const r of cover(n)) {
    const a = Math.max(from, at), b = Math.min(to, at + r.len)
    if (b > a) out.push({ len: b - a, style: r.style })
    at += r.len
  }
  return out
}

/** Replaces [from, to) with `text`, which takes `style` (or, when absent, the style of the char before `from`). */
export function splice(n: Pick<Node, 'characters' | 'runs'>, from: number, to: number, text: string, style?: RunStyle): { characters: string; runs: TextRun[] } {
  const chars = n.characters ?? ''
  const inherit = style ?? styleAt(n, Math.max(0, from - 1))
  const runs = [...runsIn(n, 0, from), ...(text ? [{ len: text.length, style: inherit }] : []), ...runsIn(n, to, chars.length)]
  return { characters: chars.slice(0, from) + text + chars.slice(to), runs: normalizeRuns(runs) }
}

/** Applies `patch` to [from, to); a key set to `undefined` removes that override. */
export function styleRange(n: Pick<Node, 'characters' | 'runs'>, from: number, to: number, patch: RunStyle): TextRun[] {
  const total = (n.characters ?? '').length
  const mid = runsIn(n, from, to).map((r) => ({ len: r.len, style: clean({ ...r.style, ...patch }) })) // clean drops undefined = unset
  return normalizeRuns([...runsIn(n, 0, from), ...mid, ...runsIn(n, to, total)])
}
