// The Refig document model. Flat node map with parentId + fractional order, like Figma's NodeChange list.
export type Color = { r: number; g: number; b: number; a: number } // floats 0–1
export const GRADIENT_KINDS = ['LINEAR', 'RADIAL', 'ANGULAR', 'DIAMOND'] as const
export type GradientStop = { pos: number; color: Color } // pos 0–1
type Pt = { x: number; y: number }
/**
 * Handles in the node's normalized box (0–1), like Figma's. Linear runs from → to; the others are centred on `from`
 * with `to` on the edge (radius, start angle). `w` is Figma's third (width) handle: where the gradient's other axis
 * ends — for linear, the point half a length "below" `from`; for the others, the edge along the second radius.
 * Without `w` the gradient is undistorted in the normalized box (a circle there is an ellipse fitting the box).
 */
export type Gradient = { type: 'GRADIENT'; kind: (typeof GRADIENT_KINDS)[number]; visible: boolean; from: Pt; to: Pt; w?: Pt; stops: GradientStop[] }
/** `opacity` (0–1, absent = 1) multiplies with the colour's own alpha. */
export type Paint = { opacity?: number } & (
  | { type: 'SOLID'; visible: boolean; color: Color }
  | ImagePaint
  | Gradient
)
export const IMAGE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const
/**
 * How an image sits in its node. FILL covers it, FIT shows it whole; both centre. CROP is FILL zoomed by `scale` (default 1)
 * and moved by `offsetX`/`offsetY` (node px). TILE repeats the image at `scale` × its pixel size from the offset.
 */
export type ImagePaint = { type: 'IMAGE'; visible: boolean; hash: string; scaleMode?: (typeof IMAGE_MODES)[number]; scale?: number; offsetX?: number; offsetY?: number }
/** Blend modes → their CSS names (canvas globalCompositeOperation and mix-blend-mode share them). */
export const BLEND_CSS = {
  NORMAL: 'source-over', DARKEN: 'darken', MULTIPLY: 'multiply', COLOR_BURN: 'color-burn', LIGHTEN: 'lighten', SCREEN: 'screen',
  COLOR_DODGE: 'color-dodge', OVERLAY: 'overlay', SOFT_LIGHT: 'soft-light', HARD_LIGHT: 'hard-light', DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
} as const
export type BlendMode = keyof typeof BLEND_CSS
export const BLEND_MODES = Object.keys(BLEND_CSS) as BlendMode[]
export type DropShadow = { type?: 'DROP_SHADOW'; visible: boolean; x: number; y: number; blur: number; spread: number; color: Color } // type absent = drop shadow (v1-6 files)
export type InnerShadow = Omit<DropShadow, 'type'> & { type: 'INNER_SHADOW' }
export type Blur = { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; visible: boolean; blur: number }
export type Effect = DropShadow | InnerShadow | Blur
export const NODE_TYPES = ['PAGE', 'FRAME', 'GROUP', 'RECTANGLE', 'ELLIPSE', 'LINE', 'TEXT', 'VECTOR', 'BOOLEAN', 'STAR', 'POLYGON'] as const
/** An ellipse's arc: start angle and sweep in degrees (clockwise from 3 o'clock), inner = the hole's size as a fraction of the ellipse. */
export type Arc = { start: number; sweep: number; inner: number }
export const BOOL_OPS = ['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'] as const
export type BoolOp = (typeof BOOL_OPS)[number]
export type NodeType = (typeof NODE_TYPES)[number]
export const STROKE_ALIGNS = ['INSIDE', 'CENTER', 'OUTSIDE'] as const
export const STROKE_CAPS = ['NONE', 'ROUND', 'SQUARE'] as const
export const STROKE_JOINS = ['MITER', 'BEVEL', 'ROUND'] as const
export const STROKE_ENDS = ['NONE', 'ARROW', 'TRIANGLE', 'CIRCLE', 'DIAMOND'] as const
export const TEXT_ALIGNS =['LEFT', 'CENTER', 'RIGHT'] as const
export const TEXT_DECORATIONS = ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] as const
export const TEXT_CASES = ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE'] as const
export const TEXT_VALIGNS = ['TOP', 'CENTER', 'BOTTOM'] as const
export const TEXT_LISTS = ['NONE', 'BULLET', 'NUMBERED'] as const
export const FILL_RULES = ['nonzero', 'evenodd'] as const
export const LAYOUT_MODES = ['HORIZONTAL', 'VERTICAL'] as const
export const LAYOUT_ALIGNS = ['MIN', 'CENTER', 'MAX'] as const
/** Auto layout on a FRAME. padding is [top, right, bottom, left]; align is on the cross axis; hug sizes the frame to its content. */
export type AutoLayout = {
  mode: (typeof LAYOUT_MODES)[number]
  gap: number
  padding: [number, number, number, number]
  align: (typeof LAYOUT_ALIGNS)[number]
  hugW: boolean
  hugH: boolean
}
/** How a child follows its frame's resize on one axis: pinned to the start (MIN) or end (MAX), both edges (STRETCH), centred, or scaled. */
export const CONSTRAINTS = ['MIN', 'MAX', 'STRETCH', 'CENTER', 'SCALE'] as const
export type Constraint = (typeof CONSTRAINTS)[number]
/** SVG path data using only absolute M L Q C Z. */
export type VectorPath = { d: string; rule: (typeof FILL_RULES)[number] }

