import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../../shared/api'
import { MAX_CREATES, runPlugin, type Port } from './host'
import { open } from '../testkit'

const info: PluginInfo = { id: 'demo', name: 'Demo', main: 'code.js', ui: 'ui.html', commands: [{ id: 'run', label: 'Demo' }] }

function fake() {
  const sent: any[] = []
  const port: Port = { postMessage: (m) => void sent.push(m), terminate: vi.fn(), onmessage: null, onerror: null }
  let n = 0
  /** Plays a request from the plugin and returns the host's reply. */
  const call = async (method: string, ...args: unknown[]) => {
    const id = ++n
    port.onmessage!({ data: { id, method, args } })
    for (let i = 0; i < 5 && !sent.some((m) => m.id === id); i++) await Promise.resolve() // replies are a few microtasks away; waitFor polls too slowly for 1000 calls
    await vi.waitFor(() => expect(sent.some((m) => m.id === id)).toBe(true))
    return sent.find((m) => m.id === id)
  }
  return { port, sent, call }
}

describe('plugin host', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
  afterEach(() => vi.useRealTimers())

  const code = () => ({ readPluginCode: async () => 'code' })
  /** Runs the plugin and waits until its worker has been started. */
  async function start() {
    const t = open(code()), f = fake()
    runPlugin(t.store, info, 'run', () => f.port)
    await vi.waitFor(() => expect(f.sent.length).toBe(1))
    return { ...t, ...f }
  }

  it('tells the plugin which command to run', async () => {
    const { sent } = await start()
    expect(sent[0]).toEqual({ type: 'run', command: 'run' })
  })

  it('creates and edits nodes as one undo step', async () => {
    const { store, call, page } = await start()
    const made = await call('createNode', 'RECTANGLE', { width: 10, height: 20, fills: [{ r: 1, g: 0, b: 0 }] })
    await call('updateNode', made.result, { x: 5, name: 'Box' })
    const n = store.get().doc.nodes[made.result]
    expect(n).toMatchObject({ parentId: page, width: 10, x: 5, name: 'Box' })
    expect(n.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } })
    store.undo()
    expect(store.get().doc.nodes[made.result]).toBeUndefined()
  })

  it('refuses fields and types a plugin may not use', async () => {
    const { call, a } = await start()
    expect((await call('updateNode', a, { parentId: null })).error).toMatch(/Cannot set/)
    expect((await call('updateNode', a, { type: 'PAGE' })).error).toMatch(/Cannot set/)
    expect((await call('updateNode', a, { opacity: 5 })).error).toMatch(/Cannot set/)
    expect((await call('updateNode', 'nope', {})).error).toMatch(/No such node/)
    expect((await call('createNode', 'PAGE', {})).error).toMatch(/type must be/)
    expect((await call('createNode', 'RECTANGLE', { fills: [{ r: 9, g: 0, b: 0 }] })).error).toMatch(/channels/)
    expect((await call('eval', '1')).error).toMatch(/Unknown method/)
    expect((await call('constructor')).error).toMatch(/Unknown method/)
  })

  it('caps how many nodes one run creates', async () => {
    const { call } = await start()
    for (let i = 0; i < MAX_CREATES; i++) await call('createNode', 'RECTANGLE', {})
    expect((await call('createNode', 'RECTANGLE', {})).error).toMatch(/Too many/)
  }, 30_000)

  it('reads and selects live nodes only', async () => {
    const { store, call, a, b } = await start()
    store.set({ selection: [a] })
    expect((await call('getSelection')).result.map((n: { id: string }) => n.id)).toEqual([a])
    await call('setSelection', [b])
    expect(store.get().selection).toEqual([b])
    expect((await call('setSelection', ['nope'])).error).toMatch(/No such node/)
  })

  it('removes nodes', async () => {
    const { store, call, a } = await start()
    await call('removeNodes', [a])
    expect(store.get().doc.nodes[a]).toBeUndefined()
  })

  it('shows its UI with clamped size, and stops on closePlugin', async () => {
    const { store, call, port } = await start()
    await call('showUI', { width: 99999, height: 10 })
    expect(store.get().plugin?.ui).toEqual({ src: 'refig-plugin://demo/ui.html', w: 800, h: 120 })
    await call('closePlugin')
    await vi.waitFor(() => expect(store.get().plugin).toBeNull())
    expect(port.terminate).toHaveBeenCalled()
  })

  it('rejects showUI without a ui file', async () => {
    const t = open(code()), f = fake()
    runPlugin(t.store, { ...info, ui: undefined }, 'run', () => f.port)
    await vi.waitFor(() => expect(f.sent.length).toBe(1))
    expect((await f.call('showUI', {})).error).toMatch(/no UI/)
  })

  it('stops after sitting idle', async () => {
    const { store, port } = await start()
    vi.advanceTimersByTime(31_000)
    expect(port.terminate).toHaveBeenCalled()
    expect(store.get().plugin).toBeNull()
  })

  it('stops when the worker throws', async () => {
    const { store, port } = await start()
    port.onerror!()
    expect(port.terminate).toHaveBeenCalled()
    expect(store.get().toast).toMatch(/failed/)
  })

  it('starting another plugin stops the first', async () => {
    const { store, port, call } = await start()
    void call
    runPlugin(store, { ...info, id: 'other' }, 'run', () => fake().port)
    expect(port.terminate).toHaveBeenCalled()
    expect(store.get().plugin?.id).toBe('other')
  })
})

