// Best-effort Figma .fig → Refig document. Unsupported layers and paints are counted, never fatal.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import type { Omitted } from '../../shared/api'
import { makeNode, type Color, type Document, type DropShadow, type Node, type NodeType, type Paint, type VectorPath } from '../../shared/document'
import { orderBetween } from '../../shared/order'
import { readCanvas } from './kiwi'
import { FormatError, safeUnzip, validateDocument } from './refig'

const FIG_ENTRIES = /^(canvas\.fig|meta\.json|thumbnail\.png|images\/([0-9a-f]{40})?)$/
// Components (SYMBOL) and sections are plain containers; instances are expanded from their component.
const TYPES: Record<string, NodeType> = { FRAME: 'FRAME', GROUP: 'GROUP', SECTION: 'FRAME', SYMBOL: 'FRAME', INSTANCE: 'FRAME', ROUNDED_RECTANGLE: 'RECTANGLE', RECTANGLE: 'RECTANGLE', ELLIPSE: 'ELLIPSE', LINE: 'LINE', TEXT: 'TEXT',
  // Figma stores ready-made outlines for these, so they all become plain paths (a boolean's operands are baked in).
  VECTOR: 'VECTOR', STAR: 'VECTOR', REGULAR_POLYGON: 'VECTOR', BOOLEAN_OPERATION: 'VECTOR' }
const PATH_ARGS = [0, 2, 2, 4, 6] // floats after each command byte: close, move, line, quad, cubic
const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }

const key = (g: any) => `${g.sessionID}:${g.localID}`
const clamp = (v: unknown, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? v : lo))
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

