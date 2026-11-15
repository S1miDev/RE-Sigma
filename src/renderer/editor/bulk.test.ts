// Alt-hover measurement, the scale tool, bulk rename and find & replace.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { makeNode } from '../../shared/document'
import { drawOverlay } from './canvas/overlay'
import { measure } from './canvas/measure'
import { insert, patch } from './model/ops'
import { renamed, replaceInText } from './model/rename'
import { scaleTree } from './model/scale'
import { runCommand } from './commands'
import { at, drag, open } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('measure gives the gap between apart boxes and edge offsets for nested ones', () => {
  const gap = measure({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 })
  expect(gap).toEqual([{ x1: 10, y1: 5, x2: 30, y2: 5, label: '20' }])
  expect(measure({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 20, w: 30, h: 30 }).map((s) => s.label)).toEqual(['10', '60', '20', '50'])
  expect(measure({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toEqual([])
})

test('Alt over a layer draws the distances to it', () => {
  const t = open()
  t.store.set({ selection: [t.a], hover: t.b, altDown: true })
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width: 800, height: 600 } }, {
    get: (o, k) => (k in o ? (o as never)[k] : k === 'measureText' ? () => ({ width: 10 }) : (...a: unknown[]) => void calls.push(`${String(k)}:${a[0]}`)), set: () => true,
  }) as unknown as CanvasRenderingContext2D
  drawOverlay(ctx, t.store.get(), 1)
  expect(calls).toContain('fillText:50') // a and b overlap, so the labels are edge offsets: 50 each
})

test('scaleTree scales position, size, stroke, radius and text inside a frame', () => {
  const t = open()
  const text = makeNode('TEXT', { characters: 'Hi', fontSize: 10, lineHeight: 12, runs: [{ len: 2, style: { fontSize: 20 } }], x: 5, y: 5 })
  t.store.update((d) => patch(insert(d, text, t.frame), [t.inner], { strokeWeight: 3, cornerRadius: 4 }))
  const before = t.store.get().doc
  const out = scaleTree(before, [t.frame], 2, { x: 100, y: 100 })
  const f = out.nodes[t.frame], i = out.nodes[t.inner], x = out.nodes[text.id]
  expect([f.x, f.y, f.width, f.height]).toEqual([100, 100, 400, 400])
  expect([i.x, i.y, i.width, i.strokeWeight, i.cornerRadius]).toEqual([20, 20, 100, 6, 8])
  expect([x.fontSize, x.lineHeight, x.runs![0].style.fontSize]).toEqual([20, 24, 40])
  expect(scaleTree(before, [t.frame], 0, { x: 0, y: 0 })).toBe(before)
})

test('dragging with the scale tool scales the selection in one undo step', () => {
  const t = open()
  t.store.set({ selection: [t.a], tool: 'scale' })
  drag(t.store, at(500, 100), at(550, 150), at(600, 200)) // from 141 px to 283 px from a's top-left (400, 0)
  expect(t.store.get().doc.nodes[t.a].width).toBeCloseTo(200)
  expect(t.store.get().tool).toBe('move')
  t.store.undo()
  expect(t.store.get().doc.nodes[t.a].width).toBe(100)
})

test('bulk rename numbers layers from a pattern and applies find/replace', () => {
  const t = open()
  const o = { pattern: 'Card {n}', start: 5, find: '', replace: '', matchCase: false }
  expect(renamed(t.doc, [t.a, t.b], o)).toEqual({ [t.a]: 'Card 5', [t.b]: 'Card 6' })
  expect(renamed(t.doc, [t.inner], { ...o, pattern: '{parent}/{name}', find: 'FRAME', replace: 'F' })).toEqual({ [t.inner]: `${t.doc.nodes[t.frame].name.replace(/frame/i, 'F')}/${t.doc.nodes[t.inner].name}` })
  expect(renamed(t.doc, [t.a], { ...o, pattern: '  ' })[t.a]).toBe(t.doc.nodes[t.a].name) // empty keeps the old name
})

test('find & replace keeps runs and the auto name, matches case on request', () => {
  const t = open()
  const text = makeNode('TEXT', { name: 'Text', characters: 'Hello world, hello', runs: [{ len: 5, style: { fontWeight: 700 } }, { len: 13, style: {} }] })
  t.store.update((d) => insert(d, text, t.page))
  const doc = t.store.get().doc
  const all = replaceInText(doc, [text.id], 'hello', 'Bye', false)[text.id]
  expect(all.characters).toBe('Bye world, Bye')
  expect(all.runs[0]).toEqual({ len: 3, style: { fontWeight: 700 } })
  expect(all.name).toBe('Bye world, Bye')
  expect(replaceInText(doc, [text.id], 'hello', 'Bye', true)[text.id].characters).toBe('Hello world, Bye')
  expect(replaceInText(doc, [t.a], 'x', 'y', false)).toEqual({})
  runCommand(t.store, 'find-replace') // the stub actions open nothing, but the command exists
})
