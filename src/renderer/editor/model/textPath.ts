// Text → outlines: glyph shapes from the fonts, placed by the same layout the canvas and SVG use.
import type { Node } from '../../../shared/document'
import { decorationBar, layoutText } from '../canvas/text'
import { fmt as f } from './geometry'
import type { Font } from 'fontkit'

/** `fontFor` gives the font (already at the right weight) for a style, or undefined when it isn't available. */
export type FontFor = (style: Node) => Font | undefined

/** One path (`d`, nonzero rule, in the node's coordinates) with every glyph of `n`, or '' when nothing could be outlined. Missing fonts leave their text out. */
export function textToPath(n: Node, fontFor: FontFor): string {
  let d = ''
  for (const line of layoutText(n).lines) for (const seg of line.segs) {
    const font = fontFor(seg.style)
    if (!font || !seg.text) continue
    const size = seg.style.fontSize ?? 16, k = size / font.unitsPerEm, ls = seg.style.letterSpacing ?? 0
    const run = font.layout(seg.text)
    let pen = seg.x
    run.glyphs.forEach((g, i) => {
      const p = run.positions[i], ox = pen + p.xOffset * k, oy = line.y - p.yOffset * k
      const pt = (x: number, y: number) => `${f(ox + x * k)} ${f(oy - y * k)}`
      let cx = 0, cy = 0 // current point in font units, to raise quadratics to cubics
      for (const { command: c, args: a } of g.path.commands) {
        if (c === 'moveTo' || c === 'lineTo') { d += `${c === 'moveTo' ? 'M' : 'L'}${pt(a[0], a[1])}`; [cx, cy] = a }
        else if (c === 'bezierCurveTo') { d += `C${pt(a[0], a[1])} ${pt(a[2], a[3])} ${pt(a[4], a[5])}`; [cx, cy] = [a[4], a[5]] }
        else if (c === 'quadraticCurveTo') {
          d += `C${pt(cx + (2 / 3) * (a[0] - cx), cy + (2 / 3) * (a[1] - cy))} ${pt(a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3]))} ${pt(a[2], a[3])}`
          ;[cx, cy] = [a[2], a[3]]
        } else d += 'Z'
      }
      pen += p.xAdvance * k + ls
    })
    const bar = !seg.mark && decorationBar(seg.style, line.y)
    if (bar) d += `M${f(seg.x)} ${f(bar.y)}H${f(seg.x + seg.width)}V${f(bar.y + bar.h)}H${f(seg.x)}Z`
  }
  return d
}
