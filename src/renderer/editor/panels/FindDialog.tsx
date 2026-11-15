import { useMemo, useState } from 'react'
import { Button, Dialog, DialogActions, Input, Row, Select } from '../../ui'
import { descendants, patch, topLevel } from '../model/ops'
import { replaceInText, replaceText } from '../model/rename'
import { useStore } from '../store'

/** Ctrl+F: find and replace in the text of text layers, or in layer names, over the selection (or the page when nothing is selected). One undo step. */
export function FindDialog({ onClose }: { onClose(): void }) {
  const store = useStore()
  const [find, setFind] = useState(''), [replace, setReplace] = useState(''), [matchCase, setMatchCase] = useState(false), [target, setTarget] = useState<'text' | 'names'>('text')
  const { doc, pageId, selection } = store.get()
  const scope = useMemo(() => {
    const roots = topLevel(doc, selection)
    return roots.length ? roots.flatMap((id) => [id, ...descendants(doc, id).map((n) => n.id)]) : descendants(doc, pageId).map((n) => n.id)
  }, [doc, pageId, selection])
  const hits = useMemo(() => {
    if (target === 'text') return Object.keys(replaceInText(doc, scope, find, replace, matchCase))
    return scope.filter((id) => replaceText(doc.nodes[id].name, find, replace, matchCase) !== doc.nodes[id].name)
  }, [doc, scope, find, replace, matchCase, target])
  const apply = () => {
    if (!hits.length) return
    if (target === 'text') {
      const out = replaceInText(doc, scope, find, replace, matchCase)
      store.update((d) => hits.reduce((acc, id) => patch(acc, [id], { characters: out[id].characters, runs: out[id].runs.length ? out[id].runs : undefined, ...(out[id].name && { name: out[id].name }) }), d))
    } else store.update((d) => hits.reduce((acc, id) => patch(acc, [id], { name: replaceText(d.nodes[id].name, find, replace, matchCase) || d.nodes[id].name }), d))
    onClose()
  }
  return (
    <Dialog title="Find and replace" onClose={onClose}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); apply() }}>
        <Input autoFocus aria-label="Find" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
        <Input aria-label="Replace with" placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <Row>
          <Select aria-label="Search in" className="flex-1" value={target} onChange={(e) => setTarget(e.target.value as 'text' | 'names')}>
            <option value="text">Text content</option>
            <option value="names">Layer names</option>
          </Select>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        </Row>
        <p role="status" className="text-dim">{find ? `${hits.length} layer${hits.length === 1 ? '' : 's'} match${selection.length ? ' in the selection' : ' on this page'}` : selection.length ? 'Searching the selection.' : 'Searching this page.'}</p>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!hits.length}>Replace all</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
