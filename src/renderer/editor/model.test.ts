// Document model: geometry, ops, layout, constraints, hit testing, export, paths.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { colorAt, convertPaint, gradient, gradientAngle, gradientMatrix, makeNode, rotateGradient, solid, type Constraint, type Node, type Paint } from '../../shared/document'
import { frameAt, hitTest, marqueeHits } from './canvas/hit'
import { handleAt, handlesOf } from './canvas/overlay'
import { snap, snapTargets } from './canvas/snap'
import { fitView, toScreen, toWorld, zoomAt } from './canvas/viewport'
import { COMMANDS, keyOf } from './commands'
import { toSvg } from './export/svg'
import { apply, corners, invert, lineBetween, localMatrix, mul, resizeBox, worldBox } from './model/geometry'
import { addAutoLayout, addPage, align, autoLayout, childrenOf, distribute, duplicate, group, insert, moveTo, movePage, patch, remove, removePage, reorder, resizeNode, topLevel, translate, ungroup } from './model/ops'
import { anchorsOf, fitStroke, parsePath, pathData, withAnchors } from './model/path'
import { near, scene, names, open, at, drag, row, boxOf, pinned, black } from './testkit'

beforeEach(() => void vi.useFakeTimers())
afterEach(() => void vi.useRealTimers())

test('matrices: a rotated node maps its corners about its centre, and inverts', () => {
  const n = makeNode('RECTANGLE', { x: 10, y: 20, width: 100, height: 50, rotation: 90 })
  const m = localMatrix(n), c = apply(m, { x: 50, y: 25 })
  near(c.x, 60); near(c.y, 45) // the centre doesn't move
  const p = apply(m, { x: 0, y: 0 })
  near(p.x, 85); near(p.y, -5)
  const back = apply(mul(invert(m), m), { x: 3, y: 4 })
  near(back.x, 3); near(back.y, 4)
})

test('worldBox follows nesting', () => {
  const { doc, inner, frame } = scene()
  expect(worldBox(doc, [inner])).toEqual({ x: 110, y: 110, w: 50, h: 50 })
  const rotated = patch(doc, [frame], { rotation: 180 })
  const box = worldBox(rotated, [inner])!
  near(box.x, 240); near(box.y, 240)
})

test('resizeBox keeps the opposite edge fixed, flips, and honours Shift/Alt', () => {
  const n = makeNode('RECTANGLE', { x: 0, y: 0, width: 100, height: 50 })
  expect(resizeBox(n, 1, 1, { x: 150, y: 80 })).toEqual({ x: 0, y: 0, width: 150, height: 80 })
  expect(resizeBox(n, -1, 0, { x: 20, y: 999 })).toEqual({ x: 20, y: 0, width: 80, height: 50 })
  expect(resizeBox(n, 1, 0, { x: -40, y: 0 })).toMatchObject({ x: -40, width: 40 }) // dragged past the left edge
  expect(resizeBox(n, 1, 1, { x: 200, y: 60 }, { shift: true })).toMatchObject({ width: 200, height: 100 })
  expect(resizeBox(n, 1, 0, { x: 120, y: 0 }, { alt: true })).toMatchObject({ x: -20, width: 140 })
  const r = resizeBox({ ...n, rotation: 90 }, 1, 0, { x: 50, y: 125 }) // right edge points down when rotated 90°
  near(r.width, 150); near(r.height, 50)
  const line = lineBetween({ x: 0, y: 0 }, { x: 0, y: 10 })
  near(line.rotation, 90); near(line.width, 10); near(line.x, -5); near(line.y, 5)
})

test('insert stacks on top; reorder moves within siblings', () => {
  const { doc, page, frame, a, b } = scene()
  expect(names(doc, page)).toEqual([frame, a, b])
  expect(names(reorder(doc, [frame], 'forward'), page)).toEqual([a, frame, b])
  expect(names(reorder(doc, [b], 'back'), page)).toEqual([b, frame, a])
  expect(names(reorder(doc, [frame, a], 'front'), page)).toEqual([b, frame, a])
  expect(names(reorder(doc, [b], 'forward'), page)).toEqual([frame, a, b]) // already on top
  expect(reorder(doc, [b], 'forward')).toBe(doc)
})

