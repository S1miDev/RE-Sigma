import { expect, test } from 'vitest'
import { fitText } from './canvas/aids'
import { patch } from './model/ops'
import { at, drag, open } from './testkit'

test('fitText cuts a frame name with an ellipsis to the width it has', () => {
  const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) as TextMetrics } // 10 px per character
  expect(fitText(ctx, 'Desktop', 70)).toBe('Desktop')
  expect(fitText(ctx, 'Desktop', 69)).toBe('Deskt…')
  expect(fitText(ctx, 'Desktop', 10)).toBe('…')
  expect(fitText(ctx, 'Desktop', 5)).toBe('')
})

test('a frame name on the canvas selects and drags its frame, before the content under it', () => {
  const { store, frame, a } = open()
  store.set({ doc: patch(store.get().doc, [a], { x: 100, y: 60 }) }) // a layer right under the frame's name
  drag(store, at(105, 95), at(155, 95))
  expect(store.get().selection).toEqual([frame])
  expect(store.get().doc.nodes[frame].x).toBe(150)
  store.set({ selection: [] })
  drag(store, at(300, 95)) // above the frame, past the end of its name
  expect(store.get().selection).not.toContain(frame)
})
