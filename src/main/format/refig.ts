// .refig = ZIP { meta.json, document.json, thumbnail.png?, images/<sha256> }. See docs/project-format.md.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import {
  BLEND_MODES, BOOL_OPS, CONSTRAINTS, FILL_RULES, FORMAT_VERSION, GRADIENT_KINDS, IMAGE_MODES, isContainer, LAYOUT_ALIGNS, LAYOUT_MODES, NODE_TYPES, OVERRIDABLE, STROKE_ALIGNS, STROKE_CAPS, STROKE_ENDS, STROKE_JOINS, STYLE_KINDS, TEXT_ALIGNS, TEXT_CASES, TEXT_DECORATIONS, TEXT_LISTS, TEXT_VALIGNS,
  type AutoLayout, type Color, type Document, type Effect, type Node, type Paint, type RunStyle, type Style, type TextStyleValue, type VectorPath,
} from '../../shared/document'

export interface Meta {
  format: 'refig'
  formatVersion: number
  id: string
  name: string
  createdAt: string
  modifiedAt: string
  appVersion: string
}
export interface RefigFile {
  meta: Meta
  document: Document
  thumbnail?: Uint8Array
  images: Record<string, Uint8Array>
}

/** A problem with a file's content; the message is shown to the user. */
export class FormatError extends Error {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NODE_ID = /^[A-Za-z0-9:-]{1,64}$/ // no '_' so '__proto__' can never be a key
const HASH = /^[0-9a-f]{64}$/
const REFIG_ENTRIES = /^(meta\.json|document\.json|thumbnail\.png|images\/([0-9a-f]{64})?)$/
const MAX_UNZIPPED = 1024 ** 3
const MAX_ENTRIES = 10_000

/** Unzip with an entry allow-list and size caps. `only` skips entries without unpacking them. */
export function safeUnzip(bytes: Uint8Array, allow: RegExp, only?: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0, count = 0
  try {
    return unzipSync(bytes, {
      filter(f) {
        if (++count > MAX_ENTRIES) throw new FormatError('Archive has too many entries')
        if (!allow.test(f.name)) throw new FormatError(`Unexpected entry in archive: ${f.name.slice(0, 80)}`)
        if (f.name.endsWith('/') || (only && !only(f.name))) return false
        if ((total += f.originalSize) > MAX_UNZIPPED) throw new FormatError('Archive is too large when unpacked')
        return true
      },
    })
  } catch (e) {
    throw e instanceof FormatError ? e : new FormatError('File is damaged or not a valid archive')
  }
}

type Obj = Record<string, unknown>
const fail = (what: string): never => {
  throw new FormatError(`Invalid document: ${what}`)
}
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (o: Obj, k: string, at: string, min = -1e9, max = 1e9) => {
  const v = o[k]
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${at}.${k}`)
}
const str = (o: Obj, k: string, at: string, max = 1000) => {
  const v = o[k]
  return typeof v === 'string' && v.length <= max ? v : fail(`${at}.${k}`)
}
const bool = (o: Obj, k: string, at: string) => {
  const v = o[k]
  return typeof v === 'boolean' ? v : fail(`${at}.${k}`)
}
const oneOf = <T extends string>(o: Obj, k: string, at: string, list: readonly T[]) => {
  const v = o[k]
  return list.includes(v as T) ? (v as T) : fail(`${at}.${k}`)
}
const list = (x: unknown, at: string): Obj[] => (Array.isArray(x) && x.length <= 32 && x.every(isObj) ? x : fail(at))
const color = (x: unknown, at: string): Color =>
  isObj(x) ? { r: num(x, 'r', at, 0, 1), g: num(x, 'g', at, 0, 1), b: num(x, 'b', at, 0, 1), a: num(x, 'a', at, 0, 1) } : fail(at)
const paints = (x: unknown, at: string): Paint[] =>
  list(x, at).map((p): Paint => {
    const visible = bool(p, 'visible', at), op = p.opacity === undefined ? {} : { opacity: num(p, 'opacity', at, 0, 1) }
    if (p.type === 'SOLID') return { type: 'SOLID', visible, color: color(p.color, `${at}.color`), ...op }
    if (p.type === 'IMAGE' && typeof p.hash === 'string' && HASH.test(p.hash)) {
      const opt = (k: 'scale' | 'offsetX' | 'offsetY', lo: number, hi: number) => (p[k] === undefined ? {} : { [k]: num(p, k, at, lo, hi) })
      return {
        type: 'IMAGE', visible, hash: p.hash, ...op,
        ...(p.scaleMode !== undefined && { scaleMode: oneOf(p, 'scaleMode', at, IMAGE_MODES) }),
        ...opt('scale', 0.01, 100), ...opt('offsetX', -1e6, 1e6), ...opt('offsetY', -1e6, 1e6),
      }
    }
    if (p.type === 'GRADIENT') {
      const pt = (x: unknown, w: string) => (isObj(x) ? { x: num(x, 'x', w), y: num(x, 'y', w) } : fail(w))
      const stops = list(p.stops, `${at}.stops`)
      if (stops.length < 2) fail(`${at}.stops`)
      return {
        type: 'GRADIENT', visible, ...op, kind: oneOf(p, 'kind', at, GRADIENT_KINDS), from: pt(p.from, `${at}.from`), to: pt(p.to, `${at}.to`),
        ...(p.w !== undefined && { w: pt(p.w, `${at}.w`) }),
        stops: stops.map((s) => ({ pos: num(s, 'pos', `${at}.stops`, 0, 1), color: color(s.color, `${at}.stops.color`) })),
      }
    }
    return fail(at)
  })
const EFFECT_TYPES = ['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR'] as const
const effects = (x: unknown, at: string): Effect[] =>
  list(x, at).map((s): Effect => {
    const visible = bool(s, 'visible', at), blur = num(s, 'blur', at, 0)
    if (s.type === 'LAYER_BLUR' || s.type === 'BACKGROUND_BLUR') return { type: s.type, visible, blur }
    // no type = a drop shadow (files before version 7)
    const type = s.type === undefined ? 'DROP_SHADOW' : oneOf(s, 'type', at, EFFECT_TYPES)
    const shadow = { visible, x: num(s, 'x', at), y: num(s, 'y', at), blur, spread: num(s, 'spread', at), color: color(s.color, `${at}.color`) }
    return type === 'INNER_SHADOW' ? { type, ...shadow } : s.type === undefined ? shadow : { type: 'DROP_SHADOW', ...shadow }
  })

/** False for anything but a positive integer; a version newer than this app's throws, with a message for the user. */
function knownVersion(v: unknown): boolean {
  if (!Number.isInteger(v) || (v as number) < 1) return false
  if ((v as number) > FORMAT_VERSION) throw new FormatError('This project was made by a newer version of Refig')
  return true
}

// Path data ends up inside SVG attributes on export, so only path commands and numbers are allowed.
const PATH_DATA = /^[MLQCZ0-9eE.+\- ]*$/
const vectorPaths = (x: unknown, at: string): VectorPath[] =>
  list(x, at).map((p, i) => ({ d: PATH_DATA.test(str(p, 'd', `${at}.${i}`, 5_000_000)) ? (p.d as string) : fail(`${at}.${i}.d`), rule: oneOf(p, 'rule', `${at}.${i}`, FILL_RULES) }))

function validateNode(id: string, n: unknown): Node {
  const at = `nodes.${id}`
  if (!NODE_ID.test(id) || !isObj(n) || n.id !== id) return fail(at)
  const type = oneOf(n, 'type', at, NODE_TYPES)
  const node: Node = {
    id, type,
    name: str(n, 'name', at),
    parentId: n.parentId === null ? null : str(n, 'parentId', at, 64),
    order: str(n, 'order', at) || fail(`${at}.order`),
    visible: bool(n, 'visible', at),
    locked: bool(n, 'locked', at),
    x: num(n, 'x', at), y: num(n, 'y', at),
    width: num(n, 'width', at, 0), height: num(n, 'height', at, 0),
    rotation: num(n, 'rotation', at),
    opacity: num(n, 'opacity', at, 0, 1),
    fills: paints(n.fills, `${at}.fills`),
    strokes: paints(n.strokes, `${at}.strokes`),
    strokeWeight: num(n, 'strokeWeight', at, 0),
    ...(n.blendMode !== undefined && { blendMode: oneOf(n, 'blendMode', at, BLEND_MODES) }),
    strokeAlign: oneOf(n, 'strokeAlign', at, STROKE_ALIGNS),
    effects: effects(n.effects, `${at}.effects`),
    cornerRadius: num(n, 'cornerRadius', at, 0),
    clipsContent: bool(n, 'clipsContent', at),
  }
  if (n.strokeDash !== undefined) {
    const d = Array.isArray(n.strokeDash) && n.strokeDash.length <= 8 ? { ...n.strokeDash } : fail(`${at}.strokeDash`)
    node.strokeDash = Object.keys(d).map((i) => num(d, i, `${at}.strokeDash`, 0, 1e6))
  }
  if (n.strokeCap !== undefined) node.strokeCap = oneOf(n, 'strokeCap', at, STROKE_CAPS)
  if (n.strokeJoin !== undefined) node.strokeJoin = oneOf(n, 'strokeJoin', at, STROKE_JOINS)
  if (n.strokeStart !== undefined) node.strokeStart = oneOf(n, 'strokeStart', at, STROKE_ENDS)
  if (n.strokeEnd !== undefined) node.strokeEnd = oneOf(n, 'strokeEnd', at, STROKE_ENDS)
  if ((type === 'RECTANGLE' || type === 'FRAME') && n.strokeSides !== undefined) {
    const s = Array.isArray(n.strokeSides) && n.strokeSides.length === 4 ? { ...n.strokeSides } : fail(`${at}.strokeSides`)
    node.strokeSides = [0, 1, 2, 3].map((i) => num(s, String(i), `${at}.strokeSides`, 0)) as NonNullable<Node['strokeSides']>
  }
  if (n.constraints !== undefined) {
    const c = isObj(n.constraints) ? n.constraints : fail(`${at}.constraints`)
    node.constraints = { h: oneOf(c, 'h', `${at}.constraints`, CONSTRAINTS), v: oneOf(c, 'v', `${at}.constraints`, CONSTRAINTS) }
  }
  if (type === 'FRAME' && n.componentSet !== undefined) node.componentSet = bool(n, 'componentSet', at)
  if (type === 'FRAME' && n.component !== undefined) node.component = bool(n, 'component', at)
  if (type === 'FRAME' && n.instanceOf !== undefined) node.instanceOf = str(n, 'instanceOf', at, 64)
  if (n.ref !== undefined) node.ref = str(n, 'ref', at, 64)
  if (n.overrides !== undefined)
    node.overrides = Array.isArray(n.overrides) && n.overrides.every((k) => OVERRIDABLE.includes(k)) ? [...new Set(n.overrides as string[])] : fail(`${at}.overrides`)
  for (const k of ['fillStyle', 'strokeStyle', 'effectStyle', 'textStyle'] as const) if (n[k] !== undefined) node[k] = str(n, k, at, 64)
  if (n.fillW !== undefined) node.fillW = bool(n, 'fillW', at)
  if (n.fillH !== undefined) node.fillH = bool(n, 'fillH', at)
  if (type === 'FRAME' && n.layout !== undefined) {
    const l = isObj(n.layout) ? n.layout : fail(`${at}.layout`), la = `${at}.layout`
    const p: Obj = Array.isArray(l.padding) && l.padding.length === 4 ? { ...l.padding } : fail(`${la}.padding`)
    node.layout = {
      mode: oneOf(l, 'mode', la, LAYOUT_MODES), gap: num(l, 'gap', la, 0), align: oneOf(l, 'align', la, LAYOUT_ALIGNS),
      padding: [0, 1, 2, 3].map((i) => num(p, String(i), `${la}.padding`, 0)) as AutoLayout['padding'],
      hugW: bool(l, 'hugW', la), hugH: bool(l, 'hugH', la),
    }
  }
  if (type === 'TEXT')
    Object.assign(node, {
      characters: str(n, 'characters', at, 100_000),
      fontFamily: str(n, 'fontFamily', at, 100),
      fontWeight: num(n, 'fontWeight', at, 1, 1000),
      fontSize: num(n, 'fontSize', at, 0.1, 10_000),
      lineHeight: num(n, 'lineHeight', at, 0),
      letterSpacing: num(n, 'letterSpacing', at),
      textAlign: oneOf(n, 'textAlign', at, TEXT_ALIGNS),
      textAutoWidth: bool(n, 'textAutoWidth', at),
    })
  if (type === 'TEXT') {
    if (n.textFixedHeight !== undefined) node.textFixedHeight = bool(n, 'textFixedHeight', at)
    if (n.fontItalic !== undefined) node.fontItalic = bool(n, 'fontItalic', at)
    if (n.textDecoration !== undefined) node.textDecoration = oneOf(n, 'textDecoration', at, TEXT_DECORATIONS)
    if (n.textCase !== undefined) node.textCase = oneOf(n, 'textCase', at, TEXT_CASES)
    if (n.textAlignVertical !== undefined) node.textAlignVertical = oneOf(n, 'textAlignVertical', at, TEXT_VALIGNS)
    if (n.textTruncate !== undefined) node.textTruncate = bool(n, 'textTruncate', at)
    if (n.maxLines !== undefined) node.maxLines = num(n, 'maxLines', at, 0, 10_000)
    if (n.listStyle !== undefined) node.listStyle = oneOf(n, 'listStyle', at, TEXT_LISTS)
    if (n.runs !== undefined) {
      const ra = `${at}.runs`, rs = Array.isArray(n.runs) && n.runs.length <= 10_000 && n.runs.every(isObj) ? (n.runs as Obj[]) : fail(ra)
      node.runs = rs.map((r, i) => {
        const a = `${ra}.${i}`, s = isObj(r.style) ? r.style : fail(`${a}.style`), sa = `${a}.style`
        const len = num(r, 'len', a, 1, 100_000)
        if (!Number.isInteger(len)) fail(`${a}.len`)
        const style: RunStyle = {}
        if (s.fontFamily !== undefined) style.fontFamily = str(s, 'fontFamily', sa, 100)
        if (s.fontWeight !== undefined) style.fontWeight = num(s, 'fontWeight', sa, 1, 1000)
        if (s.fontSize !== undefined) style.fontSize = num(s, 'fontSize', sa, 0.1, 10_000)
        if (s.fontItalic !== undefined) style.fontItalic = bool(s, 'fontItalic', sa)
        if (s.textDecoration !== undefined) style.textDecoration = oneOf(s, 'textDecoration', sa, TEXT_DECORATIONS)
        if (s.textCase !== undefined) style.textCase = oneOf(s, 'textCase', sa, TEXT_CASES)
        if (s.letterSpacing !== undefined) style.letterSpacing = num(s, 'letterSpacing', sa)
        if (s.lineHeight !== undefined) style.lineHeight = num(s, 'lineHeight', sa, 0)
        if (s.fill !== undefined) style.fill = color(s.fill, `${sa}.fill`)
        return { len, style }
      })
      if (node.runs.length && node.runs.reduce((t, r) => t + r.len, 0) !== node.characters!.length) fail(ra) // must cover the text exactly
    }
  }
  if ((type === 'RECTANGLE' || type === 'FRAME') && n.cornerRadii !== undefined) {
    const r = Array.isArray(n.cornerRadii) && n.cornerRadii.length === 4 ? { ...n.cornerRadii } : fail(`${at}.cornerRadii`)
    node.cornerRadii = [0, 1, 2, 3].map((i) => num(r, String(i), `${at}.cornerRadii`, 0)) as NonNullable<Node['cornerRadii']>
  }
  if ((type === 'RECTANGLE' || type === 'FRAME') && n.cornerSmoothing !== undefined) node.cornerSmoothing = num(n, 'cornerSmoothing', at, 0, 1)
  if (type === 'ELLIPSE' && n.arc !== undefined) {
    const a = isObj(n.arc) ? n.arc : fail(`${at}.arc`)
    node.arc = { start: num(a, 'start', `${at}.arc`, -360, 360), sweep: num(a, 'sweep', `${at}.arc`, -360, 360), inner: num(a, 'inner', `${at}.arc`, 0, 1) }
  }
  if (type === 'STAR' || type === 'POLYGON') node.points = Math.round(num(n, 'points', at, 3, 60))
  if (type === 'STAR') node.innerRatio = num(n, 'innerRatio', at, 0.01, 0.99)
  if (n.mask !== undefined && type !== 'TEXT' && type !== 'LINE' && type !== 'GROUP') node.mask = bool(n, 'mask', at)
  if (type === 'BOOLEAN') node.boolOp = oneOf(n, 'boolOp', at, BOOL_OPS)
  if (type === 'VECTOR' || type === 'BOOLEAN' || type === 'STAR' || type === 'POLYGON') {
    const v = isObj(n.vector) ? n.vector : fail(`${at}.vector`)
    node.vector = { w: num(v, 'w', `${at}.vector`, 0), h: num(v, 'h', `${at}.vector`, 0), fill: vectorPaths(v.fill, `${at}.vector.fill`), stroke: vectorPaths(v.stroke, `${at}.vector.stroke`) }
  }
  return node
}

function validateStyles(x: unknown): Style[] {
  if (x === undefined) return [] // files before version 12
  if (!Array.isArray(x) || x.length > 10_000 || !x.every(isObj)) return fail('styles')
  const ids = new Set<string>()
  return x.map((s, i): Style => {
    const at = `styles.${i}`, id = str(s, 'id', at, 64), name = str(s, 'name', at, 200)
    if (!NODE_ID.test(id) || ids.has(id)) return fail(`${at}.id`)
    ids.add(id)
    const kind = oneOf(s, 'kind', at, STYLE_KINDS)
    if (kind === 'FILL') return { id, name, kind, value: paints(s.value, `${at}.value`) }
    if (kind === 'EFFECT') return { id, name, kind, value: effects(s.value, `${at}.value`) }
    const v = isObj(s.value) ? s.value : fail(`${at}.value`), va = `${at}.value`, value: TextStyleValue = {}
    if (v.fontFamily !== undefined) value.fontFamily = str(v, 'fontFamily', va, 100)
    if (v.fontWeight !== undefined) value.fontWeight = num(v, 'fontWeight', va, 1, 1000)
    if (v.fontSize !== undefined) value.fontSize = num(v, 'fontSize', va, 0.1, 10_000)
    if (v.lineHeight !== undefined) value.lineHeight = num(v, 'lineHeight', va, 0)
    if (v.letterSpacing !== undefined) value.letterSpacing = num(v, 'letterSpacing', va)
    if (v.textAlign !== undefined) value.textAlign = oneOf(v, 'textAlign', va, TEXT_ALIGNS)
    if (v.fontItalic !== undefined) value.fontItalic = bool(v, 'fontItalic', va)
    if (v.textDecoration !== undefined) value.textDecoration = oneOf(v, 'textDecoration', va, TEXT_DECORATIONS)
    if (v.textCase !== undefined) value.textCase = oneOf(v, 'textCase', va, TEXT_CASES)
    if (v.textAlignVertical !== undefined) value.textAlignVertical = oneOf(v, 'textAlignVertical', va, TEXT_VALIGNS)
    if (v.listStyle !== undefined) value.listStyle = oneOf(v, 'listStyle', va, TEXT_LISTS)
    if (v.textTruncate !== undefined) value.textTruncate = bool(v, 'textTruncate', va)
    if (v.maxLines !== undefined) value.maxLines = num(v, 'maxLines', va, 0, 10_000)
    return { id, name, kind, value }
  })
}

/** Checks shape, references, parents and cycles. Returns a clean copy with unknown fields dropped. */
export function validateDocument(x: unknown): Document {
  if (!isObj(x)) return fail('not an object')
  if (!knownVersion(x.formatVersion)) return fail('formatVersion')
  // 1 → 2 added gradient paints, 2 → 3 boolean nodes, 3 → 4 masks, 4 → 5 shape parameters: none needs a migration; future migrations go here.
  if (!isObj(x.nodes)) return fail('nodes')
  const nodes: Record<string, Node> = {}
  for (const [id, n] of Object.entries(x.nodes)) nodes[id] = validateNode(id, n)

  const pages = x.pages
  if (!Array.isArray(pages) || !pages.length || new Set(pages).size !== pages.length) return fail('pages')
  for (const id of pages) if (typeof id !== 'string' || !Object.hasOwn(nodes, id) || nodes[id].type !== 'PAGE') fail('pages')

  const rooted = new Set<string>(pages)
  for (const n of Object.values(nodes)) {
    if (n.type === 'PAGE') {
      if (n.parentId !== null || !rooted.has(n.id)) fail(`nodes.${n.id} (page not listed in pages)`)
      continue
    }
    const chain: string[] = []
    for (let c: Node = n; !rooted.has(c.id); ) {
      chain.push(c.id)
      const p = c.parentId !== null && Object.hasOwn(nodes, c.parentId) ? nodes[c.parentId] : undefined
      if (!p || !isContainer(p)) return fail(`nodes.${c.id}.parentId`)
      if (chain.includes(p.id)) return fail(`nodes.${c.id} (parent cycle)`)
      c = p
    }
    for (const id of chain) rooted.add(id)
  }
  const styles = validateStyles(x.styles), have = new Set(styles.map((s) => s.id))
  for (const n of Object.values(nodes))
    for (const k of ['fillStyle', 'strokeStyle', 'effectStyle', 'textStyle'] as const)
      if (n[k] !== undefined && !have.has(n[k]!)) fail(`nodes.${n.id}.${k} (no such style)`)
  return { formatVersion: FORMAT_VERSION, pages: pages as string[], nodes, styles } // older versions read as the current one
}

export function validateMeta(x: unknown): Meta {
  const bad = () => new FormatError('Invalid project file: meta.json')
  if (!isObj(x) || x.format !== 'refig' || !knownVersion(x.formatVersion)) throw bad()
  const s = (k: string, max = 200) => {
    const v = x[k]
    if (typeof v !== 'string' || v.length > max) throw bad()
    return v
  }
  const date = (k: string) => {
    const v = s(k)
    if (Number.isNaN(Date.parse(v))) throw bad()
    return v
  }
  if (!UUID.test(s('id'))) throw bad()
  return {
    format: 'refig', formatVersion: FORMAT_VERSION, id: s('id'), name: s('name'),
    createdAt: date('createdAt'), modifiedAt: date('modifiedAt'), appVersion: s('appVersion'),
  }
}

function json(files: Record<string, Uint8Array>, name: string): unknown {
  if (!files[name]) throw new FormatError(`Invalid project file: missing ${name}`)
  try {
    return JSON.parse(strFromU8(files[name]))
  } catch {
    throw new FormatError(`Invalid project file: ${name} is not valid JSON`)
  }
}

/** Reads only what the project list needs. */
export function readRefigMeta(bytes: Uint8Array): { meta: Meta; thumbnail?: Uint8Array } {
  const files = safeUnzip(bytes, REFIG_ENTRIES, (n) => n === 'meta.json' || n === 'thumbnail.png')
  return { meta: validateMeta(json(files, 'meta.json')), thumbnail: files['thumbnail.png'] }
}

export function readRefig(bytes: Uint8Array): RefigFile {
  const files = safeUnzip(bytes, REFIG_ENTRIES)
  const images: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(files)) if (name.startsWith('images/')) images[name.slice(7)] = data
  return {
    meta: validateMeta(json(files, 'meta.json')),
    document: validateDocument(json(files, 'document.json')),
    thumbnail: files['thumbnail.png'],
    images,
  }
}

export function writeRefig(f: RefigFile): Uint8Array {
  const zip: Zippable = {
    'meta.json': strToU8(JSON.stringify(f.meta, null, 2)),
    'document.json': strToU8(JSON.stringify(f.document)),
  }
  if (f.thumbnail) zip['thumbnail.png'] = [f.thumbnail, { level: 0 }]
  for (const [hash, data] of Object.entries(f.images)) zip[`images/${hash}`] = [data, { level: 0 }] // already compressed
  return zipSync(zip)
}
