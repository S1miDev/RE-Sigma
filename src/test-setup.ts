import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
  // jsdom has no canvas; the renderer treats a null context as "skip drawing".
  HTMLCanvasElement.prototype.getContext = (() => null) as never
}
