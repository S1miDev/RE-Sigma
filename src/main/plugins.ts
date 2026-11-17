// Plugins live in <pluginsDir>/<id>/ as plain files. No Electron imports, so this is unit-testable.
import fs from 'node:fs'
import path from 'node:path'
import type { PluginInfo } from '../shared/api'

const SAFE = /^[\w][\w.-]{0,63}$/ // folder ids and file names: flat, no separators, no leading dot
const MAX_FILE = 5 * 1024 ** 2
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' }

function manifestOf(dir: string, id: string): PluginInfo | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'))
    const file = (v: unknown, ext: string) => (typeof v === 'string' && SAFE.test(v) && v.endsWith(ext) ? v : null)
    const main = file(m.main, '.js')
    if (!main || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100) return null
    const ui = m.ui === undefined ? undefined : file(m.ui, '.html')
    if (ui === null) return null
    const cmds: unknown[] = Array.isArray(m.commands) ? m.commands.slice(0, 20) : []
    const commands = cmds.flatMap((c) => {
      const o = c as { id?: unknown; label?: unknown }
      return typeof o?.id === 'string' && o.id.length <= 64 && typeof o.label === 'string' && o.label.length <= 100 ? [{ id: o.id, label: o.label }] : []
    })
    return { id, name: m.name.trim(), main, ...(ui ? { ui } : {}), commands: commands.length ? commands : [{ id: 'run', label: m.name.trim() }] }
  } catch {
    return null // missing or malformed manifest: the folder is not a plugin
  }
}

export function listPlugins(dir: string): PluginInfo[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && SAFE.test(d.name) && d.name === d.name.toLowerCase()).map((d) => d.name)
  } catch {
    return []
  }
  return names.flatMap((n) => manifestOf(dir, n) ?? []).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The worker script for a plugin: the `refig` shim, then its main file. Workers must be same-origin with the page, so the renderer
 * runs this as a blob worker; `importScripts('refig.js')` is made a no-op because the shim is already in.
 */
export function readCode(dir: string, id: string): string {
  const info = SAFE.test(id) ? manifestOf(dir, id) : null
  const main = info && resolveFile(dir, id, info.main)
  if (!main) throw new Error('Plugin not found')
  return `${SHIM}\nself.importScripts = () => {}\n${main.bytes.toString('utf8')}`
}

/** A file inside one plugin folder, or null (unknown plugin, unsafe name, too big, not a file). Never leaves the folder. */
export function resolveFile(dir: string, id: string, file: string): { bytes: Buffer; type: string } | null {
  if (!SAFE.test(id) || !SAFE.test(file)) return null
  if (file === 'refig.js') return { bytes: Buffer.from(SHIM), type: TYPES['.js'] }
  const type = TYPES[path.extname(file).toLowerCase()]
  if (!type) return null
  try {
    const p = path.join(dir, id, file)
    const st = fs.lstatSync(p) // lstat: a symlink pointing out of the folder is refused
    return st.isFile() && st.size <= MAX_FILE ? { bytes: fs.readFileSync(p), type } : null
  } catch {
    return null
  }
}

/** Served as refig-plugin://<id>/refig.js (reserved name): the worker-side `refig` object. Any method call is forwarded to the editor, which whitelists. */
export const SHIM = `(() => {
  let n = 0
  const pending = new Map(), on = { run() {}, ui() {} }
  const call = (method, ...args) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); postMessage({ id, method, args }) })
  self.onmessage = (e) => {
    const m = e.data
    if (m.type === 'reply') { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.rej(new Error(m.error)) : p.res(m.result) }
    else if (m.type === 'run') on.run(m.command)
    else if (m.type === 'ui') on.ui(m.msg)
  }
  const own = { onRun(f) { on.run = f }, onUIMessage(f) { on.ui = f } }
  self.refig = new Proxy(own, { get: (t, k) => (k in t ? t[k] : (...a) => call(k, ...a)) })
})()
`

export const PLUGIN_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"
