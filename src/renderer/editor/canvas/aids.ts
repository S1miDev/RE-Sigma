// Editor-only drawing aids on top of the page: pixel grid, layout grids, user guides and the rulers. Never exported.
import type { Color, Comment, Document, LayoutGrid, Node } from '../../../shared/document'
import { apply, worldBox, worldMatrix, type Pt } from '../model/geometry'
import { childrenOf } from '../model/ops'
import type { EditorState } from '../store'
import { toScreen, type View } from './viewport'

export const RULER = 20 // thickness of the ruler strips, px
const GUIDE = '#e5489b'
const PIXEL_GRID_ZOOM = 8 // the grid shows from this zoom on; below it the lines would be a haze
export type AidState = Pick<EditorState, 'doc' | 'pageId' | 'selection' | 'view' | 'overlay' | 'rulers' | 'pixelGrid' | 'guidesVisible' | 'layoutGridsVisible' | 'showResolved' | 'draft' | 'openComment'>

const rgba = (c: Color) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`

/** The smallest 1/2/5 × 10ⁿ step that keeps ruler ticks at least `minPx` apart on screen. */
export function tickStep(zoom: number, minPx = 60): number {
  const raw = minPx / zoom, pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
}

/** The index of the guide under screen point `p` (within 3 px), or -1. The ruler strips don't count. */
export function guideAt(s: Pick<AidState, 'doc' | 'pageId' | 'view' | 'rulers' | 'guidesVisible'>, p: Pt): number {
  if (!s.guidesVisible || (s.rulers && (p.x < RULER || p.y < RULER))) return -1
  const guides = s.doc.nodes[s.pageId]?.guides ?? []
  return guides.findIndex((g) => Math.abs((g.axis === 'x' ? p.x : p.y) - (g.pos * s.view.zoom + (g.axis === 'x' ? s.view.x : s.view.y))) <= 3)
}

/** Pins are drawn on screen at a fixed size; the tip of the pin sits on the comment's point. */
const PIN = 10
const visiblePins = (s: Pick<EditorState, 'doc' | 'pageId' | 'showResolved'>) => s.doc.comments.filter((c) => c.page === s.pageId && (s.showResolved || !c.resolved))

/** The comment whose pin is under screen point `p`, topmost (latest) first. */
export function pinAt(s: Pick<EditorState, 'doc' | 'pageId' | 'view' | 'showResolved'>, p: Pt): Comment | undefined {
  return visiblePins(s).reverse().find((c) => { const a = toScreen(s.view, c); return Math.hypot(p.x - a.x, p.y - (a.y - PIN)) <= PIN })
}

/** Comment pins and the draft pin: a filled circle above the point, dimmed when resolved. Editor-only. */
export function drawComments(ctx: CanvasRenderingContext2D, s: Pick<EditorState, 'doc' | 'pageId' | 'view' | 'showResolved' | 'draft' | 'openComment'>) {
  const pin = (pt: Pt, label: string, fill: string, ring: boolean) => {
    const a = toScreen(s.view, pt)
    ctx.beginPath(); ctx.arc(a.x, a.y - PIN, PIN, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill()
    ctx.lineWidth = ring ? 2 : 1; ctx.strokeStyle = ring ? '#fff' : 'rgba(0,0,0,0.3)'; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, a.x, a.y - PIN)
  }
  visiblePins(s).forEach((c, i) => pin(c, String(i + 1), c.resolved ? '#9ca3af' : '#f24822', c.id === s.openComment))
  if (s.draft && s.draft.page === s.pageId) pin(s.draft, '+', '#f24822', true)
}

function framesOf(doc: Document, pageId: string): Node[] {
  const out: Node[] = [], stack = [...childrenOf(doc, pageId)] // a copy: childrenOf's array is cached, popping it would empty the page
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (!n.visible) continue
    if (n.type === 'FRAME' && n.layoutGrids?.length) out.push(n)
    stack.push(...childrenOf(doc, n.id))
  }
  return out
}

/** One grid over a frame, in the frame's own coordinates, through its world matrix (so rotated frames work). */
function drawLayoutGrid(ctx: CanvasRenderingContext2D, doc: Document, n: Node, g: LayoutGrid, view: View) {
  const m = worldMatrix(doc, n.id), at = (x: number, y: number) => toScreen(view, apply(m, { x, y }))
  ctx.fillStyle = ctx.strokeStyle = rgba(g.color)
  const quad = (x: number, y: number, w: number, h: number) => {
    const q = [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)]
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill()
  }
  if (g.kind === 'GRID') {
    if (g.size * view.zoom < 4) return // too dense to be useful
    ctx.beginPath()
    for (let x = 0; x <= n.width; x += g.size) { const a = at(x, 0), b = at(x, n.height); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y) }
    for (let y = 0; y <= n.height; y += g.size) { const a = at(0, y), b = at(n.width, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y) }
    return void ctx.stroke()
  }
  const along = g.kind === 'COLUMNS' ? n.width : n.height, cell = (along - 2 * g.margin - g.gutter * (g.count - 1)) / g.count
  if (cell <= 0) return
  for (let i = 0; i < g.count; i++) {
    const start = g.margin + i * (cell + g.gutter)
    if (g.kind === 'COLUMNS') quad(start, 0, cell, n.height)
    else quad(0, start, n.width, cell)
  }
}

/** Pixel grid and layout grids; drawn first so the selection stays on top. */
export function drawGrids(ctx: CanvasRenderingContext2D, s: AidState, W: number, H: number) {
  const { view, doc } = s
  ctx.save()
  if (s.layoutGridsVisible) for (const n of framesOf(doc, s.pageId)) for (const g of n.layoutGrids!) drawLayoutGrid(ctx, doc, n, g, view)
  if (s.pixelGrid && view.zoom >= PIXEL_GRID_ZOOM) {
    ctx.strokeStyle = 'rgba(128,128,128,0.35)'
    ctx.beginPath()
    for (let x = Math.ceil(-view.x / view.zoom); x * view.zoom + view.x <= W; x++) { const sx = Math.round(x * view.zoom + view.x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H) }
    for (let y = Math.ceil(-view.y / view.zoom); y * view.zoom + view.y <= H; y++) { const sy = Math.round(y * view.zoom + view.y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy) }
    ctx.stroke()
  }
  ctx.restore()
}

export function drawGuides(ctx: CanvasRenderingContext2D, s: AidState, W: number, H: number) {
  if (!s.guidesVisible) return
  const { view } = s
  ctx.save()
  ctx.strokeStyle = GUIDE
  ctx.beginPath()
  for (const g of s.doc.nodes[s.pageId]?.guides ?? []) {
    if (g.axis === 'x') { const x = Math.round(g.pos * view.zoom + view.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    else { const y = Math.round(g.pos * view.zoom + view.y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y) }
  }
  ctx.stroke()
  const live = s.overlay.guide
  if (live) { // the position, next to the pointer's ruler
    ctx.fillStyle = GUIDE
    ctx.font = '11px "Inter Variable", sans-serif'
    if (live.axis === 'x') ctx.fillText(String(live.pos), live.pos * view.zoom + view.x + 6, RULER + 14)
    else ctx.fillText(String(live.pos), RULER + 6, live.pos * view.zoom + view.y - 6)
  }
  ctx.restore()
}

export function drawRulers(ctx: CanvasRenderingContext2D, s: AidState, W: number, H: number) {
  if (!s.rulers) return
  const { view } = s, step = tickStep(view.zoom)
  ctx.save()
  ctx.fillStyle = '#2c2c2c'
  ctx.fillRect(0, 0, W, RULER); ctx.fillRect(0, 0, RULER, H)
  const box = s.selection.length ? worldBox(s.doc, s.selection) : null
  if (box) { // the selection's extent
    ctx.fillStyle = 'rgba(13,153,255,0.35)'
    ctx.fillRect(box.x * view.zoom + view.x, 0, box.w * view.zoom, RULER)
    ctx.fillRect(0, box.y * view.zoom + view.y, RULER, box.h * view.zoom)
  }
  ctx.fillStyle = '#9a9a9a'; ctx.strokeStyle = '#6a6a6a'
  ctx.font = '10px "Inter Variable", sans-serif'; ctx.textBaseline = 'top'
  ctx.beginPath()
  const first = (off: number) => Math.floor(-off / view.zoom / step) * step
  for (let v = first(view.x); v * view.zoom + view.x <= W; v += step) {
    const x = Math.round(v * view.zoom + view.x) + 0.5
    ctx.moveTo(x, RULER - 7); ctx.lineTo(x, RULER)
    ctx.fillText(String(Math.round(v * 1e6) / 1e6), x + 3, 2)
  }
  for (let v = first(view.y); v * view.zoom + view.y <= H; v += step) {
    const y = Math.round(v * view.zoom + view.y) + 0.5
    ctx.moveTo(RULER - 7, y); ctx.lineTo(RULER, y)
    ctx.save(); ctx.translate(2, y - 3); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(String(Math.round(v * 1e6) / 1e6), 0, 0); ctx.restore()
  }
  ctx.stroke()
  ctx.restore()
}
