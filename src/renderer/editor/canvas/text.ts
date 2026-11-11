import type { Node } from '../../../shared/document'

/** CSS font shorthand. The bundled "Inter Variable" backs up a missing family. */
export const fontOf = (n: Node, scale = 1) => `${n.fontWeight ?? 400} ${(n.fontSize ?? 16) * scale}px "${(n.fontFamily ?? 'Inter').replace(/["\\]/g, '')}", "Inter Variable", sans-serif`
export const lineHeightOf = (n: Node) => n.lineHeight || Math.round((n.fontSize ?? 16) * 1.2)

let ctx: CanvasRenderingContext2D | null | undefined
function measure(text: string, n: Node): number {
  if (ctx === undefined) ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * ((n.fontSize ?? 16) * 0.55 + (n.letterSpacing ?? 0)) // no canvas (tests): rough estimate
  ctx.font = fontOf(n)
  ctx.letterSpacing = `${n.letterSpacing ?? 0}px`
  return ctx.measureText(text).width
}

export interface TextLayout { lines: { text: string; width: number }[]; lineHeight: number; width: number; height: number }

/** Lines of a TEXT node: one per paragraph when auto-width, otherwise wrapped greedily by word at the node's width. */
export function layoutText(n: Node): TextLayout {
  const lines: { text: string; width: number }[] = []
  for (const para of (n.characters ?? '').split('\n')) {
    if (n.textAutoWidth) { lines.push({ text: para, width: measure(para, n) }); continue }
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next, n) > n.width) { lines.push({ text: line, width: measure(line, n) }); line = word }
      else line = next
    }
    lines.push({ text: line, width: measure(line, n) })
  }
  const lineHeight = lineHeightOf(n)
  return { lines, lineHeight, width: n.textAutoWidth ? Math.max(1, Math.ceil(Math.max(...lines.map((l) => l.width)))) : n.width, height: lines.length * lineHeight }
}

/** A TEXT node's box follows its content: width when auto-width, height always. */
export function fitText(n: Node): Node {
  const { width, height } = layoutText(n)
  // shortcut: x/y stay put, so a rotated text drifts slightly as its box grows; re-anchor the top-left corner if that matters.
  return width === n.width && height === n.height ? n : { ...n, width, height }
}

/** x offset of a line inside the box for the node's alignment. */
export const lineX = (n: Node, lineWidth: number, boxWidth: number) => (n.textAlign === 'CENTER' ? (boxWidth - lineWidth) / 2 : n.textAlign === 'RIGHT' ? boxWidth - lineWidth : 0)
