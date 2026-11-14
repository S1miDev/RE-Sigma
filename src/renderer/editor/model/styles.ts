// Styles: named fills, text looks and effects that nodes link to. A linked node's real fields always hold the style's value
// (resolveStyles copies it), so renderers and exporters never know styles exist.
import { TEXT_STYLE_FIELDS, type Document, type Node, type Style } from '../../../shared/document'
import { patch } from './ops'

/** A node's link field, the fields it keeps in step, and the kind of style it takes. */
export const LINKS = {
  fillStyle: { fields: ['fills'], kind: 'FILL' },
  strokeStyle: { fields: ['strokes'], kind: 'FILL' },
  effectStyle: { fields: ['effects'], kind: 'EFFECT' },
  textStyle: { fields: TEXT_STYLE_FIELDS, kind: 'TEXT' },
} as const satisfies Record<string, { fields: readonly (keyof Node)[]; kind: Style['kind'] }>
export type Link = keyof typeof LINKS
const LINK_KEYS = Object.keys(LINKS) as Link[]

type Fields = Partial<Record<keyof Node, unknown>>
/** The linked fields of a node, every key present (undefined when unset). */
const read = (n: Node, link: Link): Fields => Object.fromEntries(LINKS[link].fields.map((f) => [f, n[f]]))
/** What a style puts on a node through `link`. */
function valueOf(s: Style, link: Link): Fields {
  if (link === 'fillStyle') return { fills: s.value }
  if (link === 'strokeStyle') return { strokes: s.value }
  if (link === 'effectStyle') return { effects: s.value }
  return Object.fromEntries(TEXT_STYLE_FIELDS.map((f) => [f, (s.value as Fields)[f]]))
}
const same = (a: Fields, b: Fields) => JSON.stringify(a) === JSON.stringify(b)
const isInstanceNode = (n: Node) => !!(n.ref || n.instanceOf)

/** `n` with `values` written onto it; an undefined value removes the field. */
function write(n: Node, values: Fields): Node {
  const out: Record<string, unknown> = { ...n }
  for (const [k, v] of Object.entries(values)) if (v === undefined) delete out[k]; else out[k] = v
  return out as unknown as Node
}

/**
 * Brings linked nodes in line with their styles. A node whose linked fields were edited by hand since `prev`
 * (with the same link and the same style) is detached instead, keeping what the user made. Instance nodes take
 * only the links they override; the rest arrives from the main component through syncInstances.
 */
export function resolveStyles(prev: Document, next: Document, instances: boolean): Document {
  const byId = new Map(next.styles.map((s) => [s.id, s])), before = new Map(prev.styles.map((s) => [s.id, s]))
  const out: Node[] = []
  for (const n of Object.values(next.nodes)) {
    if (isInstanceNode(n) !== instances) continue
    let cur = n
    for (const link of LINK_KEYS) {
      const id = n[link]
      if (id === undefined || (instances && !n.overrides?.includes(link))) continue
      const s = byId.get(id), p = prev.nodes[n.id]
      if (!s || s.kind !== LINKS[link].kind) { cur = write(cur, { [link]: undefined }); continue } // dangling: keep the values, drop the link
      const want = valueOf(s, link)
      if (same(read(cur, link), want)) continue
      const edited = !instances && p && p !== n && p[link] === id && before.get(id) === s && same(read(p, link), read(n, link)) === false
      cur = edited ? write(cur, { [link]: undefined }) : write(cur, want)
    }
    if (cur !== n) out.push(cur)
  }
  return out.length ? { ...next, nodes: { ...next.nodes, ...Object.fromEntries(out.map((n) => [n.id, n])) } } : next
}

const linkedFields = (link: Link) => [link, ...LINKS[link].fields] as string[]

/** Links nodes to a style. On instance nodes the link and its fields become overrides, so the main's values don't come back. */
export function applyStyle(doc: Document, ids: string[], styleId: string, link: Link): Document {
  const s = doc.styles.find((x) => x.id === styleId)
  if (!s || s.kind !== LINKS[link].kind) return doc
  return patch(doc, ids, (n) => ({
    [link]: styleId,
    ...(isInstanceNode(n) && { overrides: [...new Set([...(n.overrides ?? []), ...linkedFields(link)])] }),
  }))
}

/** Unlinks nodes from their style, keeping the look they have now. */
export const detachStyle = (doc: Document, ids: string[], link: Link): Document =>
  patch(doc, ids, (n) => (n[link] === undefined ? {} : { [link]: undefined }))

/** A new style taking its value from a node's current look; that node links to it. */
export function createStyle(doc: Document, nodeId: string, link: Link, name: string, id: string = crypto.randomUUID()): Document {
  const n = doc.nodes[nodeId]
  if (!n) return doc
  const style = { id, name, kind: LINKS[link].kind, value: styleValue(n, link) } as Style
  return applyStyle({ ...doc, styles: [...doc.styles, style] }, [nodeId], id, link)
}

function styleValue(n: Node, link: Link): Style['value'] {
  if (link === 'fillStyle') return n.fills
  if (link === 'strokeStyle') return n.strokes
  if (link === 'effectStyle') return n.effects
  return Object.fromEntries(TEXT_STYLE_FIELDS.filter((f) => n[f] !== undefined).map((f) => [f, n[f]]))
}

/** Replaces a style's value with a node's current look; every linked node follows. */
export function updateStyleFrom(doc: Document, styleId: string, nodeId: string, link: Link): Document {
  const n = doc.nodes[nodeId], s = doc.styles.find((x) => x.id === styleId)
  if (!n || !s || s.kind !== LINKS[link].kind) return doc
  return { ...doc, styles: doc.styles.map((x) => (x === s ? ({ ...s, value: styleValue(n, link) } as Style) : x)) }
}

export const renameStyle = (doc: Document, styleId: string, name: string): Document =>
  ({ ...doc, styles: doc.styles.map((s) => (s.id === styleId ? { ...s, name } : s)) })

/** Removes a style; nodes that used it keep their look. */
export function deleteStyle(doc: Document, styleId: string): Document {
  const nodes = Object.values(doc.nodes).filter((n) => LINK_KEYS.some((l) => n[l] === styleId))
  const cleared = nodes.map((n) => LINK_KEYS.reduce((m, l) => (m[l] === styleId ? write(m, { [l]: undefined }) : m), n))
  return { ...doc, styles: doc.styles.filter((s) => s.id !== styleId), nodes: { ...doc.nodes, ...Object.fromEntries(cleared.map((n) => [n.id, n])) } }
}
