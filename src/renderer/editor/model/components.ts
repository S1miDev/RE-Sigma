// Components: an instance's subtree mirrors its main component's, except for the fields each instance node overrides.
import { OVERRIDABLE, type Document, type Node } from '../../../shared/document'
import { childrenOf, follow, nextName, put, remove } from './ops'

type Key = (typeof OVERRIDABLE)[number]
/** An instance root's own place in the document; never taken from the main. */
const ROOT_OWN: readonly Key[] = ['name', 'visible', 'locked', 'x', 'y', 'rotation', 'fillW', 'fillH', 'constraints']
const GEOMETRY: readonly Key[] = ['x', 'y', 'width', 'height']

/** The nearest instance root at or above a node, or null. */
export function instanceRoot(doc: Document, id: string): string | null {
  for (let n: Node | undefined = doc.nodes[id]; n; n = n.parentId ? doc.nodes[n.parentId] : undefined) if (n.instanceOf) return n.id
  return null
}
/** True for an instance root or anything inside one. */
export const inInstance = (doc: Document, id: string) => instanceRoot(doc, id) !== null

const pick = (n: Node, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => k in n).map((k) => [k, n[k as keyof Node]]))
/** Drops keys set to undefined, so a mirrored node looks like one made by hand. */
const clean = (n: Node) => Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)) as unknown as Node
const same = (a: Node, b: Node | undefined) => {
  if (a === b) return true
  if (!b) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k as keyof Node] === b[k as keyof Node])
}

/**
 * Fields auto layout or text measuring will compute anyway; keeping the instance's current values avoids
 * rewriting them on every edit.
 */
function derived(n: Node, parent: Node | undefined): Key[] {
  const out: Key[] = []
  if (parent?.layout) out.push('x', 'y', ...(n.fillW ? ['width' as const] : []), ...(n.fillH ? ['height' as const] : []))
  if (n.layout?.hugW) out.push('width')
  if (n.layout?.hugH) out.push('height')
  if (n.type === 'TEXT') out.push('height', ...(n.textAutoWidth ? ['width' as const] : []))
  return out
}

/** Adds the fields the user just changed on instance nodes to their overrides. */
function record(prev: Document, doc: Document): Document {
  const changed: Node[] = []
  for (const n of Object.values(doc.nodes)) {
    const p = prev.nodes[n.id]
    if (!p || p === n || !(n.ref || n.instanceOf) || !inInstance(doc, n.id)) continue
    const parent = n.parentId ? doc.nodes[n.parentId] : undefined, was = n.parentId ? prev.nodes[n.parentId] : undefined
    const parentResized = !!parent && !!was && (parent.width !== was.width || parent.height !== was.height) // constraints moved it, not the user
    const keys = OVERRIDABLE.filter((k) => n[k] !== p[k] && !(n.instanceOf && !n.ref && ROOT_OWN.includes(k)) && !(parentResized && GEOMETRY.includes(k)))
    const next = [...new Set([...(n.overrides ?? []), ...keys])]
    if (next.length !== (n.overrides?.length ?? 0)) changed.push({ ...n, overrides: next })
  }
  return changed.length ? put(doc, changed) : doc
}

/** Nodes copied or moved out of an instance stop mirroring anything. */
function strip(doc: Document): Document {
  const loose = Object.values(doc.nodes).filter((n) => (n.ref || n.overrides) && !inInstance(doc, n.id))
  return loose.length ? put(doc, loose.map((n) => clean({ ...n, ref: undefined, overrides: undefined }))) : doc
}

/** The nodes an instance owns, top-down; a nested instance's children belong to it, not to this one. */
function ownedBy(doc: Document, rootId: string): Node[] {
  const out: Node[] = []
  const walk = (id: string) => { for (const k of childrenOf(doc, id)) { out.push(k); if (!k.instanceOf) walk(k.id) } }
  walk(rootId)
  return out
}
const depth = (doc: Document, id: string) => { let d = 0; for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) d++; return d }

/** An instance can't expand its own main, or a main already being expanded above it (A contains B contains A). */
function expandable(doc: Document, root: Node): boolean {
  const main = doc.nodes[root.instanceOf!]
  if (!main?.component) return false
  for (let n = root.parentId ? doc.nodes[root.parentId] : undefined; n; n = n.parentId ? doc.nodes[n.parentId] : undefined)
    if (n.id === main.id || n.instanceOf === main.id) return false
  return true
}

