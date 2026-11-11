import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { API_KEYS } from '../src/shared/api'

const exe = path.resolve('dist', `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-unpacked`, process.platform === 'win32' ? 'Refig.exe' : 'refig')
let workspace: string, profile: string, app: ElectronApplication | null = null

async function launch(): Promise<Page> {
  // An IDE terminal can set ELECTRON_RUN_AS_NODE, which would start the app as plain Node.
  const { ELECTRON_RUN_AS_NODE: _, ...rest } = process.env
  const env = { ...rest, REFIG_WORKSPACE: workspace } as Record<string, string>
  // Own profile dir: the single-instance lock then can't collide with a Refig the developer has open.
  app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${profile}`], env })
  return app.firstWindow()
}
async function quit() {
  await app?.close()
  app = null
}
/** Makes the next native open/save dialog answer with the given path, without showing. */
const answerDialogs = (paths: string[]) =>
  app!.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p[0] })
  }, paths)

test.beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'refig-e2e-ws-'))
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'refig-e2e-profile-'))
})
test.afterEach(async () => {
  await quit()
  for (const dir of [workspace, profile]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
})

async function drawRectangle(page: Page) {
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible() // the editor is mounted and listening
  await page.keyboard.press('r')
  const box = (await page.getByLabel('Canvas').boundingBox())!
  await page.mouse.move(box.x + 200, box.y + 150)
  await page.mouse.down()
  await page.mouse.move(box.x + 420, box.y + 300, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByRole('treeitem', { name: 'Rectangle 1' })).toBeVisible()
}

test('a drawn rectangle survives quitting and relaunching', async () => {
  let page = await launch()
  await expect(page.getByText('No projects yet')).toBeVisible()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await drawRectangle(page)
  await expect(page.getByRole('status')).toHaveText('Saved')
  expect(fs.readdirSync(workspace)).toEqual(['Untitled.refig'])
  await quit()

  page = await launch()
  await page.getByRole('button', { name: 'Open Untitled' }).click()
  await expect(page.getByRole('treeitem', { name: 'Rectangle 1' })).toBeVisible()
  await expect(page.getByLabel('Width')).toHaveCount(0) // nothing selected after reopening
  await page.getByRole('treeitem', { name: 'Rectangle 1' }).click()
  await expect(page.getByLabel('Width')).toHaveValue('220')
})

test('closing the window right after an edit still saves it', async () => {
  let page = await launch()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await drawRectangle(page)
  await quit() // no wait for "Saved": the close itself must wait for the save

  page = await launch()
  await page.getByRole('button', { name: 'Open Untitled' }).click()
  await expect(page.getByRole('treeitem', { name: 'Rectangle 1' })).toBeVisible()
})

test('imports a Figma .fig file and reports what was omitted', async () => {
  const page = await launch()
  await answerDialogs([path.resolve('e2e', 'Untitled.fig')])
  await page.getByRole('button', { name: 'Import' }).first().click()
  const results = page.getByRole('dialog', { name: 'Import results' })
  await expect(results).toContainText(/items omitted: .*VECTOR ×\d+/)
  await results.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Open Untitled' }).click()
  await page.getByRole('button', { name: 'RE-probe', exact: true }).click()
  await expect(page.getByRole('treeitem', { name: 'Hello world' })).toBeVisible()
  await page.screenshot({ path: 'test-results/imported-fig.png' })
})

test('exports a project as .refig and imports it back without replacing silently', async () => {
  const page = await launch()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await drawRectangle(page)
  await page.getByRole('button', { name: 'Back to projects' }).click()

  const exported = path.join(profile, 'Copy of design.refig')
  await answerDialogs([exported])
  await page.getByRole('button', { name: 'Actions for Untitled' }).click()
  await page.getByRole('menuitem', { name: 'Export…' }).click()
  await expect(page.getByRole('status')).toContainText('Exported to')
  expect(fs.readFileSync(exported).equals(fs.readFileSync(path.join(workspace, 'Untitled.refig')))).toBe(true)

  await page.getByRole('button', { name: 'Import' }).click()
  const conflict = page.getByRole('dialog', { name: /already exists/ }) // same project id
  await conflict.getByRole('button', { name: 'Keep both' }).click()
  await page.getByRole('dialog', { name: 'Import results' }).getByRole('button', { name: 'Done' }).click().catch(() => {})
  await page.getByRole('button', { name: 'Open Copy of design' }).click()
  await expect(page.getByRole('treeitem', { name: 'Rectangle 1' })).toBeVisible()
  expect(fs.readdirSync(workspace).sort()).toEqual(['Copy of design.refig', 'Untitled.refig'])
})

test('exports the selection as PNG, SVG and PDF', async () => {
  const page = await launch()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await drawRectangle(page)
  for (const [kind, magic] of [['png', '\x89PNG'], ['svg', '<svg'], ['pdf', '%PDF']] as const) {
    const out = path.join(profile, `shape.${kind}`)
    await answerDialogs([out])
    await page.getByLabel('Export format').selectOption(kind)
    await page.getByRole('button', { name: 'Export selection' }).click()
    await expect.poll(() => fs.existsSync(out) && fs.readFileSync(out).subarray(0, 4).toString('latin1')).toBe(magic)
  }
})

test('the page has no Node access and only the contract API', async () => {
  const page = await launch()
  const seen = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    keys: Object.keys(window.refig).sort(),
    types: [...new Set(Object.values(window.refig).map((v) => typeof v))],
    inlineScriptRan: (() => {
      const s = document.createElement('script')
      s.textContent = 'window.__inline = true'
      document.head.append(s)
      return (window as unknown as Record<string, unknown>).__inline === true
    })(),
  }))
  expect(seen).toEqual({ require: 'undefined', process: 'undefined', keys: [...API_KEYS].sort(), types: ['function'], inlineScriptRan: false })
  // bad arguments are rejected in main, before any file access
  await expect(page.evaluate(() => window.refig.openProject('../../secrets'))).rejects.toThrow(/Invalid argument: id/)
  await expect(page.evaluate(() => window.refig.saveProject('00000000-0000-0000-0000-000000000000', { formatVersion: 1, pages: [], nodes: {} }))).rejects.toThrow(/not found|Invalid/)
})