test('remove takes descendants; pages are not removable through it', () => {
  const { doc, page, frame, inner } = scene()
  const next = remove(doc, [frame, page])
  expect(next.nodes[frame]).toBeUndefined()
  expect(next.nodes[inner]).toBeUndefined()
  expect(next.nodes[page]).toBeDefined()
})

test('moveTo reparents without moving the node on the page, and refuses cycles', () => {
  const { doc, page, frame, inner, a } = scene()
  const rotated = patch(doc, [frame], { rotation: 30 })
  const before = corners(rotated, a)
  const moved = moveTo(rotated, [a], frame)
  expect(moved.nodes[a].parentId).toBe(frame)
  corners(moved, a).forEach((p, i) => { near(p.x, before[i].x); near(p.y, before[i].y) })
  near(moved.nodes[a].rotation, -30)
  expect(names(moveTo(doc, [a], frame, { before: inner }), frame)).toEqual([a, inner])
  expect(moveTo(doc, [frame], frame)).toBe(doc)
  const nested = moveTo(doc, [a], frame)
  expect(moveTo(nested, [frame], a)).toBe(nested) // a isn't a container
  expect(names(moveTo(doc, [inner], page, { after: a }), page).indexOf(inner)).toBe(2)
})

test('group wraps children, ungroup restores them in place', () => {
  const { doc, page, frame, a, b } = scene()
  const g = group(doc, [a, b], 'GROUP')
  expect(doc.nodes[a].parentId).toBe(page)
  const box = g.doc.nodes[g.ids[0]]
  expect(box).toMatchObject({ type: 'GROUP', x: 400, y: 0, width: 150, height: 150 })
  expect(g.doc.nodes[a]).toMatchObject({ parentId: g.ids[0], x: 0, y: 0 })
  expect(g.doc.nodes[b]).toMatchObject({ x: 50, y: 50 })
  expect(names(g.doc, page)).toEqual([frame, g.ids[0]])

  const un = ungroup(g.doc, [g.ids[0]])
  expect(un.ids).toEqual([a, b])
  expect(un.doc.nodes[g.ids[0]]).toBeUndefined()
  expect(un.doc.nodes[b]).toMatchObject({ parentId: page, x: 450, y: 50 })

  // resizing a group scales its children
  const scaled = resizeNode(g.doc, g.ids[0], { x: 400, y: 0, width: 300, height: 150 })
  expect(scaled.nodes[b]).toMatchObject({ x: 100, width: 200, height: 100 })
})

test('duplicate copies subtrees with new ids directly above the original', () => {
  const { doc, page, frame, inner, a, b } = scene()
  const d = duplicate(doc, [frame, inner])
  expect(d.ids).toHaveLength(1) // inner is inside frame, so only frame is duplicated
  const copy = d.ids[0]
  expect(names(d.doc, page)).toEqual([frame, copy, a, b])
  expect(childrenOf(d.doc, copy)).toHaveLength(1)
  expect(childrenOf(d.doc, copy)[0].id).not.toBe(inner)
  expect(topLevel(doc, [inner, frame, 'missing'])).toEqual([frame])
})

test('translate moves by a page delta even inside a rotated parent', () => {
  const { doc, frame, inner } = scene()
  const rotated = patch(doc, [frame], { rotation: 90 })
  const before = worldBox(rotated, [inner])!
  const after = worldBox(translate(rotated, [inner], { x: 10, y: 0 }), [inner])!
  near(after.x, before.x + 10); near(after.y, before.y)
})

test('pages: add, reorder, remove (never the last one)', () => {
  const { doc, page } = scene()
  const added = addPage(doc), id = added.pages.at(-1)!
  expect(added.nodes[id].name).toBe('Page 2')
  expect(movePage(added, id, 0).pages).toEqual([id, page])
  const removed = removePage(added, page)
  expect(removed.pages).toEqual([id])
  expect(Object.keys(removed.nodes)).toEqual([id])
  expect(removePage(removed, id)).toBe(removed)
})

