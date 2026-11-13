import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeNode, solid } from '../shared/document'
import { createProjectStore, sanitizeName, type ProjectStore } from './projects'

let dir: string, outside: string, store: ProjectStore
const trashed: string[] = []
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const fixture = path.resolve(__dirname, '../../research/fixtures/Untitled.fig')
const newStore = () => createProjectStore(dir, { appVersion: 'test', trash: async (f) => void (trashed.push(path.basename(f)), fs.rmSync(f)) })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refig-ws-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'refig-out-'))
  trashed.length = 0
  store = newStore()
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

function withRect(id: string) {
  const { document } = store.open(id)
  const rect = makeNode('RECTANGLE', { parentId: document.pages[0], width: 10, height: 10, fills: [solid(1, 0, 0)] })
  document.nodes[rect.id] = rect
  return { document, rect }
}

test('create, save, reopen in a fresh store (persists across restarts)', () => {
  const p = store.create('My design')
  expect(fs.existsSync(path.join(dir, 'My design.refig'))).toBe(true)
  const { document, rect } = withRect(p.id)
  const saved = store.save(p.id, document, PNG)
  expect(saved.thumbnail).toMatch(/^data:image\/png;base64,/)

  const again = newStore()
  expect(again.list().map((s) => s.name)).toEqual(['My design'])
  expect(again.open(p.id).document.nodes[rect.id]).toMatchObject({ type: 'RECTANGLE', width: 10 })
})

test('create picks a free name; names are sanitized', () => {
  expect(store.create('Untitled').name).toBe('Untitled')
  expect(store.create('Untitled').name).toBe('Untitled (2)')
  expect(store.create('a/b:c').name).toBe('a_b_c')
  expect(sanitizeName('  x. ')).toBe('x')
  expect(sanitizeName('con')).toBe('_con')
  expect(() => store.create('   ')).toThrow(/1–100/)
  expect(() => store.create('x'.repeat(101))).toThrow(/1–100/)
})

test('rename moves the file and refuses a clash', () => {
  const a = store.create('A')
  store.create('B')
  expect(() => store.rename(a.id, 'B')).toThrow(/already exists/)
  expect(store.rename(a.id, 'C').name).toBe('C')
  expect(fs.readdirSync(dir).sort()).toEqual(['B.refig', 'C.refig'])
  expect(store.rename(a.id, 'c').name).toBe('c') // case-only rename is not a clash
  expect(newStore().open(a.id).summary.name).toBe('c')
})

test('delete goes to the trash; duplicate gets a new id and name', async () => {
  const a = store.create('A')
  const copy = store.duplicate(a.id)
  expect(copy).toMatchObject({ name: 'A copy' })
  expect(copy.id).not.toBe(a.id)
  await store.remove(a.id)
  expect(trashed).toEqual(['A.refig'])
  expect(store.list().map((s) => s.name)).toEqual(['A copy'])
  expect(() => store.open(a.id)).toThrow(/not found/)
})

test('save rejects an invalid document and leaves the file untouched', () => {
  const a = store.create('A')
  const before = fs.readFileSync(path.join(dir, 'A.refig'))
  expect(() => store.save(a.id, { formatVersion: 1, pages: [], nodes: {} })).toThrow(/Invalid document/)
  expect(fs.readFileSync(path.join(dir, 'A.refig')).equals(before)).toBe(true)
})

test('a failed write keeps the old file intact and leaves no temp file', () => {
  const a = store.create('A')
  const { document } = withRect(a.id)
  const before = fs.readFileSync(path.join(dir, 'A.refig'))
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw new Error('disk full')
  })
  expect(() => store.save(a.id, document)).toThrow(/disk full/)
  expect(fs.readFileSync(path.join(dir, 'A.refig')).equals(before)).toBe(true)
  expect(fs.readdirSync(dir)).toEqual(['A.refig'])
  expect(Object.keys(store.save(a.id, document) && store.open(a.id).document.nodes)).toHaveLength(2) // retry works
})

