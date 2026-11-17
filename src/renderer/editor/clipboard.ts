// In-app clipboard: copies survive switching projects within a session. Images on the system clipboard paste too.
import { isContainer, makeNode, solid, type Node } from '../../shared/document'
import { toWorld } from './canvas/viewport'
import { apply, worldMatrix, worldRotation, type Pt } from './model/geometry'
import { cloneTree, descendants, insert, nextName, pageOf, patch, put, topLevel, topOrder } from './model/ops'
import { importSvg } from './importSvg'
import type { EditorStore } from './store'

let clipboard: { roots: { node: Node; centre: Pt; rotation: number }[]; nodes: Node[]; images: Map<string, Uint8Array> } | null = null

export const hasClipboard = () => clipboard !== null

/** What copy() puts on the system clipboard as text, so a later paste can tell its own copy from text copied in another app. */
let marker = ''

export function copy(store: EditorStore) {
  const { doc, selection } = store.get(), ids = topLevel(doc, selection)
  if (!ids.length) return
  marker = ids.map((id) => doc.nodes[id].name).join('\n')
  void navigator.clipboard?.writeText(marker).catch(() => {}) // best effort: replaces stale text from other apps
  const nodes = ids.flatMap((id) => [doc.nodes[id], ...descendants(doc, id)])
  const images = new Map<string, Uint8Array>()
  for (const n of nodes) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE' && store.imageBytes(p.hash)) images.set(p.hash, store.imageBytes(p.hash)!)
  clipboard = {
    nodes, images,
    roots: ids.map((id) => ({ node: doc.nodes[id], centre: apply(worldMatrix(doc, id), { x: doc.nodes[id].width / 2, y: doc.nodes[id].height / 2 }), rotation: worldRotation(doc, id) })),
  }
}

/**
 * Pastes into the original parent when it's on this page (same spot, on top); otherwise onto the page at the same page position.
 * With `into` (a container) everything goes into it keeping its own x/y, whatever its original parent was.
 */
export async function paste(store: EditorStore, into?: string) {
  const clip = clipboard
  if (!clip) return
  for (const [hash, bytes] of clip.images) if (!store.imageBytes(hash)) await store.addImage(bytes)
  const kids = (id: string) => clip.nodes.filter((n) => n.parentId === id)
  store.update((doc) => {
    const { pageId } = store.get(), ids: string[] = []
    for (const root of clip.roots) {
      const target = into && doc.nodes[into] && isContainer(doc.nodes[into]) ? into : null
      const home = target || (root.node.parentId && doc.nodes[root.node.parentId] && pageOf(doc, root.node.parentId) === pageId)
      const parentId = target ?? (home ? root.node.parentId! : pageId)
      const placed = home ? root.node : { ...root.node, x: root.centre.x - root.node.width / 2, y: root.centre.y - root.node.height / 2, rotation: root.rotation }
      const copies = cloneTree(placed, kids, parentId, topOrder(doc, parentId))
      doc = put(doc, copies)
      ids.push(copies[0].id)
    }
    return { doc, ids }
  })
}

const COMMON_PROPS = [
  'fills', 'strokes', 'strokeWeight', 'strokeAlign', 'strokeDash', 'strokeCap', 'strokeJoin', 'strokeStart', 'strokeEnd', 'strokeSides',
  'effects', 'opacity', 'blendMode', 'cornerRadius', 'cornerRadii', 'cornerSmoothing', 'fillStyle', 'strokeStyle', 'effectStyle',
] as const satisfies readonly (keyof Node)[]
const TEXT_PROPS = [
  'fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'fontItalic', 'textDecoration', 'textCase',
  'textAlignVertical', 'textTruncate', 'maxLines', 'listStyle', 'textStyle',
] as const satisfies readonly (keyof Node)[]
let props: { type: Node['type']; common: Partial<Node>; text: Partial<Node> } | null = null

const pick = (n: Node, keys: readonly (keyof Node)[]) => Object.fromEntries(keys.map((k) => [k, n[k]])) as Partial<Node>
export const hasProps = () => props !== null

/** Remembers the look (paints, stroke, effects, corners, text style) of the single selected layer. */
export function copyProps(store: EditorStore) {
  const { doc, selection } = store.get(), n = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  if (n && n.type !== 'PAGE') props = { type: n.type, common: pick(n, COMMON_PROPS), text: n.type === 'TEXT' ? pick(n, TEXT_PROPS) : {} }
}

/** Applies the remembered look to the selection in one undo step; text fields only reach text layers. */
export function pasteProps(store: EditorStore) {
  const p = props, { selection } = store.get()
  if (!p || !selection.length) return
  store.update((doc) => patch(doc, selection, (n) => (n.type === 'TEXT' ? { ...p.common, ...p.text } : p.common)))
}

/** Pastes text from another app as a text layer at the viewport centre. */
export function placeText(store: EditorStore, text: string) {
  const { view, size, pageId } = store.get(), c = toWorld(view, { x: size.w / 2, y: size.h / 2 })
  const body = text.slice(0, 100_000) // the .refig limit on characters
  const node = makeNode('TEXT', { name: body.split('\n')[0].slice(0, 40) || 'Text', characters: body, fills: [solid(0, 0, 0)], x: c.x, y: c.y })
  store.update((doc) => ({ doc: insert(doc, node, pageId), ids: [node.id] }))
}

/** True when the system clipboard text is something other than what our own copy() wrote. */
export const isForeignText = (text: string) => text !== '' && text !== marker

const isSvg =(f: Blob & { name?: string }) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name ?? '')

/**
 * Places an image file (system clipboard, file picker or drop) centred on `at` (page coordinates; default the viewport centre):
 * a raster becomes a rectangle with an image fill, an SVG a frame of vector nodes. Returns what an SVG used that isn't imported.
 */
export async function placeFile(store: EditorStore, file: Blob & { name?: string }, at?: Pt): Promise<string[]> {
  const { view, size, pageId } = store.get()
  const c = at ?? toWorld(view, { x: size.w / 2, y: size.h / 2 })
  if (isSvg(file)) {
    const { nodes, root, skipped } = importSvg(await file.text(), file.name ?? 'SVG')
    const placed = { ...root, name: nextName(store.get().doc, root.name), x: c.x - root.width / 2, y: c.y - root.height / 2 }
    store.update((doc) => ({ doc: put(insert(doc, placed, pageId), nodes.filter((n) => n.id !== root.id)), ids: [root.id] }))
    return skipped
  }
  const hash = await store.addImage(new Uint8Array(await file.arrayBuffer()))
  const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(file).catch(() => null) : null
  const width = bitmap?.width ?? 200, height = bitmap?.height ?? 200
  const node = makeNode('RECTANGLE', { name: nextName(store.get().doc, 'Image'), x: c.x - width / 2, y: c.y - height / 2, width, height, fills: [{ type: 'IMAGE', visible: true, hash }] })
  store.update((doc) => ({ doc: insert(doc, node, pageId), ids: [node.id] }))
  return []
}