test('viewport: zoomAt keeps the point under the cursor; fitView centres', () => {
  const v = { x: 30, y: -20, zoom: 1.5 }, p = { x: 200, y: 100 }
  const z = zoomAt(v, p, 4)
  expect(toWorld(z, p)).toEqual(toWorld(v, p))
  expect(toScreen(v, toWorld(v, p))).toEqual(p)
  expect(zoomAt(v, p, 1e9).zoom).toBe(256)
  const fit = fitView({ x: 0, y: 0, w: 1000, h: 500 }, { w: 596, h: 596 }, 48)
  expect(fit.zoom).toBe(0.5)
  expect(toScreen(fit, { x: 500, y: 250 })).toEqual({ x: 298, y: 298 })
  expect(fitView(null, { w: 100, h: 100 })).toEqual({ zoom: 1, x: 50, y: 50 })
  expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { w: 500, h: 500 }, 48, 1).zoom).toBe(1)
})

test('hit testing: top-most wins, frames expose children, groups answer for theirs, hidden/locked are skipped', () => {
  const { doc, page, frame, inner, a, b } = scene()
  expect(hitTest(doc, page, { x: 460, y: 60 })).toBe(a) // inside a's box but outside b's ellipse
  expect(hitTest(doc, page, { x: 490, y: 90 })).toBe(b)
  expect(hitTest(doc, page, { x: 120, y: 120 })).toBe(inner)
  expect(hitTest(doc, page, { x: 250, y: 250 })).toBe(frame)
  expect(hitTest(doc, page, { x: 0, y: 0 })).toBeNull()
  expect(hitTest(patch(doc, [b], { locked: true }), page, { x: 490, y: 90 })).toBe(a)
  expect(hitTest(patch(doc, [inner], { visible: false }), page, { x: 120, y: 120 })).toBe(frame)
  const g = group(doc, [a, b], 'GROUP')
  expect(hitTest(g.doc, page, { x: 490, y: 90 })).toBe(g.ids[0])
  expect(hitTest(g.doc, page, { x: 490, y: 90 }, { deep: true })).toBe(b)
  expect(hitTest(g.doc, page, { x: 410, y: 140 })).toBeNull() // inside the group's box but on no child
  const line = insert(doc, makeNode('LINE', { ...lineBetween({ x: 0, y: 300 }, { x: 100, y: 400 }), strokes: [solid(0, 0, 0)] }), page)
  expect(hitTest(line, page, { x: 51, y: 50 + 300 }, { tolerance: 4 })).not.toBeNull()
  expect(hitTest(line, page, { x: 80, y: 320 }, { tolerance: 4 })).toBeNull()

  expect(marqueeHits(doc, page, { x: 390, y: -10, w: 300, h: 300 })).toEqual([a, b])
  expect(marqueeHits(doc, page, { x: 90, y: 90, w: 80, h: 80 })).toEqual([inner]) // frame only partly covered
  expect(marqueeHits(doc, page, { x: 90, y: 90, w: 300, h: 300 })).toEqual([frame])
  expect(frameAt(doc, page, { x: 150, y: 150 })).toBe(frame)
  expect(frameAt(doc, page, { x: 150, y: 150 }, [frame])).toBe(page)
  expect(frameAt(doc, page, { x: 0, y: 0 })).toBe(page)
})

test('snapping picks the nearest edge or centre within the threshold', () => {
  const targets = [{ x: 100, y: 100, w: 100, h: 100 }]
  expect(snap([97], [300], targets, 5)).toEqual({ dx: 3, dy: 0, guides: { x: 100 } })
  expect(snap([146, 153], [198], targets, 5)).toEqual({ dx: -3, dy: 2, guides: { x: 150, y: 200 } })
  expect(snap([94], [], targets, 5)).toEqual({ dx: 0, dy: 0, guides: {} })
  const { doc, page, frame, inner, a, b } = scene()
  expect(snapTargets(doc, page, [a])).toHaveLength(2)
  expect(snapTargets(doc, frame, [inner])).toEqual([worldBox(doc, [frame])]) // the parent frame itself
  expect(b).toBeTruthy()
})

test('handles: eight plus rotate for a box, two for a line, none when locked', () => {
  const { doc, a } = scene(), view = { x: 0, y: 0, zoom: 2 }
  const hs = handlesOf(doc, a, view)
  expect(hs).toHaveLength(9)
  expect(handleAt(hs, { x: 1000, y: 200 })).toMatchObject({ kind: 'resize', hx: 1, hy: 1 })
  expect(handleAt(hs, { x: 900, y: -22 })?.kind).toBe('rotate')
  expect(handleAt(hs, { x: 900, y: 100 })).toBeUndefined()
  expect(handlesOf(patch(doc, [a], { locked: true }), a, view)).toEqual([])
  expect(handlesOf(patch(doc, [a], { type: 'LINE', height: 0 }), a, view)).toHaveLength(2)
})

