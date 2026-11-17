import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PluginUI } from './plugins/PluginUI'
import { refreshPlugins, stopPlugin } from './plugins/host'
import type { OpenedProject, RefigApi } from '../../shared/api'
import { Button, Dialog, DialogActions, IconButton, Menu, SidePanel, Toast } from '../ui'
import { errorText, keyBelongsToPage } from '../util'
import { Canvas } from './canvas/Canvas'
import { toWorld } from './canvas/viewport'
import { isForeignText, paste, placeFile, placeText } from './clipboard'
import { COMMANDS, handleKey, isEnabled, type Actions } from './commands'
import { ContextMenuHost } from './panels/ContextMenu'
import { DesignPanel } from './panels/DesignPanel'
import { InspectPanel } from './panels/InspectPanel'
import { ExportControls } from './panels/ExportControls'
import { ASSET_TYPE, LeftPanel } from './panels/LeftPanel'
import { dropParent, instantiate } from './model/components'
import { hitTest } from './canvas/hit'
import { MainMenu } from './panels/MainMenu'
import { FindDialog } from './panels/FindDialog'
import { CommentPopover } from './panels/CommentPopover'
import { Palette } from './panels/Palette'
import { PreviewOverlay } from './panels/PreviewOverlay'
import { RenameDialog } from './panels/RenameDialog'
import { LibrariesDialog } from './panels/LibrariesDialog'
import { VersionsDialog } from './panels/VersionsDialog'
import { Toolbar } from './panels/Toolbar'
import { createEditorStore, EditorContext, useEditor, useStore } from './store'

const SAVE_TEXT = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' }

