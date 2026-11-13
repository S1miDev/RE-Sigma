// The Refig document model. Flat node map with parentId + fractional order, like Figma's NodeChange list.
export type Color = { r: number; g: number; b: number; a: number } // floats 0–1
export type Paint =
  | { type: 'SOLID'; visible: boolean; color: Color }
  | { type: 'IMAGE'; visible: boolean; hash: string }
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
