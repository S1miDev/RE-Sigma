import { expect, test } from 'vitest'
import { makeNode, type Document, type Interaction } from '../../shared/document'
import { ambientInteractions, interactionAt, presentFrom, startFrames, step, transitionAt, type PreviewState } from './model/prototype'
import { insert, patch } from './model/ops'
import { run, open, scene } from './testkit'

const go = (target?: string, over: Partial<Interaction> = {}): Interaction => ({ trigger: 'click', action: 'navigate', target, transition: 'instant', duration: 0, easing: 'linear', ...over })

/** Screen A (with a button) and screen B on one page. */
function flow() {
  const s = scene()
  const b = makeNode('FRAME', { name: 'B', x: 400, y: 400, width: 100, height: 100 })
  const doc: Document = insert(s.doc, b, s.page)
  return { ...s, doc, b: b.id }
}

test('startFrames: marked frames win, else every top-level non-section frame', () => {
  const { doc, page, frame, b } = flow()
  expect(startFrames(doc, page).map((n) => n.id)).toEqual([frame, b])
  expect(startFrames(patch(doc, [b], { flowStart: true }), page).map((n) => n.id)).toEqual([b])
  expect(startFrames(patch(doc, [b], { section: true }), page).map((n) => n.id)).toEqual([frame])
})

test('presentFrom: the top-level frame holding the selection, else the first start frame', () => {
  const { doc, page, frame, inner, b } = flow()
  expect(presentFrom(doc, page, [inner])).toBe(frame)
  expect(presentFrom(doc, page, [b])).toBe(b)
  expect(presentFrom(doc, page, [])).toBe(frame)
})

test('interactionAt: bubbles up to an ancestor, hits locked layers, ignores other triggers and points outside', () => {
  const { doc: d0, frame, inner, b } = flow()
  const click = go(b)
  const doc = patch(patch(d0, [frame], { interactions: [go(undefined, { action: 'back' })] }), [inner], { interactions: [click, go(b, { trigger: 'hover' })], locked: true })
  expect(interactionAt(doc, frame, { x: 20, y: 20 }, 'click')).toBe(click) // on the locked button
  expect(interactionAt(doc, frame, { x: 120, y: 120 }, 'click')?.action).toBe('back') // the frame itself, off the button
  expect(interactionAt(doc, frame, { x: 20, y: 20 }, 'press')).toBeNull()
  expect(interactionAt(doc, frame, { x: 500, y: 500 }, 'click')).toBeNull() // outside the frame
  const keyed = patch(d0, [inner], { interactions: [go(b, { trigger: 'key', key: 'a' })] })
  expect(ambientInteractions(keyed, frame, 'key')).toHaveLength(1)
  expect(ambientInteractions(keyed, frame, 'delay')).toHaveLength(0)
})

test('step: navigate, back, overlays and links; a missing target changes nothing', () => {
  const { doc, frame, inner, b } = flow()
  const s0: PreviewState = { stack: [frame], overlays: [] }
  const s1 = step(doc, s0, go(b)).state
  expect(s1).toEqual({ stack: [frame, b], overlays: [] })
  expect(step(doc, s1, go(b)).state).toBe(s1) // already there
  expect(step(doc, s0, go('gone')).state).toBe(s0)
  expect(step(doc, s0, go(inner)).state).toBe(s0) // not a frame
  expect(step(doc, s1, go(undefined, { action: 'back' })).state).toEqual(s0)
  expect(step(doc, s0, go(undefined, { action: 'back' })).state).toBe(s0) // nothing to go back to
  const o = step(doc, s0, go(b, { action: 'overlay' })).state
  expect(o.overlays).toEqual([b])
  expect(step(doc, o, go(undefined, { action: 'back' })).state).toEqual(s0) // back closes the overlay first
  expect(step(doc, o, go(undefined, { action: 'closeOverlay' })).state.overlays).toEqual([])
  expect(step(doc, s0, go(undefined, { action: 'url', url: 'https://example.com' })).url).toBe('https://example.com')
})

test('transitionAt: endpoints and slide directions', () => {
  expect(transitionAt('slideLeft', 0).to.dx).toBe(1)
  expect(transitionAt('slideLeft', 1)).toMatchObject({ from: { dx: -1 }, to: { dx: 0 } })
  expect(transitionAt('slideDown', 0.5).to.dy).toBe(-0.5)
  expect(transitionAt('dissolve', 0.25)).toMatchObject({ from: { alpha: 0.75 }, to: { alpha: 0.25 } })
  expect(transitionAt('instant', 0.5).to.alpha).toBe(0)
  expect(transitionAt('instant', 1).to.alpha).toBe(1)
  expect(transitionAt('dissolve', 0.5, 'easeIn').to.alpha).toBe(0.25)
  expect(transitionAt('dissolve', 9).to.alpha).toBe(1) // clamped
})

test('present command opens the preview from the selection; flow starting point toggles', () => {
  const { store, frame, inner } = open()
  store.set({ selection: [inner] })
  run(store, 'present')
  expect(store.get().preview).toBe(frame)
  store.set({ selection: [frame] })
  run(store, 'toggle-flow-start')
  expect(store.get().doc.nodes[frame].flowStart).toBe(true)
  run(store, 'toggle-flow-start')
  expect(store.get().doc.nodes[frame].flowStart).toBeUndefined()
})