test('keyOf normalises shortcuts; every command key is unique', () => {
  const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) => keyOf({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
  expect(ev('z', 'KeyZ', { ctrlKey: true })).toBe('Ctrl+Z')
  expect(ev('!', 'Digit1', { shiftKey: true })).toBe('Shift+1') // layout-independent digits
  expect(ev('G', 'KeyG', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+G')
  expect(ev(']', 'BracketRight')).toBe(']')
  const keys = COMMANDS.flatMap((c) => c.keys ?? [])
  expect(new Set(keys).size).toBe(keys.length)
})

test('SVG export escapes text and reflects the selection box', () => {
  const { doc, page, a } = scene()
  const withText = insert(doc, makeNode('TEXT', { characters: '<b>&"x"', x: 5, y: 5, width: 50, height: 19, fills: [solid(0, 0, 0)], effects: [{ visible: true, x: 1, y: 2, blur: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } }] }), page)
  const text = childrenOf(withText, page).at(-1)!.id
  const svg = toSvg(withText, [a, text], () => undefined)
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="495" height="100" viewBox="5 0 495 100">/)
  expect(svg).toContain('&#60;b&#62;&#38;&#34;x&#34;')
  expect(svg).not.toContain('<b>')
  expect(svg).toContain('feGaussianBlur stdDeviation="2"')
  expect(svg).toContain('fill="rgb(255,0,0)"')
})

test('align: several nodes meet at the shared edge, a lone node aligns to its parent frame', () => {
  const { doc, a, b, inner } = scene()
  const left = align(doc, [a, b], 'x', 0)
  near(left.nodes[b].x, 400)
  const centred = align(doc, [inner], 'x', 0.5) // frame x 100..300, inner is 50 wide
  near(centred.nodes[inner].x, 75)
  expect(align(doc, [a], 'x', 0)).toBe(doc) // lone node on a page: nothing to align to
})

test('distribute: middle node moves so the gaps are equal', () => {
  const { doc, page } = scene()
  let d = doc
  const ids = [0, 30, 300].map((x) => { const n = makeNode('RECTANGLE', { x, y: 0, width: 100, height: 10 }); d = insert(d, n, page); return n.id })
  const out = distribute(d, ids, 'x')
  near(out.nodes[ids[1]].x, 150) // span 0..400, 300 of box width, 100 free / 2 gaps = 50
})

test('auto layout: places children with gap and padding, hugs content, aligns on the cross axis', () => {
  const { doc, f, kids } = row()
  const out = autoLayout(doc)
  expect(kids.map((k) => boxOf(out, k))).toEqual([[8, 5, 40, 20], [58, 5, 60, 30], [128, 5, 20, 10]])
  expect(boxOf(out, f).slice(2)).toEqual([8 + 40 + 10 + 60 + 10 + 20 + 6, 5 + 30 + 7])
  const c = autoLayout(row({ align: 'CENTER' }).doc), m = row({ align: 'MAX' })
  expect(Object.values(c.nodes).filter((n) => n.type === 'RECTANGLE').map((n) => n.y)).toEqual([10, 5, 15])
  expect(autoLayout(m.doc).nodes[m.kids[2]].y).toBe(25)
  const v = row({ mode: 'VERTICAL' }), vo = autoLayout(v.doc)
  expect(v.kids.map((k) => vo.nodes[k].y)).toEqual([5, 35, 75])
  expect(boxOf(vo, v.f).slice(2)).toEqual([8 + 60 + 6, 5 + 20 + 10 + 30 + 10 + 10 + 7])
  expect(autoLayout(out)).toBe(out) // settled layout changes nothing
})

test('auto layout: fill shares leftover space, hidden children are skipped, hug overrides fill', () => {
  const r = row({ hugW: false, hugH: false })
  let d = patch(r.doc, [r.kids[0]], { fillW: true, fillH: true })
  d = patch(d, [r.kids[2]], { visible: false })
  const out = autoLayout(d)
  expect(boxOf(out, r.kids[0])).toEqual([8, 5, 300 - 8 - 6 - 10 - 60, 100 - 5 - 7])
  expect(out.nodes[r.kids[1]].x).toBe(8 + 216 + 10)
  expect(boxOf(out, r.kids[2])).toEqual([500, 500, 20, 10])
  const hug = row()
  expect(autoLayout(patch(hug.doc, [hug.kids[0]], { fillW: true })).nodes[hug.kids[0]].width).toBe(40)
})

test('auto layout: a manual resize turns hug and fill off on that axis only', () => {
  const r = row()
  let d = resizeNode(autoLayout(r.doc), r.f, { x: 0, y: 0, width: 400, height: 42 })
  expect(d.nodes[r.f].layout).toMatchObject({ hugW: false, hugH: true })
  d = resizeNode(patch(d, [r.kids[0]], { fillW: true, fillH: true }), r.kids[0], { x: 8, y: 5, width: 40, height: 99 })
  expect(d.nodes[r.kids[0]]).toMatchObject({ fillW: true, fillH: false })
})

test('auto layout: adding it sorts children by position and reads gap and padding off the arrangement', () => {
  const { doc, frame, inner } = scene()
  let d = doc
  const n = makeNode('RECTANGLE', { x: 130, y: 10, width: 50, height: 50 }); d = insert(d, n, frame)
  const m = makeNode('RECTANGLE', { x: 70, y: 10, width: 50, height: 50 }); d = insert(d, m, frame)
  d = addAutoLayout(d, frame)
  expect(d.nodes[frame].layout).toEqual({ mode: 'HORIZONTAL', gap: 10, padding: [10, 20, 140, 10], align: 'MIN', hugW: true, hugH: true })
  expect(childrenOf(d, frame).map((k) => k.id)).toEqual([inner, m.id, n.id])
})

test('constraints: children follow a frame resize per axis', () => {
  const grow = (h: Constraint, v: Constraint = 'MIN') => { const p = pinned(h, v); return boxOf(resizeNode(p.doc, p.f, { x: 0, y: 0, width: 300, height: 200 }), p.k) }
  expect(grow('MIN')).toEqual([20, 10, 40, 30])
  expect(grow('MAX')).toEqual([120, 10, 40, 30])
  expect(grow('CENTER')).toEqual([70, 10, 40, 30])
  expect(grow('STRETCH')).toEqual([20, 10, 140, 30])
  expect(grow('SCALE')).toEqual([30, 10, 60, 30])
  expect(grow('MIN', 'MAX')).toEqual([20, 110, 40, 30])
  expect(grow('MIN', 'SCALE')).toEqual([20, 20, 40, 60])
  const shrink = pinned('STRETCH')
  expect(resizeNode(shrink.doc, shrink.f, { x: 0, y: 0, width: 100, height: 100 }).nodes[shrink.k].width).toBe(0) // never negative
})

test('constraints: nested frames cascade; auto-layout frames ignore them; dragging the left edge keeps MIN glued to it', () => {
  const p = pinned('STRETCH')
  let d = patch(p.doc, [p.k], { type: 'FRAME' })
  const inner = makeNode('RECTANGLE', { x: 0, y: 0, width: 10, height: 10, constraints: { h: 'MAX', v: 'MIN' } })
  d = insert(d, inner, p.k)
  d = resizeNode(d, p.f, { x: 0, y: 0, width: 300, height: 100 })
  expect(d.nodes[inner.id].x).toBe(100)
  const l = pinned('MAX', 'MIN', { layout: { mode: 'HORIZONTAL', gap: 0, padding: [0, 0, 0, 0], align: 'MIN', hugW: false, hugH: false } })
  expect(resizeNode(l.doc, l.f, { x: 0, y: 0, width: 300, height: 100 }).nodes[l.k].x).toBe(20)
  const m = pinned('MIN')
  const { store } = open()
  store.update(() => m.doc)
  store.set({ pageId: m.doc.pages[0], selection: [m.f] })
  drag(store, at(0, 50), at(-50, 50)) // left handle
  const s = store.get().doc
  expect(s.nodes[m.f]).toMatchObject({ x: -50, width: 250 })
  expect(worldBox(s, [m.k])!.x).toBe(-30) // moved with the left edge
})

test('gradients: defaults, angle, rotation, conversion and interpolation', () => {
  const lin = gradient('LINEAR', black)
  expect(lin).toMatchObject({ from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, stops: [{ pos: 0, color: black }, { pos: 1, color: { ...black, a: 0 } }] })
  expect(gradientAngle(lin)).toBe(90)
  const turned = rotateGradient(lin, 0)
  near(turned.from.x, 0); near(turned.from.y, 0.5); near(turned.to.x, 1); near(turned.to.y, 0.5) // about the midpoint
  const rad = rotateGradient(gradient('RADIAL', black), 90)
  expect(rad.from).toEqual({ x: 0.5, y: 0.5 }); near(rad.to.x, 0.5); near(rad.to.y, 1) // about the centre
  expect(convertPaint(lin, 'SOLID')).toEqual({ type: 'SOLID', visible: true, color: black })
  expect(convertPaint({ type: 'SOLID', visible: false, color: black }, 'DIAMOND')).toMatchObject({ type: 'GRADIENT', kind: 'DIAMOND', visible: false, from: { x: 0.5, y: 0.5 } })
  const custom = { ...lin, stops: [{ pos: 0.2, color: black }, { pos: 0.8, color: { r: 1, g: 1, b: 1, a: 1 } }] }
  expect(convertPaint(custom, 'RADIAL')).toMatchObject({ kind: 'RADIAL', stops: custom.stops })
  const mid = colorAt(custom.stops, 0.5)
  near(mid.r, 0.5); near(mid.b, 0.5); expect(mid.a).toBe(1)
  expect(colorAt(custom.stops, 0)).toEqual(black)
  expect(colorAt(custom.stops, 1).r).toBe(1)
})

test('gradients: SVG export draws linear/radial in the scaled box, diamond as four quadrants, angular falls back', () => {
  const { doc, page } = scene()
  const add = (fills: Paint[], props: Partial<Node> = {}) => { const n = makeNode('RECTANGLE', { x: 0, y: 0, width: 200, height: 100, fills, ...props }); return { d: insert(doc, n, page), id: n.id } }
  const lin = add([gradient('LINEAR', { r: 1, g: 0, b: 0, a: 1 })])
  const svg = toSvg(lin.d, [lin.id], () => undefined)
  expect(svg).toContain('<linearGradient id="g1" gradientUnits="userSpaceOnUse" gradientTransform="scale(200 100) matrix(0 1 -1 0 1 0)" x1="0" y1="0" x2="1" y2="0">')
  expect(svg).toContain('<stop offset="0" stop-color="rgb(255,0,0)" stop-opacity="1"/><stop offset="1" stop-color="rgb(255,0,0)" stop-opacity="0"/>')
  expect(svg).toContain('fill="url(#g1)"')
  const rad = add([gradient('RADIAL', black)])
  expect(toSvg(rad.d, [rad.id], () => undefined)).toContain('<radialGradient id="g1" gradientUnits="userSpaceOnUse" gradientTransform="scale(200 100) matrix(1 0 0 1 0 0)" cx="0.5" cy="0.5" fx="0.5" fy="0.5" r="0.5">')
  const dia = add([gradient('DIAMOND', black)])
  const dsvg = toSvg(dia.d, [dia.id], () => undefined)
  expect(dsvg.match(/<linearGradient /g)).toHaveLength(4)
  expect(dsvg.match(/<g clip-path=/g)).toHaveLength(4)
  const ang = add([], { strokes: [gradient('ANGULAR', { r: 0, g: 0, b: 1, a: 1 })], strokeWeight: 2 })
  expect(toSvg(ang.d, [ang.id], () => undefined)).toContain('stroke="rgb(0,0,255)" stroke-opacity="1"') // no conic in SVG: first stop
  const text = add([gradient('LINEAR', black)], { type: 'TEXT', characters: 'Hi', fontSize: 16, textAutoWidth: true })
  expect(toSvg(text.d, [text.id], () => undefined)).toMatch(/<text [^>]*fill="url\(#g1\)"/)
})

test('gradients: rotation turns every handle, so a rotated diamond exports rotated; vector clips keep their fill rule', () => {
  const dia = rotateGradient(gradient('DIAMOND', black), 45)
  const m = gradientMatrix(dia)!
  near(m[0], Math.SQRT1_2); near(m[1], Math.SQRT1_2) // canonical x now runs diagonally
  const skewed = rotateGradient({ ...gradient('RADIAL', black), w: { x: 0.5, y: 0.75 } }, 90)
  near(skewed.w!.x, 0.25); near(skewed.w!.y, 0.5) // the width handle turns with the others
  const { doc, page } = scene()
  const n = makeNode('RECTANGLE', { width: 200, height: 100, fills: [dia] }), d = insert(doc, n, page)
  const svg = toSvg(d, [n.id], () => undefined)
  expect(svg.match(/<polygon [^>]*transform="scale\(200 100\) matrix\(0\.707 0\.707 -0\.707 0\.707 /g)).toHaveLength(4)
  const v = makeNode('VECTOR', { width: 10, height: 10, fills: [solid(0, 0, 0)], vector: { w: 10, h: 10, fill: [{ d: 'M0 0L10 0L10 10Z', rule: 'evenodd' }], stroke: [] } })
  expect(toSvg(insert(doc, v, page), [v.id], () => undefined)).toContain('fill-rule="evenodd" clip-rule="evenodd"')
})

test('paths: parse and write back, quadratics become cubics, a closing point folds into the start', () => {
  const subs = parsePath('M0 0L10 0C10 5 5 10 0 10ZM20 20L30 20')
  expect(subs).toHaveLength(2)
  expect(subs[0]).toMatchObject({ closed: true, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0, out: { x: 10, y: 5 } }, { x: 0, y: 10, in: { x: 5, y: 10 } }] })
  expect(pathData(subs)).toBe('M0 0L10 0C10 5 5 10 0 10ZM20 20L30 20')
  const q = parsePath('M0 0Q3 3 6 0')[0].anchors
  expect(q[0].out).toEqual({ x: 2, y: 2 }); expect(q[1].in).toEqual({ x: 4, y: 2 })
  expect(parsePath('M0 0L10 0L10 10L0 0Z')[0].anchors).toHaveLength(3) // explicit return to the start
  expect(parsePath('M0 0 5 5 10 0')[0].anchors).toHaveLength(3) // pairs after M are line-tos
  expect(pathData(parsePath('M0 0L4 0L4 4Z'))).toBe('M0 0L4 0L4 4Z')
})

test('paths: a freehand stroke is simplified into few smooth anchors', () => {
  const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 2 * i }))
  expect(fitStroke(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 19, y: 38 }]) // straight: ends only, no handles
  const arc = Array.from({ length: 40 }, (_, i) => ({ x: 50 * Math.cos(i / 25), y: 50 * Math.sin(i / 25) }))
  const a = fitStroke(arc, 1)
  expect(a.length).toBeGreaterThan(2); expect(a.length).toBeLessThan(arc.length / 2)
  expect(a[0].in).toBeUndefined(); expect(a[0].out).toBeDefined(); expect(a.at(-1)!.out).toBeUndefined()
  expect(fitStroke([{ x: 1, y: 1 }, { x: 1, y: 1 }], 1)).toEqual([]) // no movement, no stroke
})