/** What one range of a TEXT can override; anything unset comes from the node's own text fields. */
export interface RunStyle {
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  fontItalic?: boolean
  textDecoration?: (typeof TEXT_DECORATIONS)[number]
  textCase?: (typeof TEXT_CASES)[number]
  letterSpacing?: number
  lineHeight?: number
  fill?: Color
}
export type TextRun = { len: number; style: RunStyle }

export interface Node {
  id: string
  type: NodeType
  name: string
  parentId: string | null // null only for PAGE
  order: string
  visible: boolean
  locked: boolean
  x: number // top-left of the unrotated box, relative to the parent
  y: number
  width: number
  height: number
  rotation: number // degrees, clockwise, about the box centre
  opacity: number
  blendMode?: BlendMode // absent = NORMAL
  fills: Paint[]
  strokes: Paint[]
  strokeWeight: number
  strokeAlign: (typeof STROKE_ALIGNS)[number]
  strokeDash?: number[] // dash, gap, dash, gap... in px; absent or empty = solid
  strokeCap?: (typeof STROKE_CAPS)[number] // absent = NONE
  strokeJoin?: (typeof STROKE_JOINS)[number] // absent = MITER
  strokeStart?: (typeof STROKE_ENDS)[number] // LINE and open VECTOR: marker at the first/last point; absent = NONE
  strokeEnd?: (typeof STROKE_ENDS)[number]
  strokeSides?: [number, number, number, number] // RECTANGLE/FRAME: top, right, bottom, left weights (inside); strokeWeight then holds their max
  effects: Effect[]
  cornerRadius: number
  cornerRadii?: [number, number, number, number] // RECTANGLE/FRAME: top-left, top-right, bottom-right, bottom-left; wins over cornerRadius
  cornerSmoothing?: number // RECTANGLE/FRAME: 0 = circular corners, 1 = Figma's full "squircle"
  clipsContent: boolean
  layout?: AutoLayout // FRAME only
  fillW?: boolean // child of an auto-layout frame: stretch to fill it along this axis
  fillH?: boolean
  constraints?: { h: Constraint; v: Constraint } // absent = MIN/MIN
  // Components (FRAME only for the first two). An instance's subtree mirrors its main component's.
  component?: boolean // a main component
  componentSet?: boolean // a frame holding variants: main components named "Prop=Value, Prop2=Value"
  instanceOf?: string // an instance root: the main component's id
  ref?: string // a node inside an instance: the id of the node it mirrors in the main component
  overrides?: string[] // fields an instance node keeps from itself (OVERRIDABLE)
  // Styles: ids into Document.styles. The linked fields (fills / strokes / effects / text fields) always hold the style's value.
  fillStyle?: string
  strokeStyle?: string
  effectStyle?: string
  textStyle?: string
  // TEXT only
  characters?: string
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  lineHeight?: number // px; 0 = auto
  letterSpacing?: number // px
  textAlign?: (typeof TEXT_ALIGNS)[number]
  textAutoWidth?: boolean
  textFixedHeight?: boolean // the height is the user's, not the content's (vertical align and truncation then matter); absent = follows content
  fontItalic?: boolean
  textDecoration?: (typeof TEXT_DECORATIONS)[number] // absent = NONE
  textCase?: (typeof TEXT_CASES)[number] // absent = ORIGINAL
  textAlignVertical?: (typeof TEXT_VALIGNS)[number] // absent = TOP
  textTruncate?: boolean // cut the text at maxLines with an ellipsis
  maxLines?: number // 0 or absent = unlimited
  listStyle?: (typeof TEXT_LISTS)[number] // absent = NONE; applies to every paragraph (line break)
  runs?: TextRun[] // per-range style overrides covering `characters` in order; absent = one style (the fields above)
  arc?: Arc // ELLIPSE only: a sector or ring instead of the full ellipse
  points?: number // STAR/POLYGON: number of points (corners)
  innerRatio?: number // STAR: inner radius as a fraction of the outer one
  mask?: boolean // a shape that clips the siblings above it (and draws nothing itself)
  // BOOLEAN only: how its children (the operands, bottom one first) combine. Its `vector` is computed from them.
  boolOp?: BoolOp
  // VECTOR (and BOOLEAN, STAR, POLYGON: computed): paths drawn at w×h, scaled to the node's size. `stroke` is the stroke already outlined (filled with the stroke paint).
  vector?: { w: number; h: number; fill: VectorPath[]; stroke: VectorPath[] }
}