function rebuild(doc: Document, rootId: string): Document {
  const root = doc.nodes[rootId], main = doc.nodes[root.instanceOf!]
  const owned = ownedBy(doc, rootId)
  const byRef = new Map(owned.filter((k) => k.ref).map((k) => [k.ref!, k]))
  const out: Node[] = []

  const mirror = (src: Node, mine: Node | undefined, own: Partial<Node>, srcParent: Node | undefined, parent: Node | undefined): Node => {
    let n: Node = { ...src, component: undefined, ...own }
    // the main child's constraints, applied from the main's size to this instance's size
    if (srcParent && parent && !parent.layout && !srcParent.layout) {
      const over = new Set(mine?.overrides)
      const h = src.constraints?.h ?? 'MIN', v = src.constraints?.v ?? 'MIN'
      if (parent.width !== srcParent.width && !over.has('x') && !over.has('width')) [n.x, n.width] = follow(h, src.x, src.width, srcParent.width, parent.width)
      if (parent.height !== srcParent.height && !over.has('y') && !over.has('height')) [n.y, n.height] = follow(v, src.y, src.height, srcParent.height, parent.height)
    }
    if (mine) n = { ...n, ...pick(mine, derived(n, parent)), ...pick(mine, mine.overrides ?? []) }
    n = clean(n)
    out.push(n)
    if (!src.instanceOf) for (const k of childrenOf(doc, src.id)) {
      const theirs = byRef.get(k.id)
      mirror(k, theirs, { id: theirs?.id ?? crypto.randomUUID(), parentId: n.id, order: k.order, ref: k.id, overrides: theirs?.overrides }, src, n)
    }
    return n
  }
  const parent = root.parentId ? doc.nodes[root.parentId] : undefined
  mirror(main, root, {
    id: root.id, parentId: root.parentId, order: root.order, instanceOf: main.id, ref: root.ref, overrides: root.overrides, ...pick(root, ROOT_OWN),
  }, undefined, parent)

  const kept = new Set(out.map((n) => n.id))
  doc = remove(doc, owned.filter((k) => !kept.has(k.id)).map((k) => k.id))
  const changed = out.filter((n) => !same(n, doc.nodes[n.id]))
  return changed.length ? put(doc, changed) : doc
}

/**
 * Keeps every instance in step with its main component after an edit. Runs first in the store's normalize pass,
 * so `next` still holds exactly what the user changed since `prev`.
 */
export function syncInstances(prev: Document, next: Document): Document {
  let doc = strip(record(prev, next))
  // shortcut: every edit re-syncs every instance; cache by changed subtree when documents get large.
  const done = new Set<string>()
  for (;;) {
    // shallowest first, then any instance roots the last round created inside copied subtrees
    const todo = Object.values(doc.nodes).filter((n) => n.instanceOf && !done.has(n.id)).sort((a, b) => depth(doc, a.id) - depth(doc, b.id))
    if (!todo.length) return doc
    for (const n of todo) {
      done.add(n.id)
      if (doc.nodes[n.id] && expandable(doc, doc.nodes[n.id])) doc = rebuild(doc, n.id)
    }
  }
}

/** Turns a frame into a main component. */
export const makeComponent = (doc: Document, id: string): Document =>
  put(doc, [{ ...doc.nodes[id], component: true, name: doc.nodes[id].name.startsWith('Frame') ? nextName(doc, 'Component') : doc.nodes[id].name }])

/** Stops an instance mirroring its main; it becomes a plain frame with the same content. */
export function detach(doc: Document, rootId: string): Document {
  const owned = ownedBy(doc, rootId)
  return put(doc, [doc.nodes[rootId], ...owned].map((n) => clean({ ...n, instanceOf: n.id === rootId ? undefined : n.instanceOf, ref: n.id === rootId ? n.ref : undefined, overrides: n.id === rootId && n.ref ? n.overrides : undefined })))
}

/** Drops an instance's overrides; the next sync restores the main's values. */
export function resetOverrides(doc: Document, rootId: string): Document {
  const owned = [doc.nodes[rootId], ...ownedBy(doc, rootId)]
  return put(doc, owned.filter((n) => n.overrides).map((n) => clean({ ...n, overrides: undefined })))
}
