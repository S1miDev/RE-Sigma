// Bulk rename and find & replace: pure functions from a document to new names / new text.
import type { Document } from '../../../shared/document'
import { splice } from './richText'
import { topLevel } from './ops'

export interface RenameOptions { pattern: string; start: number; find: string; replace: string; matchCase: boolean }

/** Replaces every occurrence of `find` (literal) in `text`. An empty `find` matches nothing. */
export const replaceText = (text: string, find: string, replace: string, matchCase: boolean) =>
  find ? text.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi'), () => replace) : text

/**
 * New names for `ids` in the order given. `{name}` is the old name, `{n}` counts from `start`, `{parent}` is the parent's name;
 * the find/replace then runs on the result. An empty result keeps the old name.
 */
export function renamed(doc: Document, ids: string[], o: RenameOptions): Record<string, string> {
  const out: Record<string, string> = {}
  ids.filter((id) => doc.nodes[id] && doc.nodes[id].type !== 'PAGE').forEach((id, i) => {
    const n = doc.nodes[id], parent = n.parentId ? doc.nodes[n.parentId]?.name ?? '' : ''
    const named = o.pattern.replace(/\{(name|n|parent)\}/g, (_, k) => (k === 'name' ? n.name : k === 'n' ? String(o.start + i) : parent))
    out[id] = replaceText(named, o.find, o.replace, o.matchCase).trim() || n.name
  })
  return out
}

/** Selection in layer order, so `{n}` numbers top to bottom as the layers panel reads. */
export const renameOrder = (doc: Document, selection: string[]) => topLevel(doc, selection.filter((id) => doc.nodes[id]))

/** Text layers (of `ids`' subtrees, or all of the page) whose characters contain `find`, with the text after replacing. */
export function replaceInText(doc: Document, ids: string[], find: string, replace: string, matchCase: boolean) {
  const out: Record<string, { characters: string; runs: ReturnType<typeof splice>['runs']; name?: string }> = {}
  if (!find) return out
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
  for (const id of ids) {
    const n = doc.nodes[id]
    if (n?.type !== 'TEXT' || !n.characters) continue
    const hits = [...n.characters.matchAll(re)]
    if (!hits.length) continue
    let cur: Pick<typeof n, 'characters' | 'runs'> = n
    for (const m of hits.reverse()) { // from the end, so earlier offsets stay valid
      const s = splice(cur, m.index!, m.index! + m[0].length, replace)
      cur = { characters: s.characters, runs: s.runs.length ? s.runs : undefined }
    }
    const old = n.characters, named = n.name === 'Text' || n.name === old.split('\n')[0].slice(0, 40)
    out[id] = { characters: cur.characters!, runs: cur.runs ?? [], ...(named && cur.characters && { name: cur.characters.split('\n')[0].slice(0, 40) }) }
  }
  return out
}
