// Star, polygon, arrow, ellipse arcs, per-corner radii and corner smoothing: their outlines and where they show up.
import { expect, test } from 'vitest'
import { makeNode, solid, type Node } from '../../shared/document'
import { toSvg } from './export/svg'
import { childrenOf, insert, patch } from './model/ops'
import { anchorsOf, parsePath, type Sub } from './model/path'
import { arcPath, arrowSubs, cornerPath, starPath } from './model/shapes'
import { components, open, run } from './testkit'

type P = { x: number; y: number }
/** Points along every subpath (curves sampled), for measuring areas and bounds. */
function outline(d: string): P[][] {
  return parsePath(d).map(({ anchors: a, closed }) => {
    const pts: P[] = [{ x: a[0].x, y: a[0].y }]
    const seg = (p: (typeof a)[number], q: (typeof a)[number]) => {
      const c1 = p.out ?? p, c2 = q.in ?? q
      for (let i = 1; i <= 40; i++) {
        const t = i / 40, u = 1 - t
        pts.push({ x: u ** 3 * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * q.x, y: u ** 3 * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * q.y })
      }
    }
    for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i])
    if (closed && (a.at(-1)!.out || a[0].in)) seg(a.at(-1)!, a[0])
    return pts
  })
}
const shoelace = (pts: P[]) => pts.reduce((a, p, i) => a + (p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y), 0) / 2
/** Enclosed area with holes subtracted (a hole is wound the other way). */
const area = (d: string) => Math.abs(outline(d).reduce((sum, pts) => sum + shoelace(pts), 0))

test('corners: no radius is a plain box, one radius rounds only that corner', () => {
  expect(cornerPath(100, 60, [0, 0, 0, 0])).toBe('M100 0L100 60L0 60L0 0Z')
  expect(area(cornerPath(100, 60, [0, 20, 0, 0]))).toBeCloseTo(6000 - 400 * (1 - Math.PI / 4), 0)
  expect(area(cornerPath(100, 60, [20, 20, 20, 20]))).toBeCloseTo(6000 - 4 * 400 * (1 - Math.PI / 4), 0)
  expect(area(cornerPath(100, 60, [999, 999, 999, 999]))).toBeCloseTo(area(cornerPath(100, 60, [30, 30, 30, 30])), 0) // clamped to half the short side
})

test('corners: smoothing eases the curve and stays inside the box', () => {
  const round = area(cornerPath(100, 60, [20, 20, 20, 20])), smooth = area(cornerPath(100, 60, [20, 20, 20, 20], 0.6))
  expect(smooth).toBeLessThan(round)
  for (const p of outline(cornerPath(100, 60, [20, 20, 20, 20], 0.6)).flat()) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(100 + 1e-6)
    expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeLessThanOrEqual(60 + 1e-6)
  }
  expect(area(cornerPath(100, 60, [20, 20, 20, 20], 5))).toBeGreaterThan(0) // out-of-range smoothing is capped, never broken
  expect(parsePath(cornerPath(100, 60, [20, 0, 0, 0], 1))[0].closed).toBe(true)
})

test('arcs: a sector, a ring segment and a full ring', () => {
  expect(area(arcPath(100, 100, { start: 0, sweep: 90, inner: 0 }))).toBeCloseTo((Math.PI * 2500) / 4, 0)
  expect(area(arcPath(100, 100, { start: 0, sweep: 90, inner: 0.5 }))).toBeCloseTo((Math.PI * (2500 - 625)) / 4, 0)
  expect(area(arcPath(100, 100, { start: 0, sweep: 360, inner: 0 }))).toBeCloseTo(Math.PI * 2500, 0)
  expect(area(arcPath(100, 100, { start: 90, sweep: 360, inner: 0.5 }))).toBeCloseTo(Math.PI * (2500 - 625), 0) // the hole is wound the other way
  expect(area(arcPath(100, 100, { start: 0, sweep: -180, inner: 0 }))).toBeCloseTo((Math.PI * 2500) / 2, 0) // a negative sweep runs counter-clockwise
})

test('stars and polygons: vertex counts, first vertex up', () => {
  expect(parsePath(starPath(100, 100, 5, 0.4))[0].anchors).toHaveLength(10)
  expect(parsePath(starPath(100, 100, 6, 1))[0].anchors).toHaveLength(6)
  expect(starPath(100, 100, 5, 0.4).startsWith('M50 0L')).toBe(true)
  expect(parsePath(starPath(100, 100, 1, 0.4))[0].anchors).toHaveLength(6) // at least a triangle's worth of points
})

