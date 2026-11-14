// @vitest-environment jsdom
// SVG import: path normalisation and the shape → VECTOR conversion.
import { expect, test } from 'vitest'
import { importSvg } from './importSvg'
import { parsePath } from './model/path'
import { absolutePath } from './model/svgPath'

test('relative, H/V and S/T commands become absolute', () => {
  expect(absolutePath('m1 2 l3 4 h5 v-1 z')).toBe('M1 2L4 6L9 6L9 5Z')
  expect(absolutePath('M0 0C1 1 2 1 3 0S5 -1 6 0')).toBe('M0 0C1 1 2 1 3 0C4 -1 5 -1 6 0')
  expect(absolutePath('M0 0Q1 1 2 0T4 0')).toBe('M0 0Q1 1 2 0Q3 -1 4 0')
  expect(absolutePath('M0 0 10 0 10 10')).toBe('M0 0L10 0L10 10') // implicit line-tos after M
})

test('an arc becomes cubics that reach its end point', () => {
  const d = absolutePath('M0 0A5 5 0 0 1 10 0')
  expect(d.match(/C/g)).toHaveLength(2) // a half circle is two quarter arcs
  const [sub] = parsePath(d)
  const end = sub.anchors.at(-1)!
  expect(end.x).toBeCloseTo(10)
  expect(end.y).toBeCloseTo(0)
  expect(sub.anchors[1].y).toBeLessThan(-4.9) // sweep=1 from left to right goes over the top (y down)
})

test('shapes become vectors with styles, transforms and a viewBox scale', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="20" height="20">
    <g transform="translate(1 1)" fill="#ff0000" opacity="0.5"><rect id="box" width="4" height="4"/></g>
    <circle cx="5" cy="5" r="2" fill="none" stroke="rgb(0,0,255)" stroke-width="1"/>
  </svg>`
  const { nodes, root, skipped } = importSvg(svg, 'icon.svg')
  expect([root.name, root.width, root.height]).toEqual(['icon', 20, 20])
  const box = nodes.find((n) => n.name === 'box')!
  expect([box.x, box.y, box.width, box.height]).toEqual([2, 2, 8, 8]) // (1..5) × 2
  expect(box.opacity).toBe(0.5)
  expect(box.fills[0]).toMatchObject({ type: 'SOLID', color: { r: 1, g: 0, b: 0 } })
  const ring = nodes.find((n) => n.name === 'Circle')!
  expect(ring.fills).toEqual([])
  expect(ring.strokeWeight).toBe(2) // 1 × the viewBox scale
  expect(ring.parentId).toBe(root.id)
  expect(skipped).toEqual([])
})

test('unsupported features are reported, and non-SVG or empty input throws', () => {
  const { skipped } = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><path d="M0 0L9 9L0 9Z" fill="url(#g)"/><path d="M0 0L5 5L0 5Z"/><text>x</text></svg>', 'a.svg')
  expect(skipped).toContain('gradient or pattern paint')
  expect(skipped).toContain('<text>')
  expect(() => importSvg('hello', 'a.svg')).toThrow(/valid SVG/)
  expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"/>', 'a.svg')).toThrow(/nothing drawable/)
})
