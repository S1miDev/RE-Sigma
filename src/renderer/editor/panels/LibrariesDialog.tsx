import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '../../../shared/api'
import { Button, Dialog, DialogActions } from '../../ui'
import { errorText } from '../../util'
import { importFromLibrary, libraryImages, removeLibrary } from '../model/library'
import { adoptImages } from '../projectContent'
import { useEditor, useStore } from '../store'

/** File > Libraries: use another project's components, styles and variables here, and update them when that project changes. */
export function LibrariesDialog({ onClose }: { onClose(): void }) {
  const store = useStore(), { api, id } = store
  const linked = useEditor((s) => s.doc.libraries)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => void api.listProjects().then((p) => setProjects(p.filter((x) => x.id && x.id !== id)), (e) => setError(errorText(e))), [api, id])

  const use = useCallback(async (p: { id: string; name: string }) => {
    setBusy(true)
    setError(null)
    try {
      const lib = await api.readLibrary(p.id), used = libraryImages(lib.document)
      await adoptImages(store, { ...lib, images: Object.fromEntries(Object.entries(lib.images).filter(([h]) => used.has(h))) })
      store.update((d) => importFromLibrary(d, p.id, p.name, lib.document))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [api, store])

  const gone = linked.filter((l) => projects && !projects.some((p) => p.id === l.projectId)) // the library project was deleted
  const rows = [...(projects ?? []).map((p) => ({ id: p.id, name: p.name, missing: false })), ...gone.map((l) => ({ id: l.projectId, name: l.name, missing: true }))]
  return (
    <Dialog title="Libraries" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <p className="text-dim">Add another project to copy its components, styles and variables into this one. Update brings in what changed in that project since you last saved it.</p>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <ul aria-label="Projects" className="flex max-h-72 flex-col gap-1 overflow-auto">
          {rows.map((r) => {
            const isLinked = linked.some((l) => l.projectId === r.id)
            return (
              <li key={r.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{r.name}{r.missing && <span className="text-dim"> (project not found)</span>}</span>
                {!r.missing && <Button disabled={busy} aria-label={`${isLinked ? 'Update' : 'Add'} ${r.name}`} onClick={() => void use(r)}>{isLinked ? 'Update' : 'Add'}</Button>}
                {isLinked && <Button disabled={busy} aria-label={`Remove ${r.name}`} onClick={() => store.update((d) => removeLibrary(d, r.id))}>Remove</Button>}
              </li>
            )
          })}
          {projects?.length === 0 && !gone.length && <li className="text-dim">There are no other projects.</li>}
        </ul>
        <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
      </div>
    </Dialog>
  )
}
