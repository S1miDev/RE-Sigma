import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ConflictChoice, ImportResult, Omitted, ProjectSummary, RefigApi } from '../../shared/api'
import { Button, Dialog, DialogActions, EmptyState, Icon, Input, Menu, Toast } from '../ui'
import { errorText, relativeTime } from '../util'

type State = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; projects: ProjectSummary[] }

export function omittedText(o: Omitted): string {
  const total = Object.values(o).reduce((a, b) => a + b, 0)
  return `${total} ${total === 1 ? 'item' : 'items'} omitted: ${Object.entries(o).map(([k, n]) => `${k} ×${n}`).join(', ')}`
}
function resultText(r: ImportResult): string {
  if (r.status === 'imported') return r.omitted ? `Imported as “${r.summary.name}” with ${omittedText(r.omitted)}` : `Imported as “${r.summary.name}”`
  if (r.status === 'cancelled') return 'Skipped'
  return r.status === 'error' ? r.error : ''
}

export function Home({ api, onOpen }: { api: RefigApi; onOpen(id: string): void }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [imports, setImports] = useState<ImportResult[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () => api.listProjects().then((projects) => setState({ status: 'ready', projects }), (e) => setState({ status: 'error', error: errorText(e) })),
    [api],
  )
  useEffect(() => void load(), [load])
  const clearToast = useCallback(() => setToast(null), [])

  /** Runs an action, shows its error as a toast, and refreshes the list. */
  const run = async (action: () => Promise<string | void>) => {
    setBusy(true)
    try {
      const message = await action()
      if (message) setToast(message)
    } catch (e) {
      setToast(errorText(e))
    }
    setBusy(false)
    await load()
  }

  const create = () => run(async () => onOpen((await api.createProject('Untitled')).id))
  const importFiles = () =>
    run(async () => {
      const results = await api.importProjects()
      if (!results.length) return
      if (results.every((r) => r.status === 'imported' && !r.omitted)) return `Imported ${results.length} ${results.length === 1 ? 'project' : 'projects'}`
      setImports(results)
    })
  const resolve = async (token: string, choice: ConflictChoice) => {
    let result: ImportResult
    try {
      result = await api.resolveImportConflict(token, choice)
    } catch (e) {
      result = { file: imports?.find((r) => r.status === 'conflict' && r.token === token)?.file ?? '', status: 'error', error: errorText(e) }
    }
    setImports((list) => list && list.map((r) => (r.status === 'conflict' && r.token === token ? result : r)))
    await load()
  }
  const conflict = imports?.find((r) => r.status === 'conflict')

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <h1 className="text-sm font-semibold">Projects</h1>
        <div className="flex gap-2">
          <Button onClick={importFiles} disabled={busy}>Import</Button>
          <Button variant="primary" onClick={create} disabled={busy}><Icon name="plus" />New project</Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-6">
        {state.status === 'loading' && (
          <ul aria-busy="true" aria-label="Loading projects" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {Array.from({ length: 6 }, (_, i) => <li key={i} className="h-52 animate-pulse rounded-lg bg-panel" />)}
          </ul>
        )}
        {state.status === 'error' && (
          <div className="grid h-full place-items-center">
            <EmptyState title="Can't read the projects folder" text={state.error}>
              <Button variant="primary" onClick={() => { setState({ status: 'loading' }); void load() }}>Retry</Button>
            </EmptyState>
          </div>
        )}
        {state.status === 'ready' && !state.projects.length && (
          <div className="grid h-full place-items-center">
            <EmptyState title="No projects yet" text="Create a project or import a .refig or Figma .fig file.">
              <Button variant="primary" onClick={create} disabled={busy}>New project</Button>
              <Button onClick={importFiles} disabled={busy}>Import</Button>
            </EmptyState>
          </div>
        )}
        {state.status === 'ready' && state.projects.length > 0 && (
          <ul aria-label="Projects" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {state.projects.map((p) => (
              <li key={p.id || `damaged:${p.name}`} className="relative rounded-lg border border-line bg-panel">
                {p.damaged ? (
                  <div className="flex h-full flex-col">
                    <div className="grid h-40 place-items-center rounded-t-lg bg-canvas text-danger">Damaged file</div>
                    <div className="p-3">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-dim">{p.damaged}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" aria-label={`Open ${p.name}`} onClick={() => onOpen(p.id)} className="block w-full rounded-lg text-left outline-offset-[-1px]">
                      <div className="grid h-40 place-items-center overflow-hidden rounded-t-lg bg-canvas">
                        {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover" /> : <Icon name="page" className="scale-[2.5] text-line" />}
                      </div>
                      <div className="p-3 pr-9">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="text-dim">Edited {relativeTime(p.modifiedAt)}</div>
                      </div>
                    </button>
                    <div className="absolute bottom-3 right-2">
                      <Menu label={`Actions for ${p.name}`} align="right" items={[
                        { label: 'Open', onSelect: () => onOpen(p.id) },
                        { label: 'Rename…', onSelect: () => setRenaming(p) },
                        { label: 'Duplicate', onSelect: () => run(async () => void (await api.duplicateProject(p.id))) },
                        { label: 'Export…', onSelect: () => run(async () => { const r = await api.exportProject(p.id); return r ? `Exported to ${r.path}` : undefined }) },
                        null,
                        { label: 'Delete…', danger: true, onSelect: () => setDeleting(p) },
                      ]}>
                        <Icon name="more" />
                      </Menu>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {renaming && <RenameDialog project={renaming} api={api} onClose={() => { setRenaming(null); void load() }} />}
      {deleting && (
        <Dialog title={`Delete “${deleting.name}”?`} onClose={() => setDeleting(null)}>
          <p className="text-dim">The file moves to the Recycle Bin, so you can restore it from there.</p>
          <DialogActions>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { const p = deleting; setDeleting(null); void run(() => api.deleteProject(p.id)) }}>Delete</Button>
          </DialogActions>
        </Dialog>
      )}
      {imports && conflict?.status === 'conflict' && (
        <Dialog title={`“${conflict.name}” already exists`} onClose={() => void resolve(conflict.token, 'cancel')}>
          <p className="text-dim">Importing {conflict.file} would clash with a project you already have. Replace moves the existing project to the Recycle Bin.</p>
          <DialogActions>
            <Button onClick={() => void resolve(conflict.token, 'cancel')}>Cancel</Button>
            <Button onClick={() => void resolve(conflict.token, 'keepBoth')}>Keep both</Button>
            <Button variant="danger" onClick={() => void resolve(conflict.token, 'replace')}>Replace</Button>
          </DialogActions>
        </Dialog>
      )}
      {imports && !conflict && (
        <Dialog title="Import results" onClose={() => setImports(null)}>
          <ul className="flex max-h-72 flex-col gap-2 overflow-auto">
            {imports.map((r, i) => (
              <li key={i}>
                <div className="font-medium">{r.file}</div>
                <div className={r.status === 'error' ? 'text-danger' : 'text-dim'}>{resultText(r)}</div>
              </li>
            ))}
          </ul>
          <DialogActions><Button variant="primary" onClick={() => setImports(null)}>Done</Button></DialogActions>
        </Dialog>
      )}
      {toast && <Toast message={toast} onDone={clearToast} />}
    </div>
  )
}

function RenameDialog({ project, api, onClose }: { project: ProjectSummary; api: RefigApi; onClose(): void }) {
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.renameProject(project.id, name)
      onClose()
    } catch (err) {
      setError(errorText(err))
    }
  }
  return (
    <Dialog title="Rename project" onClose={onClose}>
      <form onSubmit={submit}>
        <Input aria-label="Project name" autoFocus className="w-full" value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setError(null) }} onFocus={(e) => e.currentTarget.select()} aria-invalid={error !== null} />
        {error && <p role="alert" className="mt-1.5 text-danger">{error}</p>}
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>Rename</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
