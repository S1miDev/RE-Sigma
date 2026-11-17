// Comment threads: pure ops, the tool, pin hit-testing, page deletion, undo.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { pinAt } from './canvas/aids'
import { drawOverlay } from './canvas/overlay'
import { runCommand } from './commands'
import { addComment, commentsOn, removeComment, reply, setResolved } from './model/comments'
import { removePage } from './model/ops'
import { at, drag, open } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('add, reply, resolve and remove; blank text is ignored', () => {
  const { store } = open(), { doc, pageId } = store.get()
  expect(addComment(doc, { page: pageId, x: 1, y: 2 }, '  ')).toBe(doc)
  let d = addComment(doc, { page: pageId, x: 1, y: 2 }, ' hello ', 'a')
  expect(d.comments).toMatchObject([{ id: 'a', x: 1, y: 2, text: 'hello' }])
  expect(reply(d, 'a', '')).toBe(d)
  d = reply(d, 'a', 'again', 'r')
  expect(d.comments[0].replies).toMatchObject([{ id: 'r', text: 'again' }])
  d = setResolved(d, 'a', true)
  expect(d.comments[0].resolved).toBe(true)
  expect(setResolved(d, 'a', false).comments[0]).not.toHaveProperty('resolved')
  expect(commentsOn(d, pageId)).toHaveLength(1)
  expect(removeComment(d, 'a').comments).toEqual([])
})

test('the comment tool drops a draft pin, a second click on a pin opens it; undo removes saved comments', () => {
  const { store } = open()
  runCommand(store, 'tool-comment')
  expect(store.get().tool).toBe('comment')
  drag(store, at(50, 60), at(50, 60))
  expect(store.get().draft).toMatchObject({ x: 50, y: 60 })
  const { draft } = store.get()
  store.update((d) => addComment(d, draft!, 'note', 'c'))
  store.set({ draft: null })
  const s = store.get()
  expect(pinAt(s, { x: 50, y: 50 })?.id).toBe('c') // the pin circle sits above its point
  expect(pinAt(s, { x: 300, y: 300 })).toBeUndefined()
  drag(store, at(50, 50), at(50, 50))
  expect(store.get()).toMatchObject({ openComment: 'c', draft: null })
  runCommand(store, 'undo')
  expect(store.get().doc.comments).toEqual([])
})

test('resolved pins hide unless shown; deleting a page deletes its comments; drawing works', () => {
  const { store } = open(), { doc, pageId } = store.get()
  const d = setResolved(addComment(doc, { page: pageId, x: 5, y: 5 }, 'x', 'c'), 'c', true)
  store.update(() => d)
  expect(pinAt(store.get(), { x: 5, y: -5 })).toBeUndefined()
  runCommand(store, 'toggle-resolved-comments')
  expect(pinAt(store.get(), { x: 5, y: -5 })?.id).toBe('c')
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? { width: 100, height: 100 } : k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
  expect(() => drawOverlay(ctx, store.get(), 1)).not.toThrow()
  const two = { ...d, pages: [...d.pages, 'p2'], nodes: { ...d.nodes, p2: { ...d.nodes[pageId], id: 'p2' } } }
  expect(removePage(two, pageId).comments).toEqual([])
})
