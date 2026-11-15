// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ExportFile, ImportResult, ProjectSummary, RefigApi } from '../shared/api'
import { emptyDocument, type Document } from '../shared/document'
import { App } from './App'

/** A typed in-memory stand-in for window.refig. */
function fakeApi(names: string[] = []) {
  const docs = new Map<string, Document>()
  const list: ProjectSummary[] = []
  let n = 0
  const add = (name: string): ProjectSummary => {
    const s = { id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, name, modifiedAt: new Date().toISOString(), thumbnail: null }
    list.push(s)
    docs.set(s.id, emptyDocument())
    return s
  }
  const find = (id: string) => list.find((p) => p.id === id) ?? (() => { throw new Error('Project not found') })()
  const state = { imports: [] as ImportResult[], saveError: null as string | null }
  const api: RefigApi = {
    listProjects: vi.fn(async () => [...list]),
    createProject: vi.fn(async (name) => add(name)),
    openProject: vi.fn(async (id) => ({ summary: find(id), document: docs.get(id)!, images: {} })),
    saveProject: vi.fn(async (id, document) => {
      if (state.saveError) throw new Error(`Error invoking remote method 'refig:saveProject': Error: ${state.saveError}`)
      docs.set(id, document)
      return find(id)
    }),
    addImage: vi.fn(async () => 'a'.repeat(64)),
    renameProject: vi.fn(async (id, name) => {
      if (list.some((p) => p.name === name && p.id !== id)) throw new Error("Error invoking remote method 'refig:renameProject': Error: A project with this name already exists")
      return Object.assign(find(id), { name })
    }),
    deleteProject: vi.fn(async (id) => void list.splice(list.indexOf(find(id)), 1)),
    duplicateProject: vi.fn(async (id) => add(`${find(id).name} copy`)),
    importProjects: vi.fn(async () => state.imports),
    resolveImportConflict: vi.fn(async (_token, choice): Promise<ImportResult> =>
      choice === 'cancel' ? { file: 'Site.fig', status: 'cancelled' } : { file: 'Site.fig', status: 'imported', summary: add(choice === 'keepBoth' ? 'Site (2)' : 'Site'), omitted: { VECTOR: 8, INSTANCE: 4 } }),
    exportProject: vi.fn(async () => ({ path: 'C:\\out\\A.refig' })),
    exportImage: vi.fn(async () => ({ path: 'C:\\out\\shape.png' })),
    exportFiles: vi.fn(async (files: ExportFile[]) => files.map((f) => `C:\\out\\${f.name}.${f.kind}`)),
    openExternal: vi.fn(async () => undefined),
    listPlugins: vi.fn(async () => [{ id: 'demo', name: 'Demo plugin', main: 'code.js', commands: [{ id: 'run', label: 'Demo plugin' }] }]),
    readPluginCode: vi.fn(async () => ''),
    openPluginsFolder: vi.fn(async () => undefined),
  }
  names.forEach(add)
  return { api, list, docs, state }
}

const nodesOf = (doc: Document) => Object.values(doc.nodes).filter((n) => n.type !== 'PAGE')
async function openEditor(names = ['Alpha']) {
  const f = fakeApi(names), user = userEvent.setup()
  render(<App api={f.api} />)
  await user.click(await screen.findByRole('button', { name: `Open ${names[0]}` }))
  const canvas = await screen.findByLabelText('Canvas')
  const draw = (x0: number, y0: number, x1: number, y1: number) => {
    fireEvent.pointerDown(canvas, { clientX: x0, clientY: y0, button: 0, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: x1, clientY: y1, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: x1, clientY: y1, pointerId: 1 })
  }
  return { ...f, user, canvas, draw, id: f.list[0].id }
}

