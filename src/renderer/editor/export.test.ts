// Export: SVG region crop, file naming of saved settings.
import { expect, test } from 'vitest'
import { emptyDocument, makeNode, solid, type Document } from '../../shared/document'
import { defaultSetting, scaledName } from './export'
import { toSvg } from './export/svg'
import { insert } from './model/ops'

test('toSvg crops to a region instead of the nodes\' bounding box', () => {
  let doc: Document = emptyDocument()
  const page = doc.pages[0], r = makeNode('RECTANGLE', { x: 50, y: 50, width: 100, height: 100, fills: [solid(1, 0, 0)] })
  doc = insert(doc, r, page)
  const svg = toSvg(doc, [r.id], () => undefined, () => undefined, { x: 10, y: 20, w: 30, h: 40 })
  expect(svg).toContain('width="30" height="40" viewBox="10 20 30 40"')
  expect(svg).toContain('<rect ')
})

test('raster files above 1x get an @Nx name; vector files and 1x do not', () => {
  expect([scaledName('A', 'png', 1), scaledName('A', 'webp', 2), scaledName('A', 'svg', 2)]).toEqual(['A', 'A@2x', 'A'])
  expect(defaultSetting('jpg', 3)).toEqual({ suffix: '@3x', format: 'jpg', scale: 3 })
  expect(defaultSetting('pdf', 3).suffix).toBe('')
})