export function importFig(bytes: Uint8Array): { document: Document; images: Record<string, Uint8Array>; thumbnail?: Uint8Array; omitted: Omitted } {
  let canvas = bytes, files: Record<string, Uint8Array> = {}
  if (Buffer.from(bytes.subarray(0, 8)).toString('latin1') !== 'fig-kiwi') {
    files = safeUnzip(bytes, FIG_ENTRIES)
    if (!files['canvas.fig']) throw new FormatError('Not a Figma file (no canvas.fig inside)')
    canvas = files['canvas.fig']
  }
  let changes: any[], blobs: any[]
  try {
    const { message } = readCanvas(canvas)
    changes = message.nodeChanges ?? []
    blobs = message.blobs ?? []
  } catch (e) {
    throw new FormatError(`Can't read this Figma file: ${e instanceof Error ? e.message : e}`)
  }

  const kids = new Map<string, any[]>()
  for (const c of changes) {
    if (!c.guid || !c.parentIndex?.guid) continue
    const p = key(c.parentIndex.guid)
    kids.set(p, [...(kids.get(p) ?? []), c])
  }
  const childrenOf = (c: any): any[] =>
    (kids.get(key(c.guid)) ?? []).sort((a, b) => (a.parentIndex.position < b.parentIndex.position ? -1 : a.parentIndex.position > b.parentIndex.position ? 1 : 0))

  const byGuid = new Map(changes.filter((c) => c.guid).map((c) => [key(c.guid), c]))
  const expanding = new Set<string>() // components being expanded, so an instance inside its own component can't recurse forever
  const omitted: Omitted = {}
  const omit = (what: string) => (omitted[what] = (omitted[what] ?? 0) + 1)
  const images: Record<string, Uint8Array> = {} // sha256 → bytes
  const nodes: Record<string, Node> = {}

  const color = (c: any, opacity: unknown = 1): Color => ({ r: clamp(c?.r), g: clamp(c?.g), b: clamp(c?.b), a: clamp(c?.a ?? 1) * clamp(opacity ?? 1) })
  const paints = (list: any[] | undefined): Paint[] =>
    (list ?? []).flatMap((p): Paint[] => {
      const visible = p.visible !== false
      if (p.type === 'SOLID') return [{ type: 'SOLID', visible, color: color(p.color, p.opacity) }]
      const data = p.type === 'IMAGE' && p.image?.hash && files[`images/${hex(p.image.hash)}`]
      if (!data) return omit(`${p.type} paint`), []
      const hash = createHash('sha256').update(data).digest('hex')
      images[hash] = data
      return [{ type: 'IMAGE', visible, hash }]
    })
  const shadows = (list: any[] | undefined): DropShadow[] =>
    (list ?? []).flatMap((e): DropShadow[] =>
      e.type === 'DROP_SHADOW'
        ? [{ visible: e.visible !== false, x: n0(e.offset?.x), y: n0(e.offset?.y), blur: Math.max(0, n0(e.radius)), spread: n0(e.spread), color: color(e.color) }]
        : (omit(`${e.type} effect`), []),
    )

  /** Figma geometry blob → SVG path data. Stops at the first unknown command or truncated argument. */
  const geometry = (list: any[] | undefined): VectorPath[] =>
    (list ?? []).flatMap((g): VectorPath[] => {
      const b = blobs[g?.commandsBlob]?.bytes
      if (!(b instanceof Uint8Array)) return []
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
      let d = ''
      for (let i = 0; i < b.length; ) {
        const cmd = b[i++], argc = PATH_ARGS[cmd]
        if (argc === undefined || i + argc * 4 > b.length) break
        const args = Array.from({ length: argc }, (_, k) => Math.round(n0(view.getFloat32(i + k * 4, true)) * 1000) / 1000)
        i += argc * 4
        d += 'ZMLQC'[cmd] + args.join(' ')
      }
      return d ? [{ d, rule: g.windingRule === 'ODD' ? 'evenodd' : 'nonzero' }] : []
    })

  function omitTree(c: any) {
    omit(String(c.type))
    childrenOf(c).forEach(omitTree)
  }

  function convert(c: any, parentId: string, order: string) {
    const type = c.type === 'FRAME' && c.resizeToFit ? 'GROUP' : TYPES[c.type]
    if (!type) return omitTree(c)
    const w = Math.max(0, n0(c.size?.x)), h = Math.max(0, n0(c.size?.y)), t = c.transform ?? {}
    const m00 = t.m00 ?? 1, m01 = n0(t.m01), m10 = n0(t.m10), m11 = t.m11 ?? 1
    const node = makeNode(type, {
      name: String(c.name ?? type).slice(0, 1000),
      parentId, order,
      visible: c.visible !== false,
      locked: c.locked === true,
      // Figma stores a 2×3 matrix for the top-left corner; Refig stores the unrotated box + rotation about its centre.
      x: n0(t.m02) + (m00 * w) / 2 + (m01 * h) / 2 - w / 2,
      y: n0(t.m12) + (m10 * w) / 2 + (m11 * h) / 2 - h / 2,
      width: w, height: h,
      rotation: (Math.atan2(m10, m00) * 180) / Math.PI,
      opacity: clamp(c.opacity ?? 1),
      fills: type === 'GROUP' ? [] : paints(c.fillPaints),
      strokes: type === 'GROUP' ? [] : paints(c.strokePaints),
      strokeWeight: Math.max(0, n0(c.strokeWeight)),
      strokeAlign: ['INSIDE', 'CENTER', 'OUTSIDE'].includes(c.strokeAlign) ? c.strokeAlign : 'CENTER',
      effects: shadows(c.effects),
      cornerRadius: Math.max(0, n0(c.cornerRadius ?? c.rectangleTopLeftCornerRadius)),
      clipsContent: type === 'FRAME' && !c.frameMaskDisabled,
    })
    if (type === 'TEXT') {
      const size = clamp(c.fontSize ?? 12, 0.1, 10_000)
      const units = (v: any, auto: number) => (!v ? auto : v.units === 'PIXELS' ? n0(v.value) : v.units === 'RAW' ? n0(v.value) * size : (n0(v.value) / 100) * size)
      Object.assign(node, {
        characters: String(c.textData?.characters ?? '').slice(0, 100_000),
        fontFamily: String(c.fontName?.family ?? 'Inter').slice(0, 100),
        fontWeight: WEIGHTS[String(c.fontName?.style ?? '').toLowerCase().replace(/[\s-]|italic/g, '')] ?? 400,
        fontSize: size,
        // Figma's "Auto" line height is stored as 100 %.
        lineHeight: c.lineHeight?.units === 'PERCENT' && c.lineHeight.value === 100 ? 0 : Math.max(0, units(c.lineHeight, 0)),
        letterSpacing: units(c.letterSpacing, 0),
        textAlign: ['CENTER', 'RIGHT'].includes(c.textAlignHorizontal) ? c.textAlignHorizontal : 'LEFT',
        textAutoWidth: c.textAutoResize === 'WIDTH_AND_HEIGHT',
      })
    }
    if (type === 'VECTOR') node.vector = { w, h, fill: geometry(c.fillGeometry), stroke: geometry(c.strokeGeometry) }
    nodes[node.id] = node
    if (type === 'VECTOR') return // a boolean's operands are already merged into its geometry
    if (type === 'FRAME' || type === 'GROUP') {
      // An instance stores no children of its own: draw its component's. Overrides aren't applied.
      const symbol = c.type === 'INSTANCE' && c.symbolData?.symbolID ? key(c.symbolData.symbolID) : null
      if (c.symbolData?.symbolOverrides?.length) omit('INSTANCE override')
      if (!symbol) convertChildren(c, node.id)
      else if (byGuid.has(symbol) && !expanding.has(symbol)) {
        expanding.add(symbol)
        convertChildren(byGuid.get(symbol), node.id)
        expanding.delete(symbol)
      }
    } else childrenOf(c).forEach(omitTree)
  }
  // Figma's position strings can end in the lowest character, so fresh keys are generated instead of reusing them.
  function convertChildren(c: any, parentId: string) {
    let order = ''
    for (const child of childrenOf(c)) convert(child, parentId, (order = orderBetween(order)))
  }

  const doc = changes.find((c) => c.type === 'DOCUMENT')
  if (!doc) throw new FormatError("Can't read this Figma file: no document node")
  const pages: string[] = []
  for (const c of childrenOf(doc)) {
    if (c.type !== 'CANVAS') { omitTree(c); continue }
    if (c.internalOnly) continue // Figma's hidden "Internal Only Canvas" (styles, variables)
    const page = makeNode('PAGE', {
      name: String(c.name ?? 'Page').slice(0, 1000),
      fills: [{ type: 'SOLID', visible: c.backgroundEnabled !== false, color: color(c.backgroundColor ?? { r: 0.118, g: 0.118, b: 0.118 }) }],
    })
    nodes[page.id] = page
    pages.push(page.id)
    convertChildren(c, page.id)
  }
  if (!pages.length) throw new FormatError("Can't read this Figma file: it has no pages")
  return { document: validateDocument({ formatVersion: 1, pages, nodes }), images, thumbnail: files['thumbnail.png'], omitted }
}
