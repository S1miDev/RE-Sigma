import { describe, expect, it } from 'vitest'
import { solid } from '../../shared/document'
import { copy, copyProps, isForeignText, paste, pasteProps, placeText } from './clipboard'
import { runCommand } from './commands'
import { childrenOf, patch } from './model/ops'
import { open } from './testkit'

describe('copy / paste properties', () => {
  it('moves the look to other layers, leaves geometry alone, and undoes in one step', () => {
    const t = open()
    t.store.update((d) => patch(d, [t.a], { fills: [solid(0, 0, 1)], opacity: 0.5, strokeWeight: 4 }))
    t.store.set({ selection: [t.a] })
    copyProps(t.store)
    t.store.set({ selection: [t.b, t.inner] })
    const before = t.store.get().doc.nodes[t.b]
    pasteProps(t.store)
    for (const id of [t.b, t.inner]) {
      const n = t.store.get().doc.nodes[id]
      expect(n.fills).toEqual([solid(0, 0, 1)])
      expect([n.opacity, n.strokeWeight]).toEqual([0.5, 4])
    }
    expect([t.store.get().doc.nodes[t.b].x, t.store.get().doc.nodes[t.b].width]).toEqual([before.x, before.width])
    t.store.undo()
    expect(t.store.get().doc.nodes[t.b].fills).toEqual(before.fills)
    expect(t.store.get().doc.nodes[t.inner].fills).toEqual(t.store.get().doc.nodes[t.inner].fills.map(() => solid(1, 0, 0)))
  })

  it('text fields only reach text layers', () => {
    const t = open()
    t.store.set({ selection: [t.a] })
    runCommand(t.store, 'copy-properties')
    t.store.update((d) => patch(d, [t.a], { fontSize: 99 }))
    copyProps(t.store) // a rectangle: no text props recorded
    t.store.set({ selection: [t.b] })
    pasteProps(t.store)
    expect(t.store.get().doc.nodes[t.b].fontSize).not.toBe(99)
  })
})

describe('paste into / paste text', () => {
  it('Paste into puts the copy inside the selected frame, keeping its x/y', () => {
    const t = open()
    t.store.set({ selection: [t.a] })
    copy(t.store)
    t.store.set({ selection: [t.frame] })
    return paste(t.store, t.frame).then(() => {
      const kids = childrenOf(t.store.get().doc, t.frame).filter((n) => n.id !== t.inner)
      expect(kids).toHaveLength(1)
      expect([kids[0].x, kids[0].y]).toEqual([400, 0])
    })
  })

  it('pasted text becomes a text layer; our own copy marker and empty text are not foreign', () => {
    const t = open()
    placeText(t.store, 'Hello\nworld')
    const n = t.store.get().doc.nodes[t.store.get().selection[0]]
    expect([n.type, n.characters, n.name]).toEqual(['TEXT', 'Hello\nworld', 'Hello'])
    expect(isForeignText('')).toBe(false)
    expect(isForeignText('from another app')).toBe(true)
    t.store.set({ selection: [t.a] })
    copy(t.store)
    expect(isForeignText(t.store.get().doc.nodes[t.a].name)).toBe(false)
  })
})
