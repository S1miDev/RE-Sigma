import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { zoomToFit } from './viewport'
import { apply, worldMatrix, worldRotation } from '../model/geometry'
import { isTyping, keyBelongsToPage } from '../../util'
import { useEditor, useStore } from '../store'
import { beginGesture, editNode, type Gesture, type Pointer } from '../tools'
import { finishText, insertText, onEditedText, selectedText, textKey } from '../tools/textEdit'
import { hitTest } from './hit'
import { drawOverlay } from './overlay'
import { renderPage } from './render'
import { caretPos } from './caret'
import { layoutText } from './text'
import { toScreen, toWorld, zoomAt } from './viewport'


export function Canvas() {
  const store = useStore()
  const ref = useRef<HTMLCanvasElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const tool = useEditor((s) => s.tool)
  const editingText = useEditor((s) => (s.mode.kind === 'text' ? s.mode.id : null))
  const [space, setSpace] = useState(false)

  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d'), box = canvas.parentElement!
    let frame = 0
    const draw = () => {
      frame = 0
      if (!ctx) return
      const s = store.get(), dpr = window.devicePixelRatio || 1
      renderPage(ctx, s.doc, s.pageId, s.view, dpr, store.image)
      drawOverlay(ctx, s, dpr, store.image)
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
      // a focused button or menu item keeps Space for itself
      if (e.code !== 'Space' || keyBelongsToPage(e)) return
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
    const p = pointer(e)
    if (onEditedText(store, p.world)) document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit text"]')?.focus() // a press on the edited text keeps (or takes back) the keyboard
    else if (isTyping(document.activeElement)) (document.activeElement as HTMLElement).blur()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current = beginGesture(store, p, e.button === 1 || space)
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
        onMouseDown={(e) => { if (store.get().mode.kind === 'text' && onEditedText(store, pointer(e).world)) e.preventDefault() }} // keeps the keyboard focus in the text
        onPointerDown={down}
        onPointerMove={(e) => gesture.current?.move(pointer(e))}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={(e) => {
          const s = store.get(), hit = s.tool === 'move' && s.mode.kind !== 'text' && hitTest(s.doc, s.pageId, pointer(e).world, { deep: true, tolerance: 4 / s.view.zoom })
          if (hit) editNode(store, hit)
        }}
      />
      {editingText && <TextEditor key={editingText} id={editingText} />}
    </div>
  )
}

/**
 * The keyboard sink of text editing: a transparent textarea kept at the caret, so typing, IME and the clipboard work.
 * What it receives is turned into edits of the node; the text itself, caret and selection are drawn on the canvas.
 */
function TextEditor({ id }: { id: string }) {
  const store = useStore()
  const doc = useEditor((s) => s.doc), view = useEditor((s) => s.view), mode = useEditor((s) => s.mode)
  const n = doc.nodes[id]
  if (!n || mode.kind !== 'text') return null
  const caret = caretPos(layoutText(n, { editing: true }), mode.focus)
  const at = toScreen(view, apply(worldMatrix(doc, id), { x: caret.x, y: caret.y }))
  const take = (el: HTMLTextAreaElement) => {
    if (el.value) insertText(store, el.value)
    el.value = ''
  }
  return (
    <textarea
      autoFocus
      aria-label="Edit text"
      spellCheck={false}
      onBlur={(e) => { if (!(e.relatedTarget instanceof Element && e.relatedTarget.closest('[data-keep-text]'))) finishText(store, id) }} // the design panel styles the selection without ending the edit
      onInput={(e) => { if (!(e.nativeEvent as InputEvent).isComposing) take(e.currentTarget) }}
      onCompositionEnd={(e) => take(e.currentTarget)}
      onCopy={(e) => { e.preventDefault(); e.clipboardData.setData('text/plain', selectedText(store)) }}
      onCut={(e) => { e.preventDefault(); e.clipboardData.setData('text/plain', selectedText(store)); insertText(store, '') }}
      onPaste={(e) => { e.preventDefault(); insertText(store, e.clipboardData.getData('text/plain')) }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) e.currentTarget.blur()
        else if (textKey(store, { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) e.preventDefault()
      }}
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent outline-none"
      style={{ left: at.x, top: at.y, width: 2, height: Math.max(8, caret.h * view.zoom), opacity: 0.01, transformOrigin: '0 0', transform: `rotate(${worldRotation(doc, id)}deg)` }}
    />
  )
}
