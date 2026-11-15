// Variables: named colors and numbers with one value per mode (Light/Dark...). A node binds a field to a variable
// (Node.bindings); resolveVariables copies the value for the node's mode onto that field, like styles do, so renderers
// and exporters never know variables exist. The mode comes from the nearest ancestor (or the node) that sets one.
import { isBindable, type Collection, type Color, type Document, type Node, type Variable } from '../../../shared/document'
import { patch } from './ops'

type Value = Color | number
type Found = { c: Collection; v: Variable }
const isInstanceNode = (n: Node) => !!(n.ref || n.instanceOf)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const index = (doc: Document) => new Map<string, Found>(doc.collections.flatMap((c) => c.variables.map((v): [string, Found] => [v.id, { c, v }])))

const getAt = (o: unknown, path: string[]): unknown => path.reduce<any>((v, k) => v?.[k], o) // eslint-disable-line @typescript-eslint/no-explicit-any
/** `o` with the value at `path` replaced (copying along the way); `o` itself when the path doesn't exist. */
function setAt<T>(o: T, path: string[], value: unknown): T {
  if (!path.length) return value as T
  const [k, ...rest] = path, child = (o as Record<string, unknown>)?.[k]
  if (child === undefined) return o
  const copy = (Array.isArray(o) ? [...o] : { ...o }) as Record<string, unknown>
  copy[k] = setAt(child, rest, value)
  return copy as T
}

/** The mode `n` shows for a collection: its own or its nearest ancestor's choice, else the first mode. */
export function modeOf(doc: Document, n: Node, c: Collection): string {
  for (let m: Node | undefined = n; m; m = m.parentId ? doc.nodes[m.parentId] : undefined) {
    const id = m.modes?.[c.id]
    if (id && c.modes.some((x) => x.id === id)) return id
  }
  return c.modes[0].id
}

/** What a binding puts on `n`; undefined when the variable is gone, doesn't fit the field, or has no value for the mode. */
function valueFor(doc: Document, found: Map<string, Found>, n: Node, key: string, id: string): Value | undefined {
  const f = found.get(id)
  return f && isBindable(key, f.v.type) ? (f.v.values as Record<string, Value>)[modeOf(doc, n, f.c)] : undefined
}

function unbound(n: Node, key: string): Node {
  const { [key]: _, ...rest } = n.bindings ?? {}
  const { bindings: __, ...node } = n
  return Object.keys(rest).length ? { ...node, bindings: rest } : node
}

/**
 * Brings bound fields in line with their variables. A field edited by hand since `prev` (same binding, same variable value)
 * is unbound instead, keeping what the user made. A dangling binding is dropped and the value kept. Instance nodes take
 * the bindings they inherit from the main on every pass, since their own ancestors may pick another mode; a field the
 * instance overrides stays its own unless the binding was overridden too.
 */
export function resolveVariables(prev: Document, next: Document, instances: boolean): Document {
  const now = index(next), before = index(prev), out: Node[] = []
  for (const n of Object.values(next.nodes)) {
    if (!n.bindings || isInstanceNode(n) !== instances) continue
    let cur = n
    for (const [key, id] of Object.entries(n.bindings)) {
      const path = key.split('.'), have = getAt(cur, path)
      if (instances && n.overrides?.includes(path[0]) && !n.overrides.includes('bindings')) continue
      const want = valueFor(next, now, n, key, id)
      if (want === undefined || have === undefined) { cur = unbound(cur, key); continue }
      if (same(have, want)) continue
      const p = prev.nodes[n.id], was = p && p !== n && p.bindings?.[key] === id ? valueFor(prev, before, p, key, id) : undefined
      const edited = !instances && was !== undefined && same(was, want) && same(getAt(p, path), was)
      cur = edited ? unbound(cur, key) : setAt(cur, path, want)
    }
    if (cur !== n) out.push(cur)
  }
  return out.length ? { ...next, nodes: { ...next.nodes, ...Object.fromEntries(out.map((n) => [n.id, n])) } } : next
}

// ── commands (Document → Document) ────────────────────────────────────────────────────────────────────────────────

const onCollection = (doc: Document, id: string, f: (c: Collection) => Collection): Document =>
  ({ ...doc, collections: doc.collections.map((c) => (c.id === id ? f(c) : c)) })
const onVariable = (doc: Document, id: string, f: (v: Variable) => Variable): Document =>
  ({ ...doc, collections: doc.collections.map((c) => ({ ...c, variables: c.variables.map((v) => (v.id === id ? f(v) : v)) })) })
const mapNodes = (doc: Document, f: (n: Node) => Node): Document => {
  const changed = Object.values(doc.nodes).map((n) => [n, f(n)] as const).filter(([a, b]) => a !== b)
  return changed.length ? { ...doc, nodes: { ...doc.nodes, ...Object.fromEntries(changed.map(([, n]) => [n.id, n])) } } : doc
}
const withoutBindings = (n: Node, ids: Set<string>) =>
  Object.entries(n.bindings ?? {}).reduce((m, [k, v]) => (ids.has(v) ? unbound(m, k) : m), n)
const withoutModes = (n: Node, drop: (collection: string, mode: string) => boolean): Node => {
  const keep = Object.entries(n.modes ?? {}).filter(([c, m]) => !drop(c, m))
  if (keep.length === Object.keys(n.modes ?? {}).length) return n
  const { modes: _, ...node } = n
  return keep.length ? { ...node, modes: Object.fromEntries(keep) } : node
}

