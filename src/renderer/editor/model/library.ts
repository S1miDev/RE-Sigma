// Libraries: another project's components (with the styles and variable collections they use) copied into this document.
// The copies are ordinary nodes, so instances, styles and variables work as always. Document.libraries keeps a map from the
// source's ids to the copies' ids, which is how an update finds them again.
import type { Collection, Document, Library, Node, Style } from '../../../shared/document'
import { makeNode, solid } from '../../../shared/document'
import { descendants, put, remove, topOrder } from './ops'
import { deleteStyle } from './styles'
import { detach } from './components'
import { deleteCollection, deleteMode, deleteVariable } from './variables'

const STYLE_LINKS = ['fillStyle', 'strokeStyle', 'effectStyle', 'textStyle', 'gridStyle'] as const
const PAGE_KEY = 'page' // the key of the library's page in `links`
const isMain = (n: Node) => !!(n.component || n.componentSet)
const MAX_LINKS = 20_000, MAX_LIBRARIES = 50 // must match validateLibraries in main/format/refig.ts

/** The outermost component or component set at or above `id`, or null. */
function mainRoot(src: Document, id: string): string | null {
  let top: string | null = null
  for (let n: Node | undefined = src.nodes[id]; n; n = n.parentId ? src.nodes[n.parentId] : undefined) if (isMain(n)) top = n.id
  return top
}

/** What importFromLibrary takes from `src`: its components, plus the components they instantiate. */
function reusableRoots(src: Document): string[] {
  const roots = new Set(Object.values(src.nodes).filter((n) => isMain(n) && mainRoot(src, n.id) === n.id).map((n) => n.id))
  for (const id of roots)
    for (const n of [src.nodes[id], ...descendants(src, id)]) {
      const used = n.instanceOf && mainRoot(src, n.instanceOf)
      if (used) roots.add(used) // a Set visited while growing also visits the additions
    }
  return [...roots]
}

/** The image hashes importFromLibrary's copies use (so only those need adopting). */
export function libraryImages(src: Document): Set<string> {
  const out = new Set<string>()
  for (const id of reusableRoots(src)) for (const n of [src.nodes[id], ...descendants(src, id)]) for (const p of [...n.fills, ...n.strokes]) if (p.type === 'IMAGE') out.add(p.hash)
  return out
}

/**
 * Copies `src`'s components into `doc` (on the page "Library: <name>"), or updates the copies made earlier. An update gives linked
 * items their library content again (local edits to them are lost), adds new ones and deletes the copies of items the library
 * no longer has. Image bytes are the caller's job.
 */
