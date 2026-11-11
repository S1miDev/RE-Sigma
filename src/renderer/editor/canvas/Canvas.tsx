import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { zoomToFit } from '../commands'
import { apply, worldMatrix, worldRotation } from '../model/geometry'
import { patch, remove } from '../model/ops'
import { isTyping } from '../../util'
import { useEditor, useStore } from '../store'
import { beginGesture, textTag, type Gesture, type Pointer } from '../tools'
import { hitTest } from './hit'
import { drawOverlay } from './overlay'
import { css, renderPage } from './render'
import { fontOf, lineHeightOf } from './text'
import { toScreen, toWorld, zoomAt } from './viewport'


export function Canvas() {
  const store = useStore()
  const ref = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const tool = useEditor((s) => s.tool)
  const editingText = useEditor((s) => s.editingText)
  const [space, setSpace] = useState(false)

  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d'), box = canvas.parentElement!
    let frame = 0
    const draw = () => {
      frame = 0
      if (!ctx) return
      const s = store.get(), dpr = window.devicePixelRatio || 1
      renderPage(ctx, s.doc, s.pageId, s.view, dpr, store.image, s.editingText)
      drawOverlay(ctx, s, dpr)
    }
    const schedule = () => (frame ||= requestAnimationFrame(draw))
    const resize = () => {
      const r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, first = !store.get().size.w
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
      store.set({ size: { w: r.width, h: r.height } })
      if (first && r.width) zoomToFit(store, 1)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(box)
    resize()

    // Ctrl+wheel and trackpad pinch zoom at the pointer; plain wheel pans. Not passive, so the page itself never zooms or scrolls.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view } = store.get(), r = canvas.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const k = Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025 // pinch sends small deltas, a mouse wheel large ones
        store.set({ view: zoomAt(view, { x: e.clientX - r.left, y: e.clientY - r.top }, view.zoom * Math.exp(-e.deltaY * k)) })
      } else store.set({ view: { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY } })
    }
    canvas.addEventListener('wheel', wheel, { passive: false })

    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return
      e.preventDefault()
      setSpace(e.type === 'keydown')
    }
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    document.fonts?.addEventListener?.('loadingdone', schedule) // redraw once the bundled font is ready
    const unsubscribe = store.subscribe(schedule)
    schedule()
    return () => {
      unsubscribe()
      observer?.disconnect()
      cancelAnimationFrame(frame)
      canvas.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      document.fonts?.removeEventListener?.('loadingdone', schedule)
    }
  }, [store])

  const pointer = (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Pointer => {
    const r = ref.current!.getBoundingClientRect(), screen = { x: e.clientX - r.left, y: e.clientY - r.top }
    return { screen, world: toWorld(store.get().view, screen), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey }
  }
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) return
    // Commit a focused text field (canvas text or a panel input) before the gesture snapshots the document.
    if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current = beginGesture(store, pointer(e), e.button === 1 || space)
  }
  const up = (e: ReactPointerEvent) => {
    gesture.current?.up(pointer(e))
    gesture.current = null
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas
        ref={ref}
        aria-label="Canvas"
        className="block h-full w-full touch-none"
        style={{ cursor: space || tool === 'hand' ? 'grab' : tool === 'move' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}
        onPointerDown={down}
        onPointerMove={(e) => gesture.current?.move(pointer(e))}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          const s = store.get(), hit = s.tool === 'move' && hitTest(s.doc, s.pageId, pointer(e).world, { deep: true, tolerance: 4 / s.view.zoom })
          if (hit) store.set({ selection: [hit], editingText: s.doc.nodes[hit].type === 'TEXT' ? hit : null })
        }}
      />
      {editingText && <TextEditor key={editingText} id={editingText} />}
    </div>
  )
}

/** A textarea laid over the text node being edited. Commits on blur, Escape or Ctrl+Enter; empty text removes the node. */
function TextEditor({ id }: { id: string }) {
  const store = useStore()
  const doc = useEditor((s) => s.doc), view = useEditor((s) => s.view)
  const n = doc.nodes[id]
  if (!n) return null
  const at = toScreen(view, apply(worldMatrix(doc, id), { x: 0, y: 0 }))
  const fill = n.fills.find((p) => p.visible && p.type === 'SOLID')

  const commit = (value: string) => {
    const now = store.get().doc.nodes[id]
    store.set({ editingText: null })
    if (!now) return
    const tag = now.characters === '' ? textTag(id) : undefined // the first commit joins the undo step that created the node
    if (!value) store.update((d) => remove(d, [id]), tag)
    else if (value !== now.characters) {
      // The layer is named after its text until the user renames it.
      const named = now.name === 'Text' || now.name === now.characters?.split('\n')[0].slice(0, 40)
      store.update((d) => patch(d, [id], { characters: value, ...(named && { name: value.split('\n')[0].slice(0, 40) }) }), tag)
    }
  }

  return (
    <textarea
      autoFocus
      aria-label="Edit text"
      spellCheck={false}
      defaultValue={n.characters}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) e.currentTarget.blur()
      }}
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-1 outline-accent"
      style={{
        left: at.x, top: at.y, transformOrigin: '0 0', transform: `rotate(${worldRotation(doc, id)}deg)`,
        font: fontOf(n, view.zoom), lineHeight: `${lineHeightOf(n) * view.zoom}px`, letterSpacing: `${(n.letterSpacing ?? 0) * view.zoom}px`,
        textAlign: (n.textAlign ?? 'LEFT').toLowerCase() as CSSProperties['textAlign'],
        color: fill?.type === 'SOLID' ? css(fill.color) : '#000',
        width: n.textAutoWidth ? undefined : n.width * view.zoom, minWidth: 4,
        whiteSpace: n.textAutoWidth ? 'pre' : 'pre-wrap',
        fieldSizing: 'content', // grows with its content
      } as CSSProperties}
    />
  )
}