test('Home: loading skeleton, then the empty state with New and Import', async () => {
  const f = fakeApi()
  let release = (_: ProjectSummary[]) => {}
  f.api.listProjects = vi.fn(() => new Promise<ProjectSummary[]>((done) => (release = done)))
  render(<App api={f.api} />)
  expect(screen.getByLabelText('Loading projects')).toHaveAttribute('aria-busy', 'true')
  release([])
  expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /New project/ }).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('button', { name: 'Import' }).length).toBeGreaterThan(0)
})

test('Home: an unreadable workspace shows the error and Retry recovers', async () => {
  const f = fakeApi(['Alpha']), user = userEvent.setup()
  const real = f.api.listProjects
  f.api.listProjects = vi.fn().mockRejectedValueOnce(new Error("Error invoking remote method 'refig:listProjects': Error: EACCES: permission denied"))
  render(<App api={f.api} />)
  expect(await screen.findByText("Can't read the projects folder")).toBeInTheDocument()
  expect(screen.getByText('EACCES: permission denied')).toBeInTheDocument()
  f.api.listProjects = real
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument()
})

test('Home: a damaged file is shown with its reason and cannot be opened', async () => {
  const f = fakeApi(['Alpha'])
  f.list.push({ id: '', name: 'Broken', modifiedAt: new Date(0).toISOString(), thumbnail: null, damaged: 'File is damaged or not a valid archive' })
  render(<App api={f.api} />)
  expect(await screen.findByText('File is damaged or not a valid archive')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Broken' })).toBeNull()
})

test('Home: rename shows a name clash inline, then succeeds; delete asks first', async () => {
  const f = fakeApi(['Alpha', 'Beta']), user = userEvent.setup()
  render(<App api={f.api} />)
  await user.click(await screen.findByRole('button', { name: 'Actions for Alpha' }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename…' }))
  const dialog = screen.getByRole('dialog', { name: 'Rename project' }), input = within(dialog).getByLabelText('Project name')
  await user.clear(input)
  await user.type(input, 'Beta{Enter}')
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('A project with this name already exists')
  await user.clear(input)
  await user.type(input, 'Gamma{Enter}')
  expect(await screen.findByRole('button', { name: 'Open Gamma' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Actions for Beta' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete…' }))
  expect(f.api.deleteProject).not.toHaveBeenCalled()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Beta' })).toBeNull())
  expect(f.api.deleteProject).toHaveBeenCalledWith(f.list.length ? expect.any(String) : '')
})

test('Home: an import conflict asks Replace / Keep both / Cancel and reports omitted layers', async () => {
  const f = fakeApi(['Site']), user = userEvent.setup()
  f.state.imports = [{ file: 'Site.fig', status: 'conflict', token: 't1', name: 'Site' }, { file: 'bad.refig', status: 'error', error: 'File is damaged or not a valid archive' }]
  render(<App api={f.api} />)
  await user.click(await screen.findByRole('button', { name: 'Import' }))
  const dialog = await screen.findByRole('dialog', { name: '“Site” already exists' })
  for (const name of ['Replace', 'Keep both', 'Cancel']) expect(within(dialog).getByRole('button', { name })).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Keep both' }))
  expect(f.api.resolveImportConflict).toHaveBeenCalledWith('t1', 'keepBoth')
  const results = await screen.findByRole('dialog', { name: 'Import results' })
  expect(within(results).getByText(/12 items omitted: VECTOR ×8, INSTANCE ×4/)).toBeInTheDocument()
  expect(within(results).getByText('File is damaged or not a valid archive')).toBeInTheDocument()
  await user.click(within(results).getByRole('button', { name: 'Done' }))
  expect(await screen.findByRole('button', { name: 'Open Site (2)' })).toBeInTheDocument()
})

test('New project opens the editor; Back returns to the list', async () => {
  const f = fakeApi(), user = userEvent.setup()
  render(<App api={f.api} />)
  await user.click((await screen.findAllByRole('button', { name: /New project/ }))[0])
  expect(await screen.findByRole('toolbar', { name: 'Tools' })).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Saved')
  await user.click(screen.getByRole('button', { name: 'Back to projects' }))
  expect(await screen.findByRole('button', { name: 'Open Untitled' })).toBeInTheDocument()
})

test('a project that fails to open shows the error and a way back', async () => {
  const f = fakeApi(['Alpha']), user = userEvent.setup()
  f.api.openProject = vi.fn().mockRejectedValue(new Error('This project was made by a newer version of Refig'))
  render(<App api={f.api} />)
  await user.click(await screen.findByRole('button', { name: 'Open Alpha' }))
  expect(await screen.findByText('This project was made by a newer version of Refig')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back to projects' }))
  expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument()
})

test('Editor: tools switch by click and by shortcut', async () => {
  const { user } = await openEditor()
  const tool = (name: string) => within(screen.getByRole('toolbar', { name: 'Tools' })).getByRole('button', { name })
  expect(tool('Move')).toHaveAttribute('aria-pressed', 'true')
  await user.click(tool('Rectangle'))
  expect(tool('Rectangle')).toHaveAttribute('aria-pressed', 'true')
  for (const [key, name] of [['o', 'Ellipse'], ['t', 'Text'], ['f', 'Frame'], ['l', 'Line'], ['h', 'Hand'], ['v', 'Move']]) {
    await user.keyboard(key)
    expect(tool(name)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('Editor: draw a rectangle, edit it in the Design panel, autosave writes it', async () => {
  const { user, draw, docs, id, api } = await openEditor()
  expect(screen.getByText(/This page is empty/)).toBeInTheDocument()
  await user.keyboard('r')
  draw(100, 100, 260, 180)
  const layers = screen.getByRole('tree', { name: 'Layers' })
  expect(within(layers).getByRole('treeitem', { name: 'Rectangle 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

  const width = screen.getByLabelText('Width')
  expect(width).toHaveValue('160')
  await user.clear(width)
  await user.type(width, '300{Enter}')
  await user.click(screen.getByRole('button', { name: 'Add drop shadow' }))
  expect(screen.getByLabelText('Shadow 1 blur')).toHaveValue('4')
  const hex = screen.getByLabelText('Fill 1 hex')
  await user.clear(hex)
  await user.type(hex, 'f00{Enter}')

  await waitFor(() => expect(api.saveProject).toHaveBeenCalled(), { timeout: 3000 })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'))
  const [rect] = nodesOf(docs.get(id)!)
  expect(rect).toMatchObject({ type: 'RECTANGLE', x: 100, y: 100, width: 300, height: 80, effects: [{ blur: 4 }] })
  expect(rect.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } })
})

test('Editor: a fill takes a document colour from the swatches, and it becomes a recent colour', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('r')
  draw(100, 100, 260, 180)
  await user.click(screen.getByRole('button', { name: 'Fill 1 swatches' }))
  const dialog = screen.getByRole('dialog', { name: 'Fill 1 swatches' })
  const [first] = within(dialog).getAllByRole('button', { name: /^Document / })
  await user.click(first)
  await user.click(screen.getByRole('button', { name: 'Fill 1 swatches' }))
  expect(within(screen.getByRole('dialog', { name: 'Fill 1 swatches' })).getByRole('button', { name: /^Recent / })).toBeInTheDocument()
})

test('Editor: layers can be renamed, hidden and deleted; undo brings them back', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('o')
  draw(50, 50, 150, 150)
  const layers = screen.getByRole('tree', { name: 'Layers' })
  await user.dblClick(within(layers).getByText('Ellipse 1'))
  const name = screen.getByLabelText('Layer name')
  await user.clear(name)
  await user.type(name, 'Dot{Enter}')
  expect(within(layers).getByRole('treeitem', { name: 'Dot' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Hide Dot' }))
  expect(screen.getByRole('button', { name: 'Show Dot' })).toHaveAttribute('aria-pressed', 'true')

  await user.keyboard('{Delete}')
  expect(screen.getByText(/This page is empty/)).toBeInTheDocument()
  await user.keyboard('{Control>}z{/Control}')
  expect(within(screen.getByRole('tree', { name: 'Layers' })).getByRole('treeitem', { name: 'Dot' })).toBeInTheDocument()
})

test('Editor: main menu lists working commands with shortcuts and enables them with state', async () => {
  const { user, draw } = await openEditor()
  await user.click(screen.getByRole('button', { name: 'Main menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  const undo = screen.getByRole('menuitem', { name: /Undo/ })
  expect(undo).toBeDisabled()
  expect(undo).toHaveTextContent('Ctrl+Z')
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()

  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.click(screen.getByRole('button', { name: 'Main menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  await user.click(screen.getByRole('menuitem', { name: /Undo/ }))
  expect(screen.getByText(/This page is empty/)).toBeInTheDocument()
})

test('Editor: right-click opens a context menu that selects what it hits and runs commands', async () => {
  const { user, draw, canvas } = await openEditor()
  fireEvent.contextMenu(canvas, { clientX: 400, clientY: 400 })
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([expect.stringContaining('Paste'), expect.stringContaining('Select all')])
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()

  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.keyboard('{Escape}') // deselect
  const layer = () => within(screen.getByRole('tree', { name: 'Layers' })).getByRole('treeitem', { name: 'Rectangle 1' })
  expect(layer()).toHaveAttribute('aria-selected', 'false')
  fireEvent.contextMenu(canvas, { clientX: 30, clientY: 30 })
  expect(layer()).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('menuitem', { name: /Duplicate/ })).toHaveTextContent('Ctrl+D')
  await user.click(screen.getByRole('menuitem', { name: /Duplicate/ }))
  expect(screen.queryByRole('menu')).toBeNull()
  expect(within(screen.getByRole('tree', { name: 'Layers' })).getAllByRole('treeitem')).toHaveLength(2)

  fireEvent.contextMenu(within(screen.getByRole('tree', { name: 'Layers' })).getAllByRole('treeitem')[0].querySelector('div')!) // layer rows open the same menu
  expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeEnabled()
})

test('Editor: Ctrl+F2 renames the selection from a pattern; Ctrl+F replaces in layer names', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.keyboard('{Control>}{F2}{/Control}')
  const pattern = screen.getByRole('textbox', { name: 'Name pattern' })
  await user.clear(pattern)
  await user.type(pattern, 'Card {{n}{Enter}')
  expect(screen.getByRole('treeitem', { name: 'Card 1' })).toBeInTheDocument()

  await user.keyboard('{Control>}f{/Control}')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Search in' }), 'names')
  await user.type(screen.getByRole('textbox', { name: 'Find' }), 'card')
  await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'Tile{Enter}')
  expect(screen.getByRole('treeitem', { name: 'Tile 1' })).toBeInTheDocument()
})

test('Editor: installed plugins are listed in the command palette and the Plugins menu', async () => {
  const { user } = await openEditor()
  await user.keyboard('{Control>}k{/Control}')
  await user.type(screen.getByRole('combobox', { name: /Search commands/ }), 'demo')
  expect(screen.getByRole('option', { name: /Demo plugin/ })).toHaveTextContent('Plugin')
  await user.keyboard('{Escape}')

  await user.click(screen.getByRole('button', { name: 'Main menu' }))
  await user.click(screen.getByRole('menuitem', { name: /Plugins/ }))
  expect(screen.getByRole('menuitem', { name: 'Demo plugin' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Open plugins folder' })).toBeInTheDocument()
})

test('Editor: Ctrl+K searches commands, pages and layers; the layer list filters', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.keyboard('{Escape}')
  const pages = screen.getByRole('region', { name: 'Pages' })
  await user.click(within(pages).getByRole('button', { name: 'Add page' })) // now on Page 2, Rectangle 1 is on Page 1

  await user.keyboard('{Control>}k{/Control}')
  await user.type(screen.getByRole('combobox', { name: /Search commands/ }), 'rectangle')
  const options = screen.getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Rectangle 1Page 1')]))
  await user.click(screen.getByRole('option', { name: /Rectangle 1/ }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(within(pages).getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('treeitem', { name: 'Rectangle 1' })).toHaveAttribute('aria-selected', 'true')

  await user.keyboard('{Control>}k{/Control}')
  await user.type(screen.getByRole('combobox', { name: /Search commands/ }), 'ellipse{Enter}') // a command: switches the tool
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Ellipse' })).toHaveAttribute('aria-pressed', 'true')

  const filter = screen.getByLabelText('Filter layers')
  await user.type(filter, 'zzz')
  expect(screen.getByText('No layers match.')).toBeInTheDocument()
  await user.clear(filter)
  await user.type(filter, 'rect')
  expect(screen.getByRole('treeitem', { name: 'Rectangle 1' })).toBeInTheDocument()
})

test('Editor: pages can be added, renamed and removed', async () => {
  const { user } = await openEditor()
  const pages = screen.getByRole('region', { name: 'Pages' })
  await user.click(within(pages).getByRole('button', { name: 'Add page' }))
  expect(within(pages).getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  await user.dblClick(within(pages).getByRole('button', { name: 'Page 2' }))
  await user.clear(screen.getByLabelText('Page name'))
  await user.type(screen.getByLabelText('Page name'), 'Icons{Enter}')
  expect(within(pages).getByRole('button', { name: 'Icons' })).toBeInTheDocument()
  await user.click(within(pages).getByRole('button', { name: 'Delete Icons' }))
  expect(within(pages).queryByRole('button', { name: 'Icons' })).toBeNull()
  expect(within(pages).queryByRole('button', { name: /^Delete/ })).toBeNull() // the last page can't be deleted
})

test('Editor: a failed save is shown, and leaving asks instead of dropping the changes', async () => {
  const { user, draw, state, api } = await openEditor()
  state.saveError = 'disk full'
  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.click(screen.getByRole('button', { name: 'Back to projects' }))
  const dialog = await screen.findByRole('dialog', { name: "Your changes couldn't be saved" })
  expect(dialog).toHaveTextContent('disk full')
  expect(screen.getByRole('status')).toHaveTextContent('Save failed')
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByLabelText('Canvas')).toBeInTheDocument()

  state.saveError = null
  await user.click(screen.getByRole('button', { name: 'Back to projects' }))
  expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeInTheDocument()
  expect(nodesOf(vi.mocked(api.saveProject).mock.calls.at(-1)![1])).toHaveLength(1)
})

test('Editor: export sends the selection through the API', async () => {
  const { user, draw, api } = await openEditor()
  expect(screen.queryByRole('button', { name: 'Export selection' })).toBeNull() // nothing selected: page properties only
  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.selectOptions(screen.getByLabelText('Export format'), 'svg')
  await user.click(screen.getByRole('button', { name: 'Export selection' }))
  await waitFor(() => expect(api.exportImage).toHaveBeenCalled())
  const [bytes, name, kind] = vi.mocked(api.exportImage).mock.calls[0]
  expect([name, kind]).toEqual(['Rectangle 1', 'svg'])
  expect(new TextDecoder().decode(bytes)).toMatch(/^<svg .*<rect /)
})

test('Editor: saved export settings export to a folder; the page exports with nothing selected; a slice crops the page', async () => {
  const { user, draw, api } = await openEditor()
  await user.click(screen.getByRole('button', { name: 'Export page' })) // empty page: nothing to draw
  expect(api.exportImage).not.toHaveBeenCalled()
  await user.keyboard('r')
  draw(10, 10, 60, 60)
  await user.selectOptions(screen.getByLabelText('Export format'), 'svg')
  await user.click(screen.getByRole('button', { name: 'Save as export setting' }))
  await user.selectOptions(screen.getByLabelText('Export format'), 'pdf') // vector kinds only: jsdom has no canvas to rasterise
  await user.click(screen.getByRole('button', { name: 'Save as export setting' }))
  await user.type(screen.getAllByLabelText('Saved export suffix')[1], '-print')
  await user.click(screen.getByRole('button', { name: 'Export saved settings' }))
  await waitFor(() => expect(api.exportFiles).toHaveBeenCalled())
  expect(vi.mocked(api.exportFiles).mock.calls[0][0].map((f) => [f.name, f.kind])).toEqual([['Rectangle 1', 'svg'], ['Rectangle 1-print', 'pdf']])

  await user.click(screen.getByRole('button', { name: 'Slice' }))
  draw(0, 0, 40, 40)
  expect(screen.getByRole('treeitem', { name: 'Slice 1' })).toBeInTheDocument()
  expect(screen.queryByText('Fill')).toBeNull()
  await user.selectOptions(screen.getByLabelText('Export format'), 'svg')
  await user.click(screen.getByRole('button', { name: 'Export selection' }))
  await waitFor(() => expect(api.exportImage).toHaveBeenCalled())
  expect(new TextDecoder().decode(vi.mocked(api.exportImage).mock.calls[0][0])).toMatch(/^<svg [^>]*>.*<rect /) // the page content under the slice, not the empty slice
})

test('Editor: Section tool draws a page-level section; size presets resize a frame', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('f')
  draw(10, 10, 110, 110)
  await user.selectOptions(screen.getByLabelText('Size preset'), 'iPhone 15 (393×852)')
  expect(screen.getByLabelText('Width')).toHaveValue('393')
  expect(screen.getByLabelText('Height')).toHaveValue('852')

  await user.click(screen.getByRole('button', { name: 'Section' }))
  draw(20, 20, 80, 80) // starts inside the frame, but a section never nests
  expect(screen.getByRole('treeitem', { name: 'Section 1' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Size preset')).toBeNull()
  expect(screen.queryByText('Clip content')).toBeNull()
})

test('Editor: Prototype section adds an interaction; Present opens the preview and Esc closes it', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('f')
  draw(10, 10, 110, 110)
  await user.click(screen.getByRole('button', { name: 'Add interaction' }))
  expect(screen.getByRole('group', { name: 'Interaction 1' })).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Action'), 'url')
  expect(screen.getByLabelText('Link')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Present' }))
  expect(screen.getByRole('dialog', { name: 'Prototype preview' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Prototype preview' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Remove interaction' }))
  expect(screen.queryByRole('group', { name: 'Interaction 1' })).toBeNull()
})

test('Editor: Comment tool pins a comment, replies, resolves and deletes it', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('c')
  draw(40, 40, 40, 40)
  await user.type(screen.getByLabelText('Comment text'), 'Fix this{Enter}')
  expect(screen.getByRole('button', { name: 'Fix this' })).toBeInTheDocument() // listed in the Comments section
  await user.type(screen.getByLabelText('Reply'), 'Done?{Enter}')
  expect(screen.getByText('Done?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Resolve' }))
  expect(screen.queryByRole('button', { name: 'Fix this' })).toBeNull() // resolved ones are hidden until shown
  await user.click(screen.getByLabelText('Resolved'))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.queryByRole('button', { name: 'Fix this' })).toBeNull()
})

test('Editor: Dev mode inspects the selection and shows its CSS', async () => {
  const { user, draw } = await openEditor()
  await user.keyboard('r')
  draw(10, 10, 110, 110)
  expect(screen.getByLabelText('Width')).toBeInTheDocument() // Design panel
  await user.click(screen.getByRole('button', { name: 'Dev mode' }))
  expect(screen.queryByLabelText('Width')).toBeNull()
  expect(screen.getByLabelText('Generated code')).toHaveTextContent('width: 100px')
  await user.selectOptions(screen.getByLabelText('Code language'), 'SVG')
  expect(screen.getByLabelText('Generated code')).toHaveTextContent('<svg')
  await user.click(screen.getByRole('button', { name: 'Dev mode' }))
  expect(screen.getByLabelText('Width')).toBeInTheDocument()
})