test('images are stored once referenced and survive reopen', () => {
  const a = store.create('A')
  const { document, rect } = withRect(a.id)
  expect(() => store.addImage(a.id, Uint8Array.of(1, 2, 3))).toThrow(/Unsupported image/)
  const hash = store.addImage(a.id, PNG)
  document.nodes[rect.id].fills = [{ type: 'IMAGE', visible: true, hash }]
  store.save(a.id, document)
  expect([...newStore().open(a.id).images[hash]]).toEqual([...PNG])
})

test('damaged files are listed with a reason and never deleted', () => {
  store.create('Good')
  fs.writeFileSync(path.join(dir, 'Broken.refig'), 'not a zip')
  const list = store.list()
  expect(list.find((s) => s.name === 'Broken')).toMatchObject({ id: '', damaged: expect.stringMatching(/archive/) })
  expect(list.find((s) => s.name === 'Good')?.damaged).toBeUndefined()
  expect(fs.existsSync(path.join(dir, 'Broken.refig'))).toBe(true)
})

test('a hand-copied file with a duplicate id gets a fresh id on open', () => {
  const a = store.create('A')
  fs.copyFileSync(path.join(dir, 'A.refig'), path.join(dir, 'B.refig'))
  const list = store.list()
  const b = list.find((s) => s.name === 'B')!
  expect(b.id).not.toBe(a.id)
  expect(store.list().find((s) => s.name === 'B')!.id).toBe(b.id) // stable within the session
  store.open(b.id)
  expect(newStore().list().map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
})

test('export copies the file; importing it back conflicts; replace / keep both / cancel', async () => {
  const a = store.create('A')
  const { document } = withRect(a.id)
  store.save(a.id, document)
  const exported = path.join(outside, 'A.refig')
  store.exportTo(a.id, exported)
  expect(fs.readFileSync(exported).equals(fs.readFileSync(path.join(dir, 'A.refig')))).toBe(true)

  const conflict = () => {
    const r = store.importFile(exported)
    if (r.status !== 'conflict') throw new Error(`expected a conflict, got ${r.status}`)
    return r.token
  }
  expect(await store.resolveConflict(conflict(), 'cancel')).toMatchObject({ status: 'cancelled' })
  expect(store.list()).toHaveLength(1)

  const both = await store.resolveConflict(conflict(), 'keepBoth')
  expect(both).toMatchObject({ status: 'imported', summary: { name: 'A (2)' } })
  expect(both.status === 'imported' && both.summary.id).not.toBe(a.id)

  const replaced = await store.resolveConflict(conflict(), 'replace')
  expect(replaced).toMatchObject({ status: 'imported', summary: { id: a.id, name: 'A' } })
  expect(trashed).toEqual(['A.refig'])
  expect(store.list().map((s) => s.name).sort()).toEqual(['A', 'A (2)'])
  await expect(store.resolveConflict('00000000-0000-0000-0000-000000000000', 'replace')).rejects.toThrow(/no longer available/)

  // with the original gone there is no conflict
  await store.remove(a.id)
  await store.remove(both.status === 'imported' ? both.summary.id : '')
  expect(store.importFile(exported)).toMatchObject({ status: 'imported', summary: { id: a.id } })
})

test('import reports bad files per file and writes nothing for them', () => {
  const junk = path.join(outside, 'junk.refig'), other = path.join(outside, 'notes.txt')
  fs.writeFileSync(junk, 'nope')
  fs.writeFileSync(other, 'nope')
  expect(store.importFile(junk)).toMatchObject({ status: 'error', error: expect.stringMatching(/archive/) })
  expect(store.importFile(other)).toMatchObject({ status: 'error', error: expect.stringMatching(/Only \.refig and \.fig/) })
  expect(store.importFile(path.join(outside, 'missing.refig')).status).toBe('error')
  expect(fs.readdirSync(dir)).toEqual([])
})

test('imports a Figma file and reports omitted layers', () => {
  const r = store.importFile(fixture)
  expect(r).toMatchObject({ status: 'imported', summary: { name: 'Untitled' } })
  if (r.status !== 'imported') return
  expect(r.omitted?.['INSTANCE override']).toBeGreaterThan(0)
  expect(store.open(r.summary.id).document.pages).toHaveLength(4)
  expect(store.importFile(fixture).status).toBe('conflict') // same name
})
