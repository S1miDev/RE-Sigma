// The Refig document model. Flat node map with parentId + fractional order, like Figma's NodeChange list.
export type Color = { r: number; g: number; b: number; a: number } // floats 0–1
export const GRADIENT_KINDS = ['LINEAR', 'RADIAL', 'ANGULAR', 'DIAMOND'] as const
export type GradientStop = { pos: number; color: Color } // pos 0–1
/**
 * `from`/`to` are in the node's normalized box (0–1), like Figma's handles. Linear runs from → to; the others are
 * centred on `from` with `to` on the edge (radius, start angle), so a circle in this space is an ellipse fitting the box.
 */
export type Gradient = { type: 'GRADIENT'; kind: (typeof GRADIENT_KINDS)[number]; visible: boolean; from: { x: number; y: number }; to: { x: number; y: number }; stops: GradientStop[] }
export type Paint =
  | { type: 'SOLID'; visible: boolean; color: Color }
  | { type: 'IMAGE'; visible: boolean; hash: string }
  | Gradient
export type DropShadow = { visible: boolean; x: number; y: number; blur: number; spread: number; color: Color }

export const NODE_TYPES = ['PAGE', 'FRAME', 'GROUP', 'RECTANGLE', 'ELLIPSE', 'LINE', 'TEXT', 'VECTOR'] as const
export type NodeType = (typeof NODE_TYPES)[number]
export const STROKE_ALIGNS = ['INSIDE', 'CENTER', 'OUTSIDE'] as const
export const TEXT_ALIGNS = ['LEFT', 'CENTER', 'RIGHT'] as const
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
  fills: Paint[]
  strokes: Paint[]
  strokeWeight: number
  strokeAlign: (typeof STROKE_ALIGNS)[number]
  effects: DropShadow[]
  cornerRadius: number
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
  // TEXT only
  characters?: string
  fontFamily?: string
  fontWeight?: number
  fontSize?: number
  lineHeight?: number // px; 0 = auto
  letterSpacing?: number // px
  textAlign?: (typeof TEXT_ALIGNS)[number]
  textAutoWidth?: boolean
  // VECTOR only: paths drawn at w×h, scaled to the node's size. `stroke` is the stroke already outlined (filled with the stroke paint).
  vector?: { w: number; h: number; fill: VectorPath[]; stroke: VectorPath[] }
}

export interface Document {
  formatVersion: 1
  pages: string[]
  nodes: Record<string, Node>
}

/** Fields an instance node can override; everything else (ids, tree position, component links) is never copied from the main. */
export const OVERRIDABLE = [
  'name', 'visible', 'locked', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'effects',
  'cornerRadius', 'clipsContent', 'layout', 'fillW', 'fillH', 'constraints', 'characters', 'fontFamily', 'fontWeight', 'fontSize', 'lineHeight',
  'letterSpacing', 'textAlign', 'textAutoWidth', 'vector',
] as const satisfies readonly (keyof Node)[]

export const FORMAT_VERSION = 1
export const isContainer = (n: Node) => n.type === 'PAGE' || n.type === 'FRAME' || n.type === 'GROUP'
export const solid = (r: number, g: number, b: number, a = 1): Paint => ({ type: 'SOLID', visible: true, color: { r, g, b, a } })
/** A new gradient fading `color` out: linear top → bottom, the others from the centre to the right edge. */
export const gradient = (kind: Gradient['kind'], color: Color, visible = true): Gradient => ({
  type: 'GRADIENT', kind, visible,
  from: kind === 'LINEAR' ? { x: 0.5, y: 0 } : { x: 0.5, y: 0.5 }, to: kind === 'LINEAR' ? { x: 0.5, y: 1 } : { x: 1, y: 0.5 },
  stops: [{ pos: 0, color }, { pos: 1, color: { ...color, a: 0 } }],
})
/** The gradient's direction in degrees (0 = right, clockwise, in the normalized box). */
export const gradientAngle = (g: Gradient) => (Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x) * 180) / Math.PI
/** Turns a gradient to an absolute angle: linear about its midpoint, the others about their centre. */
export function rotateGradient(g: Gradient, deg: number): Gradient {
  const len = Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y), a = (deg * Math.PI) / 180, dx = Math.cos(a) * len, dy = Math.sin(a) * len
  if (g.kind !== 'LINEAR') return { ...g, to: { x: g.from.x + dx, y: g.from.y + dy } }
  const mx = (g.from.x + g.to.x) / 2, my = (g.from.y + g.to.y) / 2
  return { ...g, from: { x: mx - dx / 2, y: my - dy / 2 }, to: { x: mx + dx / 2, y: my + dy / 2 } }
}
export type PaintKind = 'SOLID' | Gradient['kind']
/** Switches a solid or gradient paint to another kind. Gradients keep their stops; solid keeps the first stop's colour. */
export function convertPaint(p: Exclude<Paint, { type: 'IMAGE' }>, kind: PaintKind): Paint {
  const first = p.type === 'SOLID' ? p.color : [...p.stops].sort((a, b) => a.pos - b.pos)[0].color
  if (kind === 'SOLID') return { type: 'SOLID', visible: p.visible, color: first }
  const g = gradient(kind, first, p.visible)
  return p.type === 'GRADIENT' ? { ...g, stops: p.stops } : g
}
/** The colour of a gradient at `pos`, interpolated between its stops. */
export function colorAt(stops: GradientStop[], pos: number): Color {
  const s = [...stops].sort((a, b) => a.pos - b.pos), i = s.findIndex((x) => x.pos >= pos)
  if (i <= 0) return (i === 0 ? s[0] : s.at(-1)!).color
  const a = s[i - 1], b = s[i], t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
  const mix = (k: keyof Color) => a.color[k] + (b.color[k] - a.color[k]) * t
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: mix('a') }
}

export function makeNode(type: NodeType, props: Partial<Node> = {}): Node {
  return {
    id: crypto.randomUUID(),
    type,
    name: type[0] + type.slice(1).toLowerCase(),
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
  return { formatVersion: 1, pages: [page.id], nodes: { [page.id]: page } }
}
