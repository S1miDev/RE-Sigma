import { useMemo, useState } from 'react'
import { Button, Dialog, DialogActions, Input, Row } from '../../ui'
import { patch } from '../model/ops'
import { renameOrder, renamed } from '../model/rename'
import { useStore } from '../store'

/** Ctrl+F2: rename the selected layers from a pattern ({name}, {n}, {parent}) and an optional find/replace, as one undo step. */
export function RenameDialog({ onClose }: { onClose(): void }) {
  const store = useStore()
  const [pattern, setPattern] = useState('{name}'), [start, setStart] = useState(1), [find, setFind] = useState(''), [replace, setReplace] = useState(''), [matchCase, setMatchCase] = useState(false)
  const names = useMemo(() => {
    const { doc, selection } = store.get()
    return renamed(doc, renameOrder(doc, selection), { pattern, start, find, replace, matchCase })
  }, [store, pattern, start, find, replace, matchCase])
  const ids = Object.keys(names), doc = store.get().doc
  const apply = () => {
    store.update((d) => ids.reduce((acc, id) => patch(acc, [id], { name: names[id] }), d))
    onClose()
  }
  return (
    <Dialog title="Rename layers" onClose={onClose}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); apply() }}>
        <label className="flex flex-col gap-1">Name pattern ({'{name}'}, {'{n}'}, {'{parent}'})
          <Input autoFocus aria-label="Name pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </label>
        <Row>
          <label className="flex items-center gap-1.5">Start at <Input aria-label="Start number" type="number" className="w-16" value={start} onChange={(e) => setStart(Math.trunc(+e.target.value) || 0)} /></label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        </Row>
        <Row>
          <Input aria-label="Find in names" className="min-w-0 flex-1" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
          <Input aria-label="Replace with" className="min-w-0 flex-1" placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} />
        </Row>
        <ul aria-label="Preview" className="max-h-40 overflow-auto text-dim">
          {ids.slice(0, 8).map((id) => <li key={id} className="truncate">{doc.nodes[id].name} → {names[id]}</li>)}
          {ids.length > 8 && <li>…and {ids.length - 8} more</li>}
        </ul>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!ids.length}>Rename {ids.length} layer{ids.length === 1 ? '' : 's'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