export function importFromLibrary(doc: Document, projectId: string, name: string, src: Document): Document {
  const prev = doc.libraries.find((l) => l.projectId === projectId)
  const roots = reusableRoots(src)
  if (!roots.length && !prev) throw new Error('This project has no components to use')

  const links = { ...prev?.links }, used = new Set<string>()
  const idOf = (s: string) => (used.add(s), (links[s] ??= crypto.randomUUID()))

  // the library's page
  const pageId = idOf(PAGE_KEY)
  if (!doc.nodes[pageId]) {
    const page = makeNode('PAGE', { id: pageId, name: `Library: ${name}`, fills: [solid(0.96, 0.96, 0.96)] })
    doc = { ...put(doc, [page]), pages: [...doc.pages, pageId] }
  } else if (prev && doc.nodes[pageId].name === `Library: ${prev.name}`) doc = put(doc, [{ ...doc.nodes[pageId], name: `Library: ${name}` }]) // the project was renamed; a page the user renamed stays

  // the nodes
  const copies: Node[] = []
  let nextX = Math.max(0, ...Object.values(doc.nodes).filter((n) => n.parentId === pageId).map((n) => n.x + n.width + 40))
  for (const rootId of roots) {
    const root = src.nodes[rootId], local = doc.nodes[links[rootId]]
    for (const n of [root, ...descendants(src, rootId)]) {
      const isRoot = n.id === rootId
      const out: Node = { ...n, id: idOf(n.id), parentId: isRoot ? pageId : idOf(n.parentId!) }
      if (isRoot) {
        // a root stays where the user put it; a new one goes to the right of the others
        Object.assign(out, local ? { x: local.x, y: local.y, order: local.order } : { x: nextX, y: 0, order: topOrder(doc, pageId) })
        if (!local) nextX += n.width + 40
      }
      if (n.instanceOf) out.instanceOf = idOf(n.instanceOf)
      if (n.ref) out.ref = idOf(n.ref)
      for (const k of STYLE_LINKS) if (n[k]) out[k] = idOf(n[k]!)
      if (n.bindings) out.bindings = Object.fromEntries(Object.entries(n.bindings).map(([f, v]) => [f, idOf(v)]))
      if (n.modes) out.modes = Object.fromEntries(Object.entries(n.modes).map(([c, m]) => [idOf(c), idOf(m)]))
      // shortcut: prototype links point at frames that aren't copied, so they are dropped; upgrade by remapping targets inside the copy
      delete out.interactions
      delete out.flowStart
      copies.push(out)
    }
  }

  // the styles and collections the copies use
  const styleIds = new Set(copies.flatMap((c) => STYLE_LINKS.map((k) => c[k]!).filter(Boolean)))
  const boundVars = new Set(copies.flatMap((n) => Object.values(n.bindings ?? {}))), modeCols = new Set(copies.flatMap((n) => Object.keys(n.modes ?? {})))
  const usedStyles = src.styles.filter((s) => styleIds.has(links[s.id]))
  const usedCollections = src.collections.filter((c) => modeCols.has(links[c.id]) || c.variables.some((v) => boundVars.has(links[v.id])))
  const styles: Style[] = usedStyles.map((s) => ({ ...s, id: idOf(s.id) }))
  const collections: Collection[] = usedCollections.map((c) => ({
    ...c,
    id: idOf(c.id),
    modes: c.modes.map((m) => ({ ...m, id: idOf(m.id) })),
    variables: c.variables.map((v) => ({ ...v, id: idOf(v.id), values: Object.fromEntries(Object.entries(v.values).map(([m, x]) => [idOf(m), x])) }) as typeof v),
  }))
  const upsert = <T extends { id: string }>(all: T[], items: T[]) => [...all.map((a) => items.find((i) => i.id === a.id) ?? a), ...items.filter((i) => !all.some((a) => a.id === i.id))]

  // copies of things the library no longer has
  const inSrc = new Set([...src.styles.map((s) => s.id), ...src.collections.flatMap((c) => [c.id, ...c.variables.map((v) => v.id), ...c.modes.map((m) => m.id)])])
  const gone: string[] = [], keep: Record<string, string> = {}
  for (const [s, l] of Object.entries(prev?.links ?? {})) {
    if (used.has(s)) continue
    if (doc.nodes[l]) gone.push(l)
    else if (doc.styles.some((x) => x.id === l) && !inSrc.has(s)) doc = deleteStyle(doc, l) // also unlinks the user's nodes
    else if (doc.collections.some((x) => x.id === l) && !inSrc.has(s)) doc = deleteCollection(doc, l)
    // still in the library, just unused by a component right now; its variables and modes keep their ids so the user's bindings survive
    else if (inSrc.has(s)) keep[s] = l
  }

  // the user's instances of a component that is going away keep their content as plain frames
  const goneIds = new Set(gone)
  for (const n of Object.values(doc.nodes)) if (n.instanceOf && goneIds.has(n.instanceOf) && !goneIds.has(n.id) && doc.nodes[n.id]?.instanceOf) doc = detach(doc, n.id)
  doc = remove(put(doc, copies), gone)
  // variables and modes the library dropped from a collection it still has: unbind/unset them on the user's nodes before upsert replaces the collection
  for (const c of collections) {
    const old = doc.collections.find((x) => x.id === c.id)
    for (const v of old?.variables ?? []) if (!c.variables.some((x) => x.id === v.id)) doc = deleteVariable(doc, v.id)
    for (const m of old?.modes ?? []) if (!c.modes.some((x) => x.id === m.id)) doc = deleteMode(doc, c.id, m.id)
  }
  const lib: Library = { projectId, name, links: { ...Object.fromEntries([...used].map((s) => [s, links[s]])), ...keep } }
  // the same limits validateLibraries enforces on save
  if (Object.keys(lib.links).length > MAX_LINKS) throw new Error(`This library is too large (more than ${MAX_LINKS} components, styles and variables)`)
  if (!prev && doc.libraries.length >= MAX_LIBRARIES) throw new Error(`A project can use at most ${MAX_LIBRARIES} libraries`)
  return {
    ...doc,
    styles: upsert(doc.styles, styles),
    collections: upsert(doc.collections, collections),
    libraries: prev ? doc.libraries.map((l) => (l === prev ? lib : l)) : [...doc.libraries, lib],
  }
}

/** Forgets the link; the copies stay as ordinary components. */
export const removeLibrary = (doc: Document, projectId: string): Document => ({ ...doc, libraries: doc.libraries.filter((l) => l.projectId !== projectId) })
