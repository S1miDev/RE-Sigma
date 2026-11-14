// Selection outlines, handles, marquee and snap guides. Drawn in screen pixels on top of the page.
import type { Document } from '../../../shared/document'
import { apply, corners, worldMatrix, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { anchorsOf } from '../model/path'
import type { EditorState, Mode } from '../store'
import { caretPos, selectionRects } from './caret'
import { imageBox } from './paintPlan'
import { layoutText } from './text'
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
/** The image being cropped: its four corners in screen coordinates (clockwise from the top left) and the paint, if the mode still holds. */
export function cropCorners(doc: Document, mode: Mode, view: View, image: (hash: string) => { width: number; height: number } | undefined) {
  if (mode.kind !== 'crop') return null
  const n = doc.nodes[mode.id], p = n?.fills[mode.paint], img = p?.type === 'IMAGE' ? image(p.hash) : undefined
  if (!n || p?.type !== 'IMAGE' || !img) return null
  const b = imageBox(p, n.width, n.height, img.width, img.height), m = worldMatrix(doc, n.id)
  return { paint: p, corners: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => toScreen(view, apply(m, { x, y }))) }
}
export const handleAt =(handles: Handle[], p: Pt, radius = 7) => handles.find((h) => Math.hypot(h.at.x - p.x, h.at.y - p.y) <= radius)

export function drawOverlay(ctx: CanvasRenderingContext2D, s: Pick<EditorState, 'doc' | 'pageId' | 'selection' | 'view' | 'overlay' | 'tool' | 'mode'>, dpr: number, image: (hash: string) => { width: number; height: number } | undefined = () => undefined) {
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
  const { mode } = s, n = 'id' in mode ? doc.nodes[mode.id] : undefined
  const points = !n ? null
    : mode.kind === 'pen' ? { subs: [{ anchors: mode.anchors, closed: false }], m: worldMatrix(doc, n.parentId) }
    : mode.kind === 'points' ? { subs: anchorsOf(n), m: worldMatrix(doc, n.id) } : null
  if (mode.kind === 'text' && n?.type === 'TEXT') {
    // selection boxes and the caret, laid out like the text itself
    const layout = layoutText(n, { editing: true }), m = worldMatrix(doc, n.id)
    const quad = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => toScreen(view, apply(m, { x: px, y: py })))
    ctx.fillStyle = 'rgba(13, 153, 255, 0.3)'
    for (const r of selectionRects(layout, Math.min(mode.anchor, mode.focus), Math.max(mode.anchor, mode.focus))) {
      const q = quad(r.x, r.y, r.w, r.h)
      ctx.beginPath(); q.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y))); ctx.closePath(); ctx.fill()
    }
    if (mode.anchor === mode.focus) {
      const c = caretPos(layout, mode.focus), q = quad(c.x, c.y, 0, c.h)
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 // shortcut: a solid caret, no blink
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[3].x, q[3].y); ctx.stroke()
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1
    }
  }
  const crop = cropCorners(doc, mode, view, image)
  if (crop) {
    // the whole image, outlined, with a handle on each corner to scale it
    ctx.beginPath()
    crop.corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath(); ctx.stroke()
    ctx.fillStyle = '#fff'
    for (const p of crop.corners) { ctx.beginPath(); ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7); ctx.fill(); ctx.stroke() }
  } else if (points) {
    const at =(q: Pt) => toScreen(view, apply(points.m, q)), sel = mode.kind === 'points' ? mode.sel : null
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
