// Selection outlines, handles, marquee and snap guides. Drawn in screen pixels on top of the page.
import type { Document } from '../../../shared/document'
import { apply, corners, worldMatrix, type Box, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { anchorsOf, type Anchor } from '../model/path'
import type { Guides } from './snap'
import { toScreen, type View } from './viewport'

const ACCENT = '#0d99ff'
const COMPONENT = '#9747ff' // components and instances are labelled purple, as in Figma
export interface Handle { kind: 'resize' | 'rotate'; hx: number; hy: number; at: Pt }

/** Handles of one selected node, in screen coordinates. Lines and text resize along their width only. */
export function handlesOf(doc: Document, id: string, view: View): Handle[] {
  const n = doc.nodes[id]
  if (!n || n.type === 'PAGE' || n.locked) return []
  const m = worldMatrix(doc, id), at = (x: number, y: number) => toScreen(view, apply(m, { x, y }))
  const widthOnly = n.type === 'LINE' || n.type === 'TEXT', out: Handle[] = []
  for (const hy of widthOnly ? [0] : [-1, 0, 1])
    for (const hx of [-1, 0, 1]) if (hx || hy) out.push({ kind: 'resize', hx, hy, at: at(((hx + 1) / 2) * n.width, ((hy + 1) / 2) * n.height) })
  if (n.type !== 'LINE') out.push({ kind: 'rotate', hx: 0, hy: -1, at: at(n.width / 2, -22 / view.zoom) })
  return out
}
export const handleAt = (handles: Handle[], p: Pt, radius = 7) => handles.find((h) => Math.hypot(h.at.x - p.x, h.at.y - p.y) <= radius)

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  s: {
    doc: Document; pageId: string; selection: string[]; view: View; overlay: { marquee?: Box; guides?: Guides }; tool: string
    pen: { id: string; anchors: Anchor[] } | null; vectorEdit: { id: string; sel: { s: number; i: number } | null } | null
  },
  dpr: number,
) {
  const { doc, view } = s, W = ctx.canvas.width / dpr, H = ctx.canvas.height / dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.lineWidth = 1

  ctx.font = '11px "Inter Variable", sans-serif'
  ctx.textBaseline = 'alphabetic'
  for (const n of childrenOf(doc, s.pageId)) {
    if (n.type !== 'FRAME' || !n.visible) continue
    const p = toScreen(view, corners(doc, n.id)[0])
    ctx.fillStyle = n.component || n.componentSet || n.instanceOf ? COMPONENT : s.selection.includes(n.id) ? ACCENT : '#8c8c8c'
    ctx.fillText(n.name, p.x, p.y - 6)
  }

  ctx.strokeStyle = ACCENT
  for (const id of s.selection) {
    if (!doc.nodes[id]) continue
    const pts = corners(doc, id).map((p) => toScreen(view, p))
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.stroke()
  }
  // points of the path being drawn or edited replace the resize handles
  // (the pen's points are in its parent's coordinates; an edited vector's in its own)
  const pen = s.pen && doc.nodes[s.pen.id], edited = s.vectorEdit && doc.nodes[s.vectorEdit.id]
  const points = pen ? { subs: [{ anchors: s.pen!.anchors, closed: false }], m: worldMatrix(doc, pen.parentId) }
    : edited ? { subs: anchorsOf(edited), m: worldMatrix(doc, edited.id) } : null
  if (points) {
    const at = (q: Pt) => toScreen(view, apply(points.m, q)), sel = s.vectorEdit?.sel
    points.subs.forEach((sub, si) => sub.anchors.forEach((a, i) => {
      const p = at(a)
      for (const h of [a.in, a.out]) if (h) {
        const q = at(h)
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
      ctx.fillStyle = sel?.s === si && sel.i === i ? ACCENT : '#fff'
      ctx.beginPath(); ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7); ctx.fill(); ctx.stroke()
    }))
  } else if (s.selection.length === 1 && s.tool === 'move') {
    const handles = handlesOf(doc, s.selection[0], view), rotate = handles.find((h) => h.kind === 'rotate')
    if (rotate) {
      const top = handles.find((h) => h.hx === 0 && h.hy === -1 && h.kind === 'resize') ?? rotate
      ctx.beginPath(); ctx.moveTo(top.at.x, top.at.y); ctx.lineTo(rotate.at.x, rotate.at.y); ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    for (const h of handles) {
      ctx.beginPath()
      if (h.kind === 'rotate') ctx.arc(h.at.x, h.at.y, 4.5, 0, Math.PI * 2)
      else ctx.rect(h.at.x - 3.5, h.at.y - 3.5, 7, 7)
      ctx.fill(); ctx.stroke()
    }
  }

  const { marquee, guides } = s.overlay
  if (marquee) {
    const a = toScreen(view, marquee)
    ctx.fillStyle = 'rgba(13, 153, 255, 0.12)'
    ctx.fillRect(a.x, a.y, marquee.w * view.zoom, marquee.h * view.zoom)
    ctx.strokeRect(a.x, a.y, marquee.w * view.zoom, marquee.h * view.zoom)
  }
  ctx.strokeStyle = '#ff3b6b'
  ctx.beginPath()
  if (guides?.x !== undefined) { const x = guides.x * view.zoom + view.x; ctx.moveTo(x, 0); ctx.lineTo(x, H) }
  if (guides?.y !== undefined) { const y = guides.y * view.zoom + view.y; ctx.moveTo(0, y); ctx.lineTo(W, y) }
  ctx.stroke()
}