test('arrow: a shaft ending at the tip and a closed head', () => {
  const [shaft, head] = arrowSubs({ x: 0, y: 0 }, { x: 100, y: 0 }, 12) as [Sub, Sub]
  expect(shaft.anchors.at(-1)).toEqual({ x: 100, y: 0 })
  expect(head.closed).toBe(true)
  expect(head.anchors[0]).toEqual({ x: 100, y: 0 })
  expect(head.anchors[1].x).toBeCloseTo(88); expect(head.anchors[2].x).toBeCloseTo(88)
})

test('star node: its outline follows points, inner radius and size, and an instance follows the main', () => {
  const { store, page } = open()
  const s = makeNode('STAR', { x: 0, y: 0, width: 100, height: 100, points: 5, innerRatio: 0.4, fills: [solid(1, 0, 0)] })
  store.update((d) => insert(d, s, page))
  const subs = () => anchorsOf(store.get().doc.nodes[s.id])[0].anchors
  expect(subs()).toHaveLength(10)
  store.update((d) => patch(d, [s.id], { points: 7 }))
  expect(subs()).toHaveLength(14)
  store.update((d) => patch(d, [s.id], { width: 200 }))
  expect(Math.max(...subs().map((a) => a.x))).toBeLessThanOrEqual(200 + 1e-6)
  expect(Math.max(...subs().map((a) => a.x))).toBeGreaterThan(150)
  const c = components()
  const star = makeNode('STAR', { x: 5, y: 5, width: 20, height: 20, points: 5, innerRatio: 0.4 })
  c.store.update((d) => insert(d, star, c.m))
  c.store.update((d) => patch(d, [star.id], { points: 8 }))
  const mirrored = childrenOf(c.store.get().doc, c.i).find((k) => k.type === 'STAR')!
  expect(mirrored.points).toBe(8)
  expect(anchorsOf(mirrored)[0].anchors).toHaveLength(16)
})

test('rendering: per-corner radii and smoothing export as paths, a uniform radius stays a rect, arcs export as paths', () => {
  const { store, page } = open()
  const make = (props: Partial<Node>) => { const n = makeNode('RECTANGLE', { width: 100, height: 60, fills: [solid(1, 0, 0)], ...props }); store.update((d) => insert(d, n, page)); return n.id }
  const svg = (id: string) => toSvg(store.get().doc, [id], () => undefined)
  expect(svg(make({ cornerRadius: 8 }))).toMatch(/<rect [^>]*rx="8"/)
  expect(svg(make({ cornerRadii: [0, 10, 20, 30] }))).toContain('<path d="M')
  expect(svg(make({ cornerRadius: 8, cornerSmoothing: 0.6 }))).toContain('<path d="M')
  const e = makeNode('ELLIPSE', { width: 100, height: 100, fills: [solid(0, 0, 1)], arc: { start: 0, sweep: 90, inner: 0 } })
  store.update((d) => insert(d, e, page))
  expect(svg(e.id)).toContain('<path d="M50 50L')
})

test('booleans: a star subtracted from a rectangle leaves a hole; an arc operand works', () => {
  const { store, page } = open()
  const r = makeNode('RECTANGLE', { x: 0, y: 0, width: 100, height: 100, fills: [solid(1, 0, 0)] })
  const s = makeNode('STAR', { x: 25, y: 25, width: 50, height: 50, points: 5, innerRatio: 0.4 })
  store.update((d) => insert(insert(d, r, page), s, page))
  store.set({ selection: [r.id, s.id] })
  run(store, 'subtract')
  const b = store.get().doc.nodes[store.get().selection[0]]
  expect(anchorsOf(b)).toHaveLength(2) // outer square and the star-shaped hole
  const a = makeNode('ELLIPSE', { x: 200, y: 0, width: 100, height: 100, arc: { start: 0, sweep: 90, inner: 0 } })
  const q = makeNode('RECTANGLE', { x: 200, y: 0, width: 100, height: 100 })
  store.update((d) => insert(insert(d, q, page), a, page))
  store.set({ selection: [q.id, a.id] })
  run(store, 'intersect')
  expect(area(store.get().doc.nodes[store.get().selection[0]].vector!.fill[0].d)).toBeCloseTo((Math.PI * 2500) / 4, -1)
})
