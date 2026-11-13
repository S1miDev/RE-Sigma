// Canvas 2D renderer for documents. Used for the editor canvas, PNG export and thumbnails.
import type { Document, DropShadow, Node } from '../../../shared/document'
import { worldBox, worldMatrix, localMatrix } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { vectorScale } from '../model/path'
import { css } from './color'
import { fillGradient, paintGradient } from './gradient'
import { grownBox, outlinedStroke, paintsOf, strokeGrow } from './paintPlan'
import { fontOf, layoutText, lineX } from './text'
import { fitView, type View } from './viewport'

export type Images = (hash: string) => ImageBitmap | undefined
const EMPTY_PAGE = '#f5f5f5'

/** The node's outline in its own coordinates, grown outward by `grow`. */
function shapePath(ctx: CanvasRenderingContext2D | Path2D, n: Node, grow = 0) {
  const { w, h, r } = grownBox(n, grow)
  if ('beginPath' in ctx) ctx.beginPath()
  if (n.type === 'ELLIPSE') ctx.ellipse(n.width / 2, n.height / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (n.type === 'LINE') { ctx.moveTo(0, 0); ctx.lineTo(n.width, 0) }
  else ctx.roundRect(-grow, -grow, w, h, r)
}

/** A VECTOR's fill or outlined-stroke paths as one Path2D, scaled to the node's current size. */
function vectorPath(n: Node, which: 'fill' | 'stroke'): [Path2D, CanvasFillRule] {
  const v = n.vector!, out = new Path2D(), s = vectorScale(n), m = new DOMMatrix().scale(s.x, s.y)
  for (const p of v[which]) out.addPath(new Path2D(p.d), m)
  // shortcut: one fill rule for all of a node's paths (Figma's are almost always one path each), split per path if mixed rules show up.
  return [out, v[which][0]?.rule ?? 'nonzero']
}

function drawText(ctx: CanvasRenderingContext2D, n: Node, mode: 'fill' | 'stroke') {
  const layout = layoutText(n)
  ctx.font = fontOf(n)
  ctx.letterSpacing = `${n.letterSpacing ?? 0}px`
  ctx.textBaseline = 'middle'
  layout.lines.forEach((l, i) => {
    const x = lineX(n, l.width, n.width), y = i * layout.lineHeight + layout.lineHeight / 2
    if (mode === 'fill') ctx.fillText(l.text, x, y)
    else ctx.strokeText(l.text, x, y)
  })
}

function drawShadow(ctx: CanvasRenderingContext2D, n: Node, s: DropShadow) {
  // Draw the shape far off-canvas and let only its shadow land in place, so the shadow isn't hidden under or mixed with the fill.
  const t = ctx.getTransform(), scale = Math.hypot(t.a, t.b), OFF = 100_000
  ctx.save()
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e - OFF, t.f)
  ctx.shadowColor = css(s.color)
  ctx.shadowBlur = s.blur * scale
  ctx.shadowOffsetX = OFF + s.x * scale
  ctx.shadowOffsetY = s.y * scale
  ctx.fillStyle = ctx.strokeStyle = '#000'
  if (n.type === 'TEXT') drawText(ctx, n, 'fill')
  else if (n.type === 'VECTOR') { ctx.fill(...vectorPath(n, 'fill')); ctx.fill(...vectorPath(n, 'stroke')) }
  else if (n.type === 'LINE') { shapePath(ctx, n); ctx.lineWidth = n.strokeWeight + s.spread * 2; ctx.stroke() }
  else { shapePath(ctx, n, s.spread); ctx.fill() }
  ctx.restore()
}

