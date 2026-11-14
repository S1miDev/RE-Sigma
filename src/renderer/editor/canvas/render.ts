// Canvas 2D renderer for documents. Used for the editor canvas, PNG export and thumbnails.
import { BLEND_CSS, type Document, type DropShadow, type InnerShadow, type Node } from '../../../shared/document'
import { invert, worldBox, worldMatrix, localMatrix } from '../model/geometry'
import { childrenOf } from '../model/ops'
import { parsePath, vectorScale, type Anchor } from '../model/path'
import { arcPath, cornerPath } from '../model/shapes'
import { css } from './color'
import { fillGradient, paintGradient } from './gradient'
import { endMarks, grownBox, imageBox, hasPath, isMask, outlinedStroke, paintsOf, sidesPath, strokeGrow, strokeStyle } from './paintPlan'
import { fontOf, layoutText } from './text'
import { fitView, type View } from './viewport'

export type Images = (hash: string) => ImageBitmap | undefined
const EMPTY_PAGE = '#f5f5f5'

/** The node's outline in its own coordinates, grown outward by `grow`. */
function shapePath(ctx: CanvasRenderingContext2D | Path2D, n: Node, grow = 0) {
  const { w, h, r, radii, plain } = grownBox(n, grow)
  if ('beginPath' in ctx) ctx.beginPath()
  if (n.type === 'ELLIPSE' && n.arc) trace(ctx, arcPath(n.width, n.height, n.arc)) // shortcut: an arc ignores `grow` (stroke align, shadow spread)
  else if (n.type === 'ELLIPSE') ctx.ellipse(n.width / 2, n.height / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  else if (n.type === 'LINE') { ctx.moveTo(0, 0); ctx.lineTo(n.width, 0) }
  else if (plain) ctx.roundRect(-grow, -grow, w, h, r)
  else trace(ctx, cornerPath(w, h, radii, n.cornerSmoothing), -grow)
}

/** Adds path data (M L C Z) to a context or Path2D, shifted by `at` on both axes. */
function trace(ctx: CanvasRenderingContext2D | Path2D, d: string, at = 0) {
  for (const { anchors: a, closed } of parsePath(d)) {
    ctx.moveTo(a[0].x + at, a[0].y + at)
    const seg = (p: Anchor, q: Anchor) => {
      const c1 = p.out ?? p, c2 = q.in ?? q
      ctx.bezierCurveTo(c1.x + at, c1.y + at, c2.x + at, c2.y + at, q.x + at, q.y + at)
    }
    for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i])
    if (closed) { if (a.at(-1)!.out || a[0].in) seg(a.at(-1)!, a[0]); ctx.closePath() }
  }
}

/** A VECTOR's fill or outlined-stroke paths as one Path2D, scaled to the node's current size. */
function vectorPath(n: Node, which: 'fill' | 'stroke'): [Path2D, CanvasFillRule] {
  const v = n.vector!, out = new Path2D(), s = vectorScale(n), m = new DOMMatrix().scale(s.x, s.y)
  for (const p of v[which]) out.addPath(new Path2D(p.d), m)
  // shortcut: one fill rule for all of a node's paths (Figma's are almost always one path each), split per path if mixed rules show up.
  return [out, v[which][0]?.rule ?? 'nonzero']
}

/** `runFill`: let runs with their own colour use it (not for shadows, which are a silhouette). */
function drawText(ctx: CanvasRenderingContext2D, n: Node, mode: 'fill' | 'stroke', runFill = true) {
  ctx.textBaseline = 'alphabetic'
  for (const l of layoutText(n).lines)
    for (const s of l.segs) {
      ctx.font = fontOf(s.style)
      ctx.letterSpacing = `${s.style.letterSpacing ?? 0}px`
      const keep = ctx.fillStyle
      if (mode === 'fill') {
        if (runFill && s.fill) ctx.fillStyle = css(s.fill)
        ctx.fillText(s.text, s.x, l.y)
      } else ctx.strokeText(s.text, s.x, l.y)
      const size = s.style.fontSize ?? 16, thick = Math.max(1, size / 14), deco = s.style.textDecoration
      // canvas has no text-decoration: draw it as a bar around the baseline
      if (mode === 'fill' && deco && deco !== 'NONE' && !s.mark) ctx.fillRect(s.x, l.y + (deco === 'UNDERLINE' ? size * 0.12 : -size * 0.3) - thick / 2, s.width, thick)
      ctx.fillStyle = keep
    }
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
  if (n.type === 'TEXT') drawText(ctx, n, 'fill', false)
  else if (hasPath(n)) { ctx.fill(...vectorPath(n, 'fill')); ctx.fill(...vectorPath(n, 'stroke')) }
  else if (n.type === 'LINE') { shapePath(ctx, n); ctx.lineWidth = n.strokeWeight + s.spread * 2; ctx.stroke() }
  else { shapePath(ctx, n, s.spread); ctx.fill() }
  ctx.restore()
}

