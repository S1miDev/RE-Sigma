import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OpenedProject, RefigApi } from '../../shared/api'
import { Button, Dialog, DialogActions, IconButton, Menu, SidePanel, Toast } from '../ui'
import { errorText, keyBelongsToPage } from '../util'
import { Canvas } from './canvas/Canvas'
import { paste, pasteImage } from './clipboard'
import { COMMANDS, handleKey, isEnabled, type Actions } from './commands'
import { DesignPanel } from './panels/DesignPanel'
import { ExportControls } from './panels/ExportControls'
import { LeftPanel } from './panels/LeftPanel'
import { MainMenu } from './panels/MainMenu'
import { Toolbar } from './panels/Toolbar'
import { createEditorStore, EditorContext, useEditor, useStore } from './store'

const SAVE_TEXT = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' }

export function Editor({ opened, api, onExit }: { opened: OpenedProject; api: RefigApi; onExit(): void }) {
  const [store] = useState(() => createEditorStore(opened, api))
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState<'exit' | 'close' | null>(null) // a save failed while leaving
  const force = useRef(false)
  useEffect(() => {
    store.attach()
    return () => store.dispose()
  }, [store])

  // Leaving the editor saves first. If that fails the user decides; nothing is dropped silently.
  const back = useCallback(async () => {
    if (await store.save()) onExit()
    else setUnsaved('exit')
  }, [store, onExit])
  const actions = useMemo<Actions>(() => ({ back: () => void back(), openExport: () => setExporting(true) }), [back])
  const report = useCallback((e: unknown) => setToast(errorText(e)), [])
  const clearToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keyBelongsToPage(e) && handleKey(e, store, actions)) e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (keyBelongsToPage(e)) return
      e.preventDefault()
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      void (image ? pasteImage(store, image) : paste(store)).catch(report)
    }
    // Closing the window waits for the save. Electron cancels the close when beforeunload is prevented.
    const onUnload = (e: BeforeUnloadEvent) => {
      if (force.current || !store.isDirty()) return
      e.preventDefault()
      e.returnValue = false
      void store.save().then((ok) => (ok ? window.close() : setUnsaved('close')))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [store, actions, report])

  return (
    <EditorContext.Provider value={store}>
      <Layout actions={actions} report={report} />
      {exporting && (
        <Dialog title="Export selection" onClose={() => setExporting(false)}>
          <ExportControls onDone={(path) => { setExporting(false); if (path) setToast(`Exported to ${path}`) }} onError={report} />
        </Dialog>
      )}
      {unsaved && (
        <Dialog title="Your changes couldn't be saved" onClose={() => setUnsaved(null)}>
          <p className="text-dim">{store.get().saveError ?? 'The project file could not be written.'} If you leave now, the changes since the last save are lost.</p>
          <DialogActions>
            <Button variant="danger" onClick={() => { force.current = true; if (unsaved === 'close') window.close(); else onExit() }}>Leave without saving</Button>
            <Button variant="primary" onClick={() => setUnsaved(null)}>Keep editing</Button>
          </DialogActions>
        </Dialog>
      )}
      {toast && <Toast message={toast} onDone={clearToast} />}
    </EditorContext.Provider>
  )
}

function Layout({ actions, report }: { actions: Actions; report(e: unknown): void }) {
  const hidden = useEditor((s) => s.uiHidden)
  return (
    <div className="flex h-full flex-col">
      {!hidden && <TopBar actions={actions} />}
      <div className="flex min-h-0 flex-1">
        {!hidden && <SidePanel side="left" label="Pages and layers"><LeftPanel /></SidePanel>}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {!hidden && <Toolbar />}
        </main>
        {!hidden && <SidePanel side="right" label="Design"><DesignPanel report={report} /></SidePanel>}
      </div>
    </div>
  )
}

function TopBar({ actions }: { actions: Actions }) {
  const store = useStore()
  const name = useEditor((s) => s.name), save = useEditor((s) => s.save), saveError = useEditor((s) => s.saveError), zoom = useEditor((s) => s.view.zoom)
  useEditor((s) => s.selection) // zoom-to-selection enables with a selection
  const [renaming, setRenaming] = useState<{ value: string; error?: string } | null>(null)

  const rename = async () => {
    if (!renaming) return
    if (renaming.value.trim() === name) return setRenaming(null)
    try {
      await store.save() // the rename rewrites the file; make sure it holds the latest document first
      store.set({ name: (await store.api.renameProject(store.id, renaming.value)).name })
      setRenaming(null)
    } catch (e) {
      setRenaming({ value: renaming.value, error: errorText(e) })
    }
  }

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <MainMenu actions={actions} />
      <IconButton label="Back to projects" icon="back" onClick={actions.back} />
      {renaming ? (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename() }}>
          <input
            autoFocus
            aria-label="Project name"
            aria-invalid={!!renaming.error}
            className="h-6 w-56 rounded border border-accent bg-canvas px-1.5 outline-none"
            maxLength={100}
            value={renaming.value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRenaming({ value: e.target.value })}
            onBlur={() => void rename()}
            onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
          />
          {renaming.error && <span role="alert" className="text-danger">{renaming.error}</span>}
        </form>
      ) : (
        <button type="button" title="Rename project" className="max-w-72 truncate rounded px-1.5 py-1 font-medium hover:bg-hover" onClick={() => setRenaming({ value: name })}>{name}</button>
      )}
      <span role="status" title={saveError} className={save === 'error' ? 'text-danger' : 'text-dim'}>{SAVE_TEXT[save]}</span>
      <div className="flex-1" />
      <Menu label="Zoom" align="right" className="px-2" items={COMMANDS.filter((c) => c.id.startsWith('zoom-')).map((c) => ({
        label: c.label, shortcut: c.keys?.[0], disabled: !isEnabled(c, store), onSelect: () => c.run(store, actions),
      }))}>
        {Math.round(zoom * 100)}%
      </Menu>
    </header>
  )
}