export function Editor({ opened, api, onExit }: { opened: OpenedProject; api: RefigApi; onExit(): void }) {
  const [store] = useState(() => createEditorStore(opened, api))
  const [exporting, setExporting] = useState(false)
  const [palette, setPalette] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [finding, setFinding] = useState(false)
  const [versions, setVersions] = useState(false)
  const [libraries, setLibraries] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState<'exit' | 'close' | null>(null) // a save failed while leaving
  const force = useRef(false)
  useEffect(() => {
    store.attach()
    void refreshPlugins(store)
    // Text boxes are measured with the fonts loaded so far; measure again once the fonts in use have arrived.
    const refit = () => store.refitText()
    void document.fonts?.ready.then(refit)
    document.fonts?.addEventListener?.('loadingdone', refit)
    return () => (document.fonts?.removeEventListener?.('loadingdone', refit), stopPlugin(store), store.dispose())
  }, [store])
  const shown = useSyncExternalStore(store.subscribe, () => store.get().toast)
  useEffect(() => {
    if (shown) (setToast(shown), store.set({ toast: null }))
  }, [shown, store])

  // Leaving the editor saves first. If that fails the user decides; nothing is dropped silently.
  const back = useCallback(async () => {
    if (await store.save()) onExit()
    else setUnsaved('exit')
  }, [store, onExit])
  const picker = useRef<HTMLInputElement>(null)
  const actions = useMemo<Actions>(() => ({ back: () => void back(), openExport: () => setExporting(true), placeImages: () => picker.current?.click(), openPalette: () => setPalette(true), openRename: () => setRenaming(true), openFind: () => setFinding(true), openVersions: () => setVersions(true), openLibraries: () => setLibraries(true) }), [back])
  const report = useCallback((e: unknown) => setToast(errorText(e)), [])
  /** Places each file in turn; an SVG's unsupported features are named in one toast. */
  const place = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    const skipped = new Set<string>()
    for (const f of files) (await placeFile(store, f, at)).forEach((s) => skipped.add(s))
    if (skipped.size) setToast(`SVG imported without: ${[...skipped].join(', ')}`)
  }, [store])
  const clearToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!keyBelongsToPage(e) && handleKey(e, store, actions)) e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (keyBelongsToPage(e)) return
      e.preventDefault()
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!image && isForeignText(text)) return placeText(store, text)
      void (image ? place([image]) : paste(store)).catch(report)
    }
    const isImage = (f: File) => f.type.startsWith('image/') || /\.svg$/i.test(f.name)
    const onDragOver = (e: DragEvent) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' || i.type === ASSET_TYPE)) e.preventDefault() }
    const onDrop = (e: DragEvent) => {
      const asset = e.dataTransfer?.getData(ASSET_TYPE), main = (e.target as Element).closest('main')
      if (asset && main) {
        e.preventDefault()
        const { view, pageId } = store.get(), box = main.getBoundingClientRect(), at = toWorld(view, { x: e.clientX - box.left, y: e.clientY - box.top })
        return store.update((d) => instantiate(d, asset, dropParent(d, pageId, hitTest(d, pageId, at, { deep: true }), asset), at))
      }
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImage)
      if (!files.length) return
      e.preventDefault()
      const { view } = store.get(), box = (e.target as Element).closest('main')?.getBoundingClientRect()
      void place(files, box && toWorld(view, { x: e.clientX - box.left, y: e.clientY - box.top })).catch(report)
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
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [store, actions, report, place])

  return (
    <EditorContext.Provider value={store}>
      <input ref={picker} type="file" hidden multiple aria-label="Place image" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg"
        onChange={(e) => { void place([...(e.target.files ?? [])]).catch(report); e.target.value = '' }} />
      <Layout actions={actions} report={report} />
      {exporting && (
        <Dialog title="Export selection" onClose={() => setExporting(false)}>
          <ExportControls onDone={(path) => { setExporting(false); if (path) setToast(`Exported to ${path}`) }} onError={report} />
        </Dialog>
      )}
      <PluginUI />
      {palette && <Palette actions={actions} onClose={() => setPalette(false)} />}
      {renaming && <RenameDialog onClose={() => setRenaming(false)} />}
      {finding && <FindDialog onClose={() => setFinding(false)} />}
      {versions && <VersionsDialog onClose={() => setVersions(false)} />}
      {libraries && <LibrariesDialog onClose={() => setLibraries(false)} />}
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
  const hidden = useEditor((s) => s.uiHidden), dev = useEditor((s) => s.dev), preview = useEditor((s) => s.preview)
  return (
    <ContextMenuHost actions={actions}>
      {preview && <PreviewOverlay start={preview} onReport={report} />}
      <div className="flex h-full flex-col">
        {!hidden && <TopBar actions={actions} />}
        <div className="flex min-h-0 flex-1">
          {!hidden && <SidePanel side="left" label="Pages and layers"><LeftPanel /></SidePanel>}
          <main className="relative min-w-0 flex-1">
            <Canvas />
            <CommentPopover />
            {!hidden && !dev && <Toolbar />}
          </main>
          {!hidden && <SidePanel side="right" label={dev ? 'Inspect' : 'Design'}>{dev ? <InspectPanel report={report} /> : <DesignPanel report={report} />}</SidePanel>}
        </div>
      </div>
    </ContextMenuHost>
  )
}

function TopBar({ actions }: { actions: Actions }) {
  const store = useStore()
  const name = useEditor((s) => s.name), save = useEditor((s) => s.save), saveError = useEditor((s) => s.saveError), zoom = useEditor((s) => s.view.zoom), dev = useEditor((s) => s.dev)
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
      <Button aria-pressed={dev} title="Dev mode (Shift+D)" onClick={() => store.set({ dev: !dev })}>Dev mode</Button>
      <Button disabled={!isEnabled(COMMANDS.find((c) => c.id === 'present')!, store)} title="Present prototype (Ctrl+Alt+Enter)" onClick={() => COMMANDS.find((c) => c.id === 'present')!.run(store, actions)}>Present</Button>
      <Menu label="Zoom" align="right" className="px-2" items={COMMANDS.filter((c) => c.id.startsWith('zoom-')).map((c) => ({
        label: c.label, shortcut: c.keys?.[0], disabled: !isEnabled(c, store), onSelect: () => c.run(store, actions),
      }))}>
        {Math.round(zoom * 100)}%
      </Menu>
    </header>
  )
}
