import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listPlugins, resolveFile, SHIM } from './plugins'

let dir: string
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refig-plugins-'))))
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const plugin = (id: string, manifest: unknown, files: Record<string, string> = { 'code.js': '1' }) => {
  fs.mkdirSync(path.join(dir, id))
  fs.writeFileSync(path.join(dir, id, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, id, f), c)
}

describe('listPlugins', () => {
  it('is empty for a missing folder', () => expect(listPlugins(path.join(dir, 'nope'))).toEqual([]))

  it('reads valid manifests, with a default command', () => {
    plugin('hello', { name: 'Hello', main: 'code.js', ui: 'ui.html' })
    expect(listPlugins(dir)).toEqual([{ id: 'hello', name: 'Hello', main: 'code.js', ui: 'ui.html', commands: [{ id: 'run', label: 'Hello' }] }])
  })

  it('keeps declared commands and drops malformed ones', () => {
    plugin('multi', { name: 'M', main: 'code.js', commands: [{ id: 'a', label: 'A' }, { id: 1 }, null] })
    expect(listPlugins(dir)[0].commands).toEqual([{ id: 'a', label: 'A' }])
  })

  it('skips broken, unsafe and mixed-case plugins', () => {
    plugin('broken', '{not json')
    plugin('nomain', { name: 'x' })
    plugin('escape', { name: 'x', main: '../code.js' })
    plugin('subdir', { name: 'x', main: 'a/b.js' })
    plugin('wrongext', { name: 'x', main: 'code.html' })
    plugin('Upper', { name: 'x', main: 'code.js' })
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'x')
    expect(listPlugins(dir)).toEqual([])
  })
})

describe('resolveFile', () => {
  it('serves files from the plugin folder with a type', () => {
    plugin('hello', { name: 'H', main: 'code.js' }, { 'code.js': 'x', 'ui.html': '<p>' })
    expect(resolveFile(dir, 'hello', 'ui.html')).toMatchObject({ type: 'text/html' })
    expect(resolveFile(dir, 'hello', 'code.js')?.bytes.toString()).toBe('x')
  })

  it('serves the shim under the reserved name', () => {
    plugin('hello', { name: 'H', main: 'code.js' }, { 'code.js': 'x', 'refig.js': 'evil' })
    expect(resolveFile(dir, 'hello', 'refig.js')?.bytes.toString()).toBe(SHIM)
  })

  it('refuses anything outside the folder or of an unknown type', () => {
    plugin('hello', { name: 'H', main: 'code.js' }, { 'code.js': 'x', 'a.exe': 'x' })
    fs.writeFileSync(path.join(dir, 'secret.js'), 'x')
    for (const [id, f] of [['hello', '../secret.js'], ['..', 'secret.js'], ['hello', 'a.exe'], ['hello', 'missing.js'], ['hello', 'sub/x.js'], ['nope', 'code.js']])
      expect(resolveFile(dir, id, f)).toBeNull()
  })
})