/** Clips to the node's outline (not text, which has no outline to clip with). */
function clipShape(ctx: CanvasRenderingContext2D, n: Node) {
  if (hasPath(n)) ctx.clip(...vectorPath(n, 'fill'))
  else { shapePath(ctx, n); ctx.clip() }
}

/** An inner shadow: the shadow of everything outside the shape, clipped to the shape. */
function drawInnerShadow(ctx: CanvasRenderingContext2D, n: Node, s: InnerShadow) {
  const t = ctx.getTransform(), scale = Math.hypot(t.a, t.b), OFF = 100_000, M = 10_000
  ctx.save()
  clipShape(ctx, n)
  const ring = new Path2D()
  ring.rect(-M, -M, n.width + 2 * M, n.height + 2 * M)
  if (hasPath(n)) ring.addPath(vectorPath(n, 'fill')[0])
  else shapePath(ring, n, -s.spread)
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e - OFF, t.f)
  ctx.shadowColor = css(s.color)
  ctx.shadowBlur = s.blur * scale
  ctx.shadowOffsetX = OFF + s.x * scale
  ctx.shadowOffsetY = s.y * scale
  ctx.fillStyle = '#000'
  ctx.fill(ring, 'evenodd') // shortcut: a vector's hole ignores spread, an arc too; upgrade by offsetting the path
  ctx.restore()
}

/** Background blur: re-draws what is already on the canvas, blurred, inside the node's outline. */
function drawBackdropBlur(ctx: CanvasRenderingContext2D, n: Node, radius: number) {
  const scale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b)
  ctx.save()
  clipShape(ctx, n)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.filter = `blur(${(radius / 2) * scale}px)`
  ctx.drawImage(ctx.canvas, 0, 0)
  ctx.restore()
}

/** Draws siblings bottom to top. A visible mask draws nothing itself and clips everything above it in the list. */
function drawChildren(ctx: CanvasRenderingContext2D, doc: Document, kids: Node[], images: Images, skipId?: string | null) {
  let clips = 0
  for (const k of kids) {
    if (!isMask(k)) { drawNode(ctx, doc, k, images, skipId); continue }
    if (!k.visible) continue // a hidden mask masks nothing
    ctx.save()
    clips++
    const m = localMatrix(k)
    ctx.transform(...m)
    if (hasPath(k)) ctx.clip(...vectorPath(k, 'fill'))
    else { shapePath(ctx, k); ctx.clip() }
    ctx.transform(...invert(m)) // back to the siblings' space; the clip stays
  }
  while (clips--) ctx.restore()
}

