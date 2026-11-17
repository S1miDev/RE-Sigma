import { useCallback, useEffect, useState } from 'react'
import type { VersionInfo } from '../../../shared/api'
import { Button, Dialog, DialogActions, Input, Row } from '../../ui'
import { errorText, relativeTime } from '../../util'
import { adoptImages } from '../projectContent'
import { useStore } from '../store'

/** File > Version history: named versions, the automatic ones, and restoring one (a single undo step). */
export function VersionsDialog({ onClose }: { onClose(): void }) {
  const store = useStore(), { api, id } = store
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [name, setName] = useState(''), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const run = useCallback(async (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => void run(async () => setVersions(await api.listVersions(id))), [api, id, run])

  const save = () => run(async () => {
    setVersions(await api.saveVersion(id, name, store.get().doc))
    setName('')
  })
  const restore = (v: VersionInfo) => run(async () => {
    const content = await api.getVersion(id, v.id)
    await adoptImages(store, content)
    await api.saveVersion(id, 'Before restore', store.get().doc, true) // what is on screen now stays reachable (auto: never blocked by the cap)
    store.update(() => content.document)
    const { doc, pageId } = store.get()
    store.set({ selection: [], pageId: doc.pages.includes(pageId) ? pageId : doc.pages[0], toast: 'Version restored. Undo brings the previous state back.' })
    onClose()
  })
  const remove = (v: VersionInfo) => run(async () => setVersions(await api.deleteVersion(id, v.id)))

  return (
    <Dialog title="Version history" onClose={onClose}>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save() }}>
        <Row>
          <Input autoFocus aria-label="Version name" className="min-w-0 flex-1" placeholder="Name this version" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>Save version</Button>
        </Row>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <ul aria-label="Versions" className="flex max-h-72 flex-col gap-1 overflow-auto">
          {versions?.map((v) => (
            <li key={v.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{v.name ?? 'Autosave'} <span className="text-dim">{relativeTime(v.at)}</span></span>
              <Button disabled={busy} aria-label={`Restore ${v.name ?? 'autosave'}`} onClick={() => void restore(v)}>Restore</Button>
              <Button disabled={busy} aria-label={`Delete ${v.name ?? 'autosave'}`} onClick={() => void remove(v)}>Delete</Button>
            </li>
          ))}
          {versions?.length === 0 && <li className="text-dim">No versions yet. Autosaves appear here as you work.</li>}
        </ul>
        <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
      </form>
    </Dialog>
  )
}