/** Text fields a TEXT style carries (whole-node ones; runs keep their own overrides). */
export const TEXT_STYLE_FIELDS = [
  'fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'fontItalic', 'textDecoration', 'textCase',
  'textAlignVertical', 'listStyle', 'textTruncate', 'maxLines',
] as const satisfies readonly (keyof Node)[]
export type TextStyleValue = Partial<Pick<Node, (typeof TEXT_STYLE_FIELDS)[number]>>
/** A named, reusable look. Nodes link to it by id (Node.fillStyle...); the editor copies its value onto the linked nodes. A FILL style serves fills and strokes. */
export type Style =
  | { id: string; name: string; kind: 'FILL'; value: Paint[] }
  | { id: string; name: string; kind: 'TEXT'; value: TextStyleValue }
  | { id: string; name: string; kind: 'EFFECT'; value: Effect[] }
export const STYLE_KINDS = ['FILL', 'TEXT', 'EFFECT'] as const

export interface Document {
  formatVersion: typeof FORMAT_VERSION
  pages: string[]
  nodes: Record<string, Node>
  styles: Style[]
}

/** Fields an instance node can override; everything else (ids, tree position, component links) is never copied from the main. */
export const OVERRIDABLE = [
  'name', 'visible', 'locked', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'blendMode', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'effects',
  'strokeDash', 'strokeCap', 'strokeJoin', 'strokeStart', 'strokeEnd', 'strokeSides',
  'cornerRadius', 'clipsContent', 'layout', 'fillW', 'fillH', 'constraints', 'characters', 'fontFamily', 'fontWeight', 'fontSize', 'lineHeight',
  'letterSpacing', 'textAlign', 'textAutoWidth', 'textFixedHeight', 'fontItalic', 'textDecoration', 'textCase', 'textAlignVertical', 'textTruncate', 'maxLines', 'listStyle', 'runs', 'vector', 'boolOp', 'mask', 'cornerRadii', 'cornerSmoothing', 'arc', 'points', 'innerRatio',
  'fillStyle', 'strokeStyle', 'effectStyle', 'textStyle',
] as const satisfies readonly (keyof Node)[]

// 2: gradient paints. 3: boolean nodes. 4: masks. 5: star, polygon, arcs, corner radii and smoothing. 6: blend modes and paint opacity. 7: inner shadow, layer blur, background blur effects. 8: stroke dashes, caps, joins, end markers, per-side weights. 9: image scale modes. 10: text italic, decoration, case, vertical align, truncation, lists. 11: text style runs. 12: styles (Document.styles, Node.fillStyle/strokeStyle/effectStyle/textStyle). Older files read unchanged; older apps refuse newer ones as "made by a newer version".
export const FORMAT_VERSION = 12
export const isContainer = (n: Node) => n.type === 'PAGE' || n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'BOOLEAN'
export const solid = (r: number, g: number, b: number, a = 1): Paint => ({ type: 'SOLID', visible: true, color: { r, g, b, a } })
/** A new gradient fading `color` out: linear top → bottom, the others from the centre to the right edge. */
export const gradient = (kind: Gradient['kind'], color: Color, visible = true): Gradient => ({
  type: 'GRADIENT', kind, visible,
  from: kind === 'LINEAR' ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.5 }, to: kind === 'LINEAR' ? { x: 0.5, y: 1 } : { x: 1, y: 0.5 },
  stops: [{ pos: 0, color }, { pos: 1, color: { ...color, a: 0 } }],
})
/** The gradient's direction in degrees (0 = right, clockwise, in the normalized box). */
export const gradientAngle = (g: Gradient) => (Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x) * 180) / Math.PI
/** Turns a gradient to an absolute angle, all handles together: linear about its midpoint, the others about their centre. */
export function rotateGradient(g: Gradient, deg: number): Gradient {
  const by = ((deg - gradientAngle(g)) * Math.PI) / 180, cos = Math.cos(by), sin = Math.sin(by)
  const c = g.kind === 'LINEAR' ? { x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 } : g.from
  const turn = (p: Pt) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos })
  return { ...g, from: turn(g.from), to: turn(g.to), ...(g.w && { w: turn(g.w) }) }
}

