import type { Color, Node } from '../../../shared/document'
import { runsOf, styleOf } from '../model/richText'

/** CSS font shorthand. The bundled "Inter Variable" backs up a missing family. */
export const fontOf = (n: Node, scale = 1) => `${n.fontItalic ? 'italic ' : ''}${n.fontWeight ?? 400} ${(n.fontSize ?? 16) * scale}px "${(n.fontFamily ?? 'Inter').replace(/["\\]/g, '')}", "Inter Variable", sans-serif`
export const lineHeightOf = (n: Node) => n.lineHeight || Math.round((n.fontSize ?? 16) * 1.2)

let ctx: CanvasRenderingContext2D | null | undefined
const getCtx = () => (ctx === undefined ? (ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')) : ctx)
/** `n` is a node or a node with a run's style merged in (see styleOf). */
export function measure(text: string, n: Node): number {
  const c = getCtx()
  if (!c) return text.length * ((n.fontSize ?? 16) * 0.55 + (n.letterSpacing ?? 0)) // no canvas (tests): rough estimate
  c.font = fontOf(n)
  c.letterSpacing = `${n.letterSpacing ?? 0}px`
  return c.measureText(text).width
}
/** Distance from the baseline up to the font's top and down to its bottom. */
function metrics(n: Node): { a: number; d: number } {
  const c = getCtx(), size = n.fontSize ?? 16
  if (c) {
    c.font = fontOf(n)
    const m = c.measureText('Hg')
    if (m.fontBoundingBoxAscent) return { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent }
  }
  return { a: size * 0.8, d: size * 0.2 }
}

/** `s` in the node's text case. TITLE capitalises each word's first letter and leaves the rest alone; `prev` is the character before `s`. */
export function caseText(s: string, n: Node, prev = '\n') {
  if (n.textCase === 'UPPER') return s.toUpperCase()
  if (n.textCase === 'LOWER') return s.toLowerCase()
  if (n.textCase === 'TITLE') return (prev + s).replace(/(^|\s)(\S)/gu, (_, a: string, b: string) => a + b.toUpperCase()).slice(prev.length)
  return s
}

/** A run of text drawn in one style. `start`/`end` index `characters` (a list mark or ellipsis is `mark` and covers none); `x` is its left edge in the box. */
export interface Seg { text: string; style: Node; fill?: Color; x: number; width: number; start: number; end: number; mark?: boolean }
/** A laid-out line covering characters [start, end] (an empty line has start = end). `x` is its left edge (alignment and list indent included), `y` its baseline, `top`/`height` its box, `indent` the hanging list indent already inside `x`. */
export interface TextLine { segs: Seg[]; text: string; start: number; end: number; width: number; x: number; y: number; top: number; height: number; ascent: number; indent: number }
export interface TextLayout { lines: TextLine[]; width: number; height: number }

interface Frag { text: string; node: Node; fill?: Color; start: number; end: number; mark?: boolean }
interface RawLine { frags: Frag[]; indent: number; trim: boolean; base: Node; ps: number }
const isSpace = (f: Frag | undefined) => !!f && !f.mark && f.text[0] === ' '
const widthOf = (frags: Frag[]) => frags.reduce((w, f) => w + measure(f.text, f.node), 0)

/**
 * Lines of a TEXT node: one per paragraph when auto-width, otherwise wrapped greedily by word at the node's width.
 * Styles come from the node's runs, so a line can mix sizes; they share a baseline. `editing` keeps text that truncation would hide.
 */
export function layoutText(n: Node, opts: { editing?: boolean } = {}): TextLayout {
  const chars = n.characters ?? '', runs = runsOf(n), auto = !!n.textAutoWidth
  const spans: { start: number; end: number; node: Node; fill?: Color }[] = []
  let at = 0
  for (const r of runs) { spans.push({ start: at, end: at + r.len, node: styleOf(n, r.style), fill: r.style.fill }); at += r.len }
  if (!spans.length) spans.push({ start: 0, end: chars.length, node: n })

  const raw: RawLine[] = []
  let count = 0, ps = 0
  for (const para of chars.split('\n')) {
    const pe = ps + para.length
    const base = spans.find((s) => ps >= s.start && ps <= s.end)?.node ?? n
    const mark = n.listStyle === 'BULLET' ? '• ' : n.listStyle === 'NUMBERED' ? `${++count}. ` : ''
    const markFrag: Frag[] = mark ? [{ text: mark, node: n, start: ps, end: ps, mark: true }] : []
    const markW = mark ? measure(mark, n) : 0
    // words with their trailing spaces, split where the style changes too
    const tokens: Frag[][] = []
    let cur: Frag[] = [], prevSpace = false
    for (const s of spans) {
      const a = Math.max(s.start, ps), b = Math.min(s.end, pe)
      if (b <= a) continue
      const shown = caseText(chars.slice(a, b), s.node, a > 0 ? chars[a - 1] : '\n')
      let o = a
      for (const part of shown.match(/ +|[^ ]+/g) ?? []) {
        const space = part[0] === ' '
        if (cur.length && prevSpace && !space) { tokens.push(cur); cur = [] }
        cur.push({ text: part, node: s.node, fill: s.fill, start: o, end: o + part.length })
        o += part.length
        prevSpace = space
      }
    }
    if (cur.length) tokens.push(cur)

    if (auto) { raw.push({ frags: [...markFrag, ...tokens.flat()], indent: 0, trim: false, base, ps }); ps = pe + 1; continue }
    let line = [...markFrag], lineW = markW, hasWord = false, extra = 0 // extra: the hanging indent on continuation lines
    for (const t of tokens) {
      const tw = widthOf(t), tt = isSpace(t.at(-1)) ? measure(t.at(-1)!.text, t.at(-1)!.node) : 0
      if (hasWord && lineW + tw - tt + extra > n.width) { raw.push({ frags: line, indent: extra, trim: true, base, ps }); line = []; lineW = 0; hasWord = false; extra = markW }
      line.push(...t)
      lineW += tw
      hasWord = true
    }
    raw.push({ frags: line, indent: extra, trim: false, base, ps })
    ps = pe + 1
  }

  const baseLH = lineHeightOf(n)
  const limit = n.maxLines || (n.textFixedHeight ? Math.floor(n.height / baseLH) : 0)
  let shown = raw
  if (!opts.editing && n.textTruncate && limit > 0 && raw.length > limit) {
    shown = raw.slice(0, limit)
    const last = shown[limit - 1], room = auto ? Infinity : n.width - last.indent
    let fr = last.frags
    while (fr.length && widthOf(fr) + measure('…', fr.at(-1)!.node) > room) {
      const f = fr.at(-1)!
      fr = f.text.length <= 1 || f.mark ? fr.slice(0, -1) : [...fr.slice(0, -1), { ...f, text: f.text.slice(0, -1), end: f.end - 1 }]
    }
    const tail = fr.at(-1), node = tail?.node ?? last.base
    shown = [...shown.slice(0, -1), { ...last, trim: false, frags: [...fr, { text: '…', node, fill: tail?.fill, start: tail?.end ?? 0, end: tail?.end ?? 0, mark: true }] }]
  }

  const info = shown.map((raw) => {
    // neighbours in one style are one segment, so a word and its space are measured and drawn together
    const l = { ...raw, frags: raw.frags.reduce<Frag[]>((out, f) => {
      const last = out.at(-1)
      if (last && !last.mark && !f.mark && last.node === f.node && last.fill === f.fill) out[out.length - 1] = { ...last, text: last.text + f.text, end: f.end }
      else out.push(f)
      return out
    }, []) }
    const nodes = l.frags.length ? l.frags.map((f) => f.node) : [l.base]
    const ms = nodes.map(metrics)
    const a = Math.max(...ms.map((m) => m.a)), d = Math.max(...ms.map((m) => m.d))
    const height = Math.max(...nodes.map(lineHeightOf))
    const natural = widthOf(l.frags), tail = l.frags.at(-1)
    const trimmed = l.trim && tail && !tail.mark ? natural - measure(tail.text.match(/ +$/)?.[0] ?? '', tail.node) : natural
    const own = l.frags.filter((f) => !f.mark)
    return { l, a, height, lo: own.length ? own[0].start : l.ps, hi: own.length ? own.at(-1)!.end : l.ps, natural, trimmed, baseline: (height - (a + d)) / 2 + a }
  })
  const width = auto ? Math.max(1, Math.ceil(Math.max(...info.map((i) => i.natural + i.l.indent)))) : n.width
  const content = info.reduce((h, i) => h + i.height, 0), height = n.textFixedHeight ? n.height : content
  let top = n.textAlignVertical === 'CENTER' ? Math.max(0, (height - content) / 2) : n.textAlignVertical === 'BOTTOM' ? Math.max(0, height - content) : 0
  const lines = info.map((i): TextLine => {
    const x = lineX(n, i.trimmed + i.l.indent, width) + i.l.indent
    let sx = x
    const segs = i.l.frags.map((f): Seg => {
      const w = measure(f.text, f.node), s = { text: f.text, style: f.node, ...(f.fill && { fill: f.fill }), x: sx, width: w, start: f.start, end: f.end, ...(f.mark && { mark: true }) }
      sx += w
      return s
    })
    const line = { segs, text: segs.map((s) => s.text).join(''), start: i.lo, end: i.hi, width: i.natural, x, y: top + i.baseline, top, height: i.height, ascent: i.a, indent: i.l.indent }
    top += i.height
    return line
  })
  return { lines, width, height }
}

/** A TEXT node's box follows its content: width when auto-width, height unless the user fixed it. */
export function fitText(n: Node): Node {
  const { width, height } = layoutText(n)
  // shortcut: x/y stay put, so a rotated text drifts slightly as its box grows; re-anchor the top-left corner if that matters.
  return width === n.width && height === n.height ? n : { ...n, width, height }
}

/** x offset of a line inside the box for the node's alignment. */
export const lineX = (n: Node, lineWidth: number, boxWidth: number) => (n.textAlign === 'CENTER' ? (boxWidth - lineWidth) / 2 : n.textAlign === 'RIGHT' ? boxWidth - lineWidth : 0)