export function createCollection(doc: Document, name: string, id: string = crypto.randomUUID(), modeId: string = crypto.randomUUID()): Document {
  return { ...doc, collections: [...doc.collections, { id, name, modes: [{ id: modeId, name: 'Mode 1' }], variables: [] }] }
}
export const renameCollection = (doc: Document, id: string, name: string) => onCollection(doc, id, (c) => ({ ...c, name }))

/** Removes a collection; bound fields keep their current value. */
export function deleteCollection(doc: Document, id: string): Document {
  const c = doc.collections.find((x) => x.id === id)
  if (!c) return doc
  const vars = new Set(c.variables.map((v) => v.id))
  return mapNodes({ ...doc, collections: doc.collections.filter((x) => x !== c) }, (n) => withoutModes(withoutBindings(n, vars), (cid) => cid === id))
}

/** A new mode starts as a copy of the first one. */
export function addMode(doc: Document, collectionId: string, name: string, id: string = crypto.randomUUID()): Document {
  return onCollection(doc, collectionId, (c) => ({
    ...c, modes: [...c.modes, { id, name }],
    variables: c.variables.map((v) => ({ ...v, values: { ...v.values, [id]: v.values[c.modes[0].id] } }) as Variable),
  }))
}
export const renameMode = (doc: Document, collectionId: string, modeId: string, name: string) =>
  onCollection(doc, collectionId, (c) => ({ ...c, modes: c.modes.map((m) => (m.id === modeId ? { ...m, name } : m)) }))

/** Removes a mode (a collection keeps at least one). Nodes that chose it fall back to the first mode. */
export function deleteMode(doc: Document, collectionId: string, modeId: string): Document {
  const c = doc.collections.find((x) => x.id === collectionId)
  if (!c || c.modes.length < 2 || !c.modes.some((m) => m.id === modeId)) return doc
  const cut = onCollection(doc, collectionId, (k) => ({
    ...k, modes: k.modes.filter((m) => m.id !== modeId),
    variables: k.variables.map((v) => ({ ...v, values: Object.fromEntries(Object.entries(v.values).filter(([m]) => m !== modeId)) }) as Variable),
  }))
  return mapNodes(cut, (n) => withoutModes(n, (cid, mid) => cid === collectionId && mid === modeId))
}

const DEFAULTS = { COLOR: { r: 0, g: 0, b: 0, a: 1 }, NUMBER: 0 }
export function createVariable(doc: Document, collectionId: string, type: Variable['type'], name: string, value?: Value, id: string = crypto.randomUUID()): Document {
  return onCollection(doc, collectionId, (c) => ({
    ...c, variables: [...c.variables, { id, name, type, values: Object.fromEntries(c.modes.map((m) => [m.id, value ?? DEFAULTS[type]])) } as Variable],
  }))
}
export const setVariableValue = (doc: Document, variableId: string, modeId: string, value: Value) =>
  onVariable(doc, variableId, (v) => (modeId in v.values && typeof value === typeof v.values[modeId] ? ({ ...v, values: { ...v.values, [modeId]: value } } as Variable) : v))
export const renameVariable = (doc: Document, variableId: string, name: string) => onVariable(doc, variableId, (v) => ({ ...v, name }))

/** Removes a variable; bound fields keep their current value. */
export function deleteVariable(doc: Document, variableId: string): Document {
  const gone = new Set([variableId])
  return mapNodes({ ...doc, collections: doc.collections.map((c) => ({ ...c, variables: c.variables.filter((v) => v.id !== variableId) })) }, (n) => withoutBindings(n, gone))
}

const overridden = (n: Node, ...fields: string[]) => (isInstanceNode(n) ? { overrides: [...new Set([...(n.overrides ?? []), ...fields])] } : {})

/** Binds `key` on nodes to a variable (wrong type or unknown key: nothing happens). On instance nodes the binding becomes an override. */
export function bindVariable(doc: Document, ids: string[], key: string, variableId: string): Document {
  const f = index(doc).get(variableId)
  if (!f || !isBindable(key, f.v.type)) return doc
  return patch(doc, ids, (n) => ({ bindings: { ...n.bindings, [key]: variableId }, ...overridden(n, 'bindings', key.split('.')[0]) }))
}
/** Unbinds nodes' field, keeping the value it has now. */
export const unbindVariable = (doc: Document, ids: string[], key: string): Document =>
  mapNodes(doc, (n) => (ids.includes(n.id) && n.bindings?.[key] ? unbound(n, key) : n))

/** A new variable taking its value (in every mode) from a node's field; that field binds to it. */
export function createVariableFrom(doc: Document, collectionId: string, nodeId: string, key: string, name: string, id: string = crypto.randomUUID()): Document {
  const n = doc.nodes[nodeId], value = getAt(n, key.split('.')) as Value | undefined
  if (!n || value === undefined) return doc
  const type = typeof value === 'number' ? 'NUMBER' : 'COLOR'
  return bindVariable(createVariable(doc, collectionId, type, name, value, id), [nodeId], key, id)
}

/** Picks a mode of a collection on nodes (and so on everything inside them); undefined goes back to inheriting. */
export function setMode(doc: Document, ids: string[], collectionId: string, modeId: string | undefined): Document {
  const c = doc.collections.find((x) => x.id === collectionId)
  if (!c || (modeId !== undefined && !c.modes.some((m) => m.id === modeId))) return doc
  return patch(doc, ids, (n) => {
    const { [collectionId]: _, ...rest } = n.modes ?? {}
    const modes = modeId === undefined ? rest : { ...rest, [collectionId]: modeId }
    return { modes: Object.keys(modes).length ? modes : undefined, ...overridden(n, 'modes') }
  })
}