export function drawNode(ctx: CanvasRenderingContext2D, doc: Document, n: Node, images: Images, skipId?: string | null) {
  if (!n.visible || n.id === skipId) return
  ctx.save()
  ctx.transform(...localMatrix(n))
  const { fills, strokes, shadows, inner, layerBlur, bgBlur } = paintsOf(n)
  if (bgBlur) drawBackdropBlur(ctx, n, bgBlur)
  // shortcut: a layer blur replaces an ancestor's instead of adding to it, and a group's children are blurred one by one.
  if (layerBlur) ctx.filter = `blur(${(layerBlur / 2) * Math.hypot(ctx.getTransform().a, ctx.getTransform().b)}px)`
  // shortcut: opacity multiplies down the tree per node; overlapping children of a translucent parent show through each other.
  ctx.globalAlpha *= n.opacity
  ctx.globalCompositeOperation = BLEND_CSS[n.blendMode ?? 'NORMAL'] // shortcut: no isolated group layer, so a blended group's children blend one by one; upgrade with an offscreen canvas.
  const base = ctx.globalAlpha

  for (const s of shadows) drawShadow(ctx, n, s)
  for (const p of fills) {
    ctx.globalAlpha = base * (p.opacity ?? 1)
    if (p.type === 'SOLID') {
      ctx.fillStyle = css(p.color)
      if (n.type === 'TEXT') drawText(ctx, n, 'fill')
      else if (hasPath(n)) ctx.fill(...vectorPath(n, 'fill'))
      else { shapePath(ctx, n); ctx.fill() }
    } else if (p.type === 'GRADIENT') {
      if (n.type === 'TEXT') paintGradient(ctx, p, n.width, n.height, (style) => { ctx.fillStyle = style; drawText(ctx, n, 'fill') })
      else if (hasPath(n)) fillGradient(ctx, p, ...vectorPath(n, 'fill'), n.width, n.height)
      else { const path = new Path2D(); shapePath(path, n); fillGradient(ctx, p, path, 'nonzero', n.width, n.height) }
    } else {
      const img = images(p.hash)
      if (!img) continue
      const b = imageBox(p, n.width, n.height, img.width, img.height)
      ctx.save()
      if (hasPath(n)) ctx.clip(...vectorPath(n, 'fill'))
      else { shapePath(ctx, n); ctx.clip() }
      if (b.tile) {
        const pattern = ctx.createPattern(img, 'repeat')
        if (pattern) {
          pattern.setTransform(new DOMMatrix([b.w / img.width, 0, 0, b.h / img.height, b.x, b.y]))
          ctx.fillStyle = pattern
          ctx.fillRect(0, 0, n.width, n.height)
        }
      } else ctx.drawImage(img, b.x, b.y, b.w, b.h)
      ctx.restore()
    }
  }

  ctx.globalAlpha = base
  for (const s of inner) drawInnerShadow(ctx, n, s)
  const kids =n.type === 'BOOLEAN' ? [] : childrenOf(doc, n.id) // a boolean's children are its operands
  if (kids.length) {
    ctx.save()
    if (n.type === 'FRAME' && n.clipsContent) { shapePath(ctx, n); ctx.clip() }
    drawChildren(ctx, doc, kids, images, skipId)
    ctx.restore()
  }

  const outlined = outlinedStroke(n), look = strokeStyle(n), sides = sidesPath(n), marks = endMarks(n)
  for (const p of strokes) {
    ctx.globalAlpha = base * (p.opacity ?? 1)
    ctx.lineWidth = n.strokeWeight
    ctx.setLineDash(look.dash)
    ctx.lineCap = look.cap
    ctx.lineJoin = look.join
    if (p.type === 'GRADIENT' && outlined) { fillGradient(ctx, p, ...vectorPath(n, 'stroke'), n.width, n.height); continue }
    const draw = (style: string | CanvasGradient) => {
      ctx.strokeStyle = style
      if (n.type === 'TEXT') drawText(ctx, n, 'stroke')
      // shortcut: an imported outline ignores later stroke weight/align edits; only strokes added in Refig follow them (centred).
      else if (outlined) { ctx.fillStyle = style; ctx.fill(...vectorPath(n, 'stroke')) }
      else if (sides) { ctx.fillStyle = style; ctx.fill(new Path2D(sides)) }
      else {
        if (hasPath(n)) ctx.stroke(vectorPath(n, 'fill')[0])
        else { shapePath(ctx, n, strokeGrow(n)); ctx.stroke() }
        if (marks.length) {
          ctx.fillStyle = style
          for (const m of marks) { const q = new Path2D(); m.forEach(([x, y], i) => (i ? q.lineTo(x, y) : q.moveTo(x, y))); q.closePath(); ctx.fill(q) }
        }
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
  drawChildren(ctx, doc, childrenOf(doc, pageId), images, skipId)
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