export function drawNode(ctx: CanvasRenderingContext2D, doc: Document, n: Node, images: Images, skipId?: string | null) {
  if (!n.visible || n.id === skipId) return
  ctx.save()
  ctx.transform(...localMatrix(n))
  // shortcut: opacity multiplies down the tree per node; overlapping children of a translucent parent show through each other.
  ctx.globalAlpha *= n.opacity
  const { fills, strokes, shadows } = paintsOf(n)

  for (const s of shadows) drawShadow(ctx, n, s)
  for (const p of fills) {
    if (p.type === 'SOLID') {
      ctx.fillStyle = css(p.color)
      if (n.type === 'TEXT') drawText(ctx, n, 'fill')
      else if (n.type === 'VECTOR') ctx.fill(...vectorPath(n, 'fill'))
      else { shapePath(ctx, n); ctx.fill() }
    } else if (p.type === 'GRADIENT') {
      if (n.type === 'TEXT') paintGradient(ctx, p, n.width, n.height, (style) => { ctx.fillStyle = style; drawText(ctx, n, 'fill') })
      else if (n.type === 'VECTOR') fillGradient(ctx, p, ...vectorPath(n, 'fill'), n.width, n.height)
      else { const path = new Path2D(); shapePath(path, n); fillGradient(ctx, p, path, 'nonzero', n.width, n.height) }
    } else {
      const img = images(p.hash)
      if (!img) continue
      const k = Math.max(n.width / img.width, n.height / img.height) // cover
      ctx.save()
      if (n.type === 'VECTOR') ctx.clip(...vectorPath(n, 'fill'))
      else { shapePath(ctx, n); ctx.clip() }
      ctx.drawImage(img, (n.width - img.width * k) / 2, (n.height - img.height * k) / 2, img.width * k, img.height * k)
      ctx.restore()
    }
  }

  const kids = childrenOf(doc, n.id)
  if (kids.length) {
    ctx.save()
    if (n.type === 'FRAME' && n.clipsContent) { shapePath(ctx, n); ctx.clip() }
    for (const k of kids) drawNode(ctx, doc, k, images, skipId)
    ctx.restore()
  }

  const outlined = outlinedStroke(n)
  for (const p of strokes) {
    ctx.lineWidth = n.strokeWeight
    if (p.type === 'GRADIENT' && outlined) { fillGradient(ctx, p, ...vectorPath(n, 'stroke'), n.width, n.height); continue }
    const draw = (style: string | CanvasGradient) => {
      ctx.strokeStyle = style
      if (n.type === 'TEXT') drawText(ctx, n, 'stroke')
      // shortcut: an imported outline ignores later stroke weight/align edits; only strokes added in Refig follow them (centred).
      else if (outlined) { ctx.fillStyle = style; ctx.fill(...vectorPath(n, 'stroke')) }
      else if (n.type === 'VECTOR') ctx.stroke(vectorPath(n, 'fill')[0])
      else {
        shapePath(ctx, n, strokeGrow(n))
        ctx.stroke()
      }
    }
    if (p.type === 'SOLID') draw(css(p.color))
    else paintGradient(ctx, p, n.width, n.height, draw)
  }
  ctx.restore()
}

export function pageColor(doc: Document, pageId: string): string {
  const fill = doc.nodes[pageId]?.fills[0]
  return fill?.type === 'SOLID' && fill.visible ? css({ ...fill.color, a: 1 }) : EMPTY_PAGE
}

/** Draws a page through a view. `dpr` is the device pixel ratio of the target canvas. */
export function renderPage(ctx: CanvasRenderingContext2D, doc: Document, pageId: string, view: View, dpr: number, images: Images, skipId?: string | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pageColor(doc, pageId)
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y)
  for (const n of childrenOf(doc, pageId)) drawNode(ctx, doc, n, images, skipId)
}

/** Renders nodes (with their place on the page) to a new canvas cropped to their bounding box. For PNG export. */
export function renderToCanvas(doc: Document, ids: string[], scale: number, images: Images): HTMLCanvasElement | null {
  const box = worldBox(doc, ids), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  if (!box || !ctx) return null
  const k = Math.min(scale, 16_384 / Math.max(box.w, box.h, 1)) // stay inside the browser's canvas size limit
  canvas.width = Math.max(1, Math.ceil(box.w * k))
  canvas.height = Math.max(1, Math.ceil(box.h * k))
  ctx.scale(k, k)
  ctx.translate(-box.x, -box.y)
  for (const id of ids) {
    ctx.save()
    ctx.transform(...worldMatrix(doc, doc.nodes[id].parentId))
    drawNode(ctx, doc, doc.nodes[id], images)
    ctx.restore()
  }
  return canvas
}

/** PNG bytes of a ≤ 400×300 preview of a page, or undefined where there is no canvas (tests). */
export function thumbnail(doc: Document, pageId: string, images: Images): Uint8Array | undefined {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  canvas.width = 400
  canvas.height = 300
  const size = { w: canvas.width, h: canvas.height }
  renderPage(ctx, doc, pageId, fitView(worldBox(doc, childrenOf(doc, pageId).map((n) => n.id)), size, 16), 1, images)
  return Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (c) => c.charCodeAt(0))
}
