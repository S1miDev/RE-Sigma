// Prototype preview logic, kept pure so it can be unit-tested without a canvas.
import type { Document, Interaction, Node } from '../../../shared/document'
import { hitTest } from '../canvas/hit'
import type { Pt } from './geometry'
import { childrenOf } from './ops'

export type PreviewState = { stack: string[]; overlays: string[] }

const isFrame = (doc: Document, id: string | undefined): id is string => !!id && doc.nodes[id]?.type === 'FRAME'

/** Where a prototype can start: frames marked as flow starts, else every top-level frame of the page. */
export function startFrames(doc: Document, pageId: string): Node[] {
  const frames = childrenOf(doc, pageId).filter((n) => n.type === 'FRAME' && !n.section)
  const marked = frames.filter((n) => n.flowStart)
  return marked.length ? marked : frames
}

/**
 * The interaction a pointer or key event at `p` (frame-local coordinates) runs, found on the layer under it or its nearest
 * ancestor inside the frame that has one for `trigger`. Locked layers are hit too. `key` filters `key` triggers.
 * shortcut: frame rotation is ignored (top-level frames are rarely rotated), handle it when someone rotates a screen.
 */
export function interactionAt(doc: Document, frameId: string, p: Pt | null, trigger: Interaction['trigger'], key?: string): Interaction | null {
  const frame = doc.nodes[frameId]
  if (!frame) return null
  const match = (n: Node) => n.interactions?.find((i) => i.trigger === trigger && (trigger !== 'key' || i.key === key)) ?? null
  let id: string | null = p && hitTest(doc, frameId, p, { deep: true, ignoreLocked: true })
  while (id && id !== frameId) {
    const n = doc.nodes[id]
    const found = n && match(n)
    if (found) return found
    id = n?.parentId ?? null
  }
  // Key and delay triggers on the frame itself apply anywhere; pointer ones only inside it.
  const inside = !p || (p.x >= 0 && p.y >= 0 && p.x <= frame.width && p.y <= frame.height)
  return inside ? match(frame) : null
}

/** Every key/delay interaction in a frame (layers included), for timers and key listeners. */
export function ambientInteractions(doc: Document, frameId: string, trigger: 'key' | 'delay'): Interaction[] {
  const out: Interaction[] = []
  const walk = (id: string) => {
    for (const n of childrenOf(doc, id)) {
      if (!n.visible) continue
      out.push(...(n.interactions ?? []).filter((i) => i.trigger === trigger))
      walk(n.id)
    }
  }
  out.push(...(doc.nodes[frameId]?.interactions ?? []).filter((i) => i.trigger === trigger))
  walk(frameId)
  return out
}

export const currentFrame = (s: PreviewState) => s.stack[s.stack.length - 1]

/** Applies an interaction. A target that is gone (or not a frame) makes navigate/overlay a no-op. `url` is handed back to the caller. */
export function step(doc: Document, s: PreviewState, it: Interaction): { state: PreviewState; url?: string } {
  switch (it.action) {
    case 'navigate':
      return isFrame(doc, it.target) && it.target !== currentFrame(s) ? { state: { stack: [...s.stack, it.target], overlays: [] } } : { state: s }
    case 'overlay':
      return isFrame(doc, it.target) ? { state: { ...s, overlays: [...s.overlays.filter((o) => o !== it.target), it.target] } } : { state: s }
    case 'closeOverlay':
      return { state: { ...s, overlays: s.overlays.slice(0, -1) } }
    case 'back':
      if (s.overlays.length) return { state: { ...s, overlays: s.overlays.slice(0, -1) } }
      return s.stack.length > 1 ? { state: { stack: s.stack.slice(0, -1), overlays: [] } } : { state: s }
    case 'url':
      return it.url ? { state: s, url: it.url } : { state: s }
  }
}

/** The frame a preview starts from: the top-level frame holding the selection, else the first start frame. */
export function presentFrom(doc: Document, pageId: string, selection: string[]): string | null {
  for (let id: string | null = selection[0] ?? null; id && doc.nodes[id]; id = doc.nodes[id].parentId)
    if (doc.nodes[id].parentId === pageId && doc.nodes[id].type === 'FRAME') return id
  return startFrames(doc, pageId)[0]?.id ?? null
}

const ease =(t: number, e: Interaction['easing']) =>
  e === 'easeIn' ? t * t : e === 'easeOut' ? 1 - (1 - t) ** 2 : e === 'easeInOut' ? (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2) : t

export type Placement = { dx: number; dy: number; alpha: number } // offsets as fractions of the frame size
/** Placement of the outgoing (`from`) and incoming (`to`) frame at progress t in 0..1. */
export function transitionAt(kind: Interaction['transition'], t: number, easing: Interaction['easing'] = 'linear'): { from: Placement; to: Placement } {
  const k = ease(Math.min(1, Math.max(0, t)), easing)
  switch (kind) {
    case 'dissolve': return { from: { dx: 0, dy: 0, alpha: 1 - k }, to: { dx: 0, dy: 0, alpha: k } }
    case 'slideLeft': return { from: { dx: -k, dy: 0, alpha: 1 }, to: { dx: 1 - k, dy: 0, alpha: 1 } }
    case 'slideRight': return { from: { dx: k, dy: 0, alpha: 1 }, to: { dx: k - 1, dy: 0, alpha: 1 } }
    case 'slideUp': return { from: { dx: 0, dy: -k, alpha: 1 }, to: { dx: 0, dy: 1 - k, alpha: 1 } }
    case 'slideDown': return { from: { dx: 0, dy: k, alpha: 1 }, to: { dx: 0, dy: k - 1, alpha: 1 } }
    default: return { from: { dx: 0, dy: 0, alpha: k < 1 ? 1 : 0 }, to: { dx: 0, dy: 0, alpha: k < 1 ? 0 : 1 } }
  }
}