test('paths: re-fitting a rotated vector keeps every point where it was on the page', () => {
  const n = makeNode('VECTOR', { x: 100, y: 50, width: 10, height: 10, rotation: 30, vector: { w: 10, h: 10, fill: [{ d: 'M0 0L10 10', rule: 'evenodd' }], stroke: [{ d: 'M0 0Z', rule: 'nonzero' }] } })
  const pageOf = (node: Node, p: { x: number; y: number }) => apply(localMatrix(node), p)
  const before = anchorsOf(n)[0].anchors.map((a) => pageOf(n, a))
  const moved = withAnchors(n, [{ closed: false, anchors: [{ x: -5, y: 0 }, { x: 10, y: 10 }] }])
  expect(moved).toMatchObject({ width: 15, height: 10, rotation: 30, vector: { w: 15, h: 10, fill: [{ d: 'M0 0L15 10', rule: 'evenodd' }], stroke: [] } })
  const after = anchorsOf(moved)[0].anchors.map((a) => pageOf(moved, a))
  near(after[1].x, before[1].x); near(after[1].y, before[1].y) // the point that didn't move stayed put
})

test('paths: a control point sitting on its anchor is not a handle (so the anchor stays grabbable)', () => {
  const [sub] = parsePath('M0 0C10 0 20 20 20 20L0 20Z')
  expect(sub.anchors[1]).toEqual({ x: 20, y: 20 })
  expect(sub.anchors[0].out).toEqual({ x: 10, y: 0 })
  expect(pathData([sub])).toBe('M0 0C10 0 20 20 20 20L0 20Z')
})
