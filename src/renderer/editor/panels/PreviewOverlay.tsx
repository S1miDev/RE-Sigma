import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Interaction } from '../../../shared/document'
import { Button } from '../../ui'
import { renderToCanvas } from '../canvas/render'
import { ambientInteractions, currentFrame, interactionAt, step, transitionAt, type PreviewState } from '../model/prototype'
import { useStore } from '../store'

type Anim = { from: string; to: string; it: Interaction; start: number }
const MAX_SCALE = 2

/** Fullscreen prototype preview: shows one frame at a time, runs the interactions of the layers under the pointer. Esc leaves. */
export function PreviewOverlay({ start, onReport }: { start: string; onReport(e: unknown): void }) {
  const store = useStore(), canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<PreviewState>({ stack: [start], overlays: [] })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [anim, setAnim] = useState<Anim | null>(null)
  const live = useRef({ state, anim }), hover = useRef<Interaction | null>(null)
  live.current = { state, anim }
  const doc = store.get().doc
  const dpr = window.devicePixelRatio || 1
  const frame = currentFrame(state)
  const base = doc.nodes[anim?.to ?? frame] ?? doc.nodes[start]
  const fit = Math.min(MAX_SCALE, size.w / Math.max(1, base.width), size.h / Math.max(1, base.height))

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const bitmaps = useMemo(() => new Map<string, HTMLCanvasElement | null>(), [fit, dpr])
  const bitmap = useCallback((id: string) => {
    if (!bitmaps.has(id)) bitmaps.set(id, renderToCanvas(doc, [id], fit * dpr, store.image))
    return bitmaps.get(id) ?? null
  }, [bitmaps, doc, fit, dpr, store])
  const originOf = useCallback((id: string) => {
    const n = doc.nodes[id]
    return { x: (size.w - n.width * fit) / 2, y: (size.h - n.height * fit) / 2 }
  }, [doc, size, fit])

  const run = useCallback((it: Interaction) => {
    const { state: s, anim: a } = live.current
    if (a) return // let a running transition finish
    const out = step(doc, s, it)
    if (out.url) store.api.openExternal(out.url).catch(onReport)
    if (out.state === s) return
    const to = currentFrame(out.state), slide = it.action === 'navigate' && it.transition !== 'instant' && it.duration > 0
    setState(out.state)
    if (slide && to !== currentFrame(s)) setAnim({ from: currentFrame(s), to, it, start: performance.now() })
  }, [doc, store, onReport])

  // Draw. A running transition schedules its own next frame.
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d')
    if (!el || !ctx) return
    let raf = 0
    const paint = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, size.w, size.h)
      const put = (id: string, dx = 0, dy = 0, alpha = 1) => {
        const n = doc.nodes[id], bmp = bitmap(id), o = originOf(id)
        if (!n || !bmp) return
        ctx.globalAlpha = alpha
        ctx.drawImage(bmp, o.x + dx * n.width * fit, o.y + dy * n.height * fit, n.width * fit, n.height * fit)
        ctx.globalAlpha = 1
      }
      let t = 1
      if (anim) {
        t = Math.min(1, (now - anim.start) / anim.it.duration)
        const o = originOf(anim.to), n = doc.nodes[anim.to], p = transitionAt(anim.it.transition, t, anim.it.easing)
        ctx.save()
        ctx.beginPath()
        ctx.rect(o.x, o.y, n.width * fit, n.height * fit)
        ctx.clip()
        put(anim.from, p.from.dx, p.from.dy, p.from.alpha)
        put(anim.to, p.to.dx, p.to.dy, p.to.alpha)
        ctx.restore()
      } else put(frame)
      if (!anim) for (const id of state.overlays) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)'
        ctx.fillRect(0, 0, size.w, size.h)
        put(id)
      }
      if (anim && t >= 1) setAnim(null)
      else if (anim) raf = requestAnimationFrame(paint)
    }
    el.width = size.w * dpr
    el.height = size.h * dpr
    paint(performance.now())
    return () => cancelAnimationFrame(raf)
  }, [anim, state, size, doc, frame, fit, dpr, bitmap, originOf])

  const exit = useCallback(() => store.set({ preview: null }), [store])
  const topId = state.overlays.at(-1) ?? frame
  const local = (e: { clientX: number; clientY: number }) => {
    const o = originOf(topId), r = canvas.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left - o.x) / fit, y: (e.clientY - r.top - o.y) / fit }
  }
  const fire = (trigger: Interaction['trigger'], e: React.PointerEvent | React.MouseEvent) => {
    const it = interactionAt(doc, topId, local(e), trigger)
    if (it) run(it)
  }

  // Keys: Escape leaves, `key` triggers run. Captured so the editor underneath never sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return exit()
      const it = ambientInteractions(doc, topId, 'key').find((i) => i.key === e.key)
      if (it) { e.preventDefault(); run(it) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [doc, topId, run, exit])

  // Delay triggers start when their frame appears and stop when it goes.
  useEffect(() => {
    if (anim) return
    const timers = ambientInteractions(doc, topId, 'delay').map((it) => setTimeout(() => run(it), it.delay ?? 0))
    return () => timers.forEach(clearTimeout)
  }, [doc, topId, anim, run])

  return (
    <div role="dialog" aria-label="Prototype preview" className="fixed inset-0 z-50 bg-black">
      <canvas
        ref={canvas} aria-label="Preview" className="h-full w-full"
        style={{ width: size.w, height: size.h }}
        onPointerDown={(e) => fire('press', e)}
        onClick={(e) => fire('click', e)}
        onPointerMove={(e) => {
          const it = interactionAt(doc, topId, local(e), 'hover')
          if (it !== hover.current && (hover.current = it)) run(it)
        }}
      />
      <div className="absolute right-3 top-3 flex gap-2 opacity-70 hover:opacity-100">
        <Button onClick={() => { setAnim(null); setState({ stack: [start], overlays: [] }) }}>Restart</Button>
        <Button onClick={exit}>Exit (Esc)</Button>
      </div>
    </div>
  )
}
