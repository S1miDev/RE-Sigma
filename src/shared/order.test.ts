import { expect, test } from 'vitest'
import { orderBetween } from './order'

test('orderBetween returns a key strictly between its bounds', () => {
  expect(orderBetween() > '').toBe(true)
  const a = orderBetween(), b = orderBetween(a), mid = orderBetween(a, b)
  expect(a < mid && mid < b).toBe(true)
  expect(orderBetween('', a) < a).toBe(true)
})

test('stays ordered through many appends, prepends and random inserts', () => {
  const keys = [orderBetween()]
  for (let i = 0; i < 300; i++) keys.push(orderBetween(keys.at(-1)))
  for (let i = 0; i < 300; i++) keys.unshift(orderBetween('', keys[0]))
  let seed = 7
  for (let i = 0; i < 2000; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const at = seed % (keys.length - 1)
    keys.splice(at + 1, 0, orderBetween(keys[at], keys[at + 1]))
  }
  for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true)
  // always inserting at the same spot must also work
  let lo = keys[0]
  const hi = keys[1]
  for (let i = 0; i < 200; i++) {
    const k = orderBetween(lo, hi)
    expect(lo < k && k < hi).toBe(true)
    lo = k
  }
})