/**
 * The affine map [a, b, c, d, e, f] (DOMMatrix order) from canonical gradient space to the node's normalized box, or
 * null when the handles are degenerate. In canonical space linear runs x = 0 → 1; the others are centred on (½, ½)
 * with radius ½ and start at angle 0; a diamond is |x−½| + |y−½| = ½. This is the inverse of Figma's paint transform.
 */
export function gradientMatrix(g: Gradient): [number, number, number, number, number, number] | null {
  const ux = g.to.x - g.from.x, uy = g.to.y - g.from.y
  // without a third handle the second axis is the first turned 90° (y down); linear's is half as long
  const half = g.kind === 'LINEAR' ? 0.5 : 1
  const w = g.w ?? { x: g.from.x - uy * half, y: g.from.y + ux * half }
  const ex = g.kind === 'LINEAR' ? [ux, uy] : [ux * 2, uy * 2], ey = [(w.x - g.from.x) * 2, (w.y - g.from.y) * 2]
  if (!(Math.abs(ex[0] * ey[1] - ex[1] * ey[0]) > 1e-12)) return null
  // origin: the image of canonical (0, 0); `from` is the image of (0, ½) for linear and (½, ½) otherwise
  const ox = g.from.x - ey[0] / 2 - (g.kind === 'LINEAR' ? 0 : ex[0] / 2), oy = g.from.y - ey[1] / 2 - (g.kind === 'LINEAR' ? 0 : ex[1] / 2)
  return [ex[0], ex[1], ey[0], ey[1], ox, oy]
}
export type PaintKind = 'SOLID' | Gradient['kind']
/** A gradient's stops by position (they are stored in edit order). */
export const sortedStops = (stops: GradientStop[]) => [...stops].sort((a, b) => a.pos - b.pos)
/** Switches a solid or gradient paint to another kind. Gradients keep their stops; solid keeps the first stop's colour. */
export function convertPaint(p: Exclude<Paint, { type: 'IMAGE' }>, kind: PaintKind): Paint {
  const first = p.type === 'SOLID' ? p.color : sortedStops(p.stops)[0].color
  const op = p.opacity === undefined ? {} : { opacity: p.opacity }
  if (kind === 'SOLID') return { type: 'SOLID', visible: p.visible, color: first, ...op }
  const g = { ...gradient(kind, first, p.visible), ...op }
  return p.type === 'GRADIENT' ? { ...g, stops: p.stops } : g
}
/** The colour of a gradient at `pos`, interpolated between its stops. */
export function colorAt(stops: GradientStop[], pos: number): Color {
  const s = sortedStops(stops), i = s.findIndex((x) => x.pos >= pos)
  if (i <= 0) return (i === 0 ? s[0] : s.at(-1)!).color
  const a = s[i - 1], b = s[i], t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
  const mix = (k: keyof Color) => a.color[k] + (b.color[k] - a.color[k]) * t
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: mix('a') }
}

/** "Rectangle" for RECTANGLE: a node type as people read it. */
export const typeLabel = (type: NodeType) => type[0] + type.slice(1).toLowerCase()

export function makeNode(type: NodeType, props: Partial<Node> = {}): Node {
  return {
    id: crypto.randomUUID(),
    type,
    name: typeLabel(type),
    parentId: null,
    order: 'O',
    visible: true,
    locked: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    fills: [],
    strokes: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    effects: [],
    cornerRadius: 0,
    clipsContent: type === 'FRAME',
    ...(type === 'TEXT' && {
      characters: '',
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSize: 16,
      lineHeight: 0,
      letterSpacing: 0,
      textAlign: 'LEFT' as const,
      textAutoWidth: true,
    }),
    ...props,
  }
}

export function emptyDocument(): Document {
  const page = makeNode('PAGE', { name: 'Page 1', fills: [solid(0.96, 0.96, 0.96)] })
  return { formatVersion: FORMAT_VERSION, pages: [page.id], nodes: { [page.id]: page }, styles: [] }
}
