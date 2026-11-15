import { useEffect, useRef } from 'react'
import { useEditor, useStore } from '../store'
import { currentSession, stopPlugin } from './host'

/** The running plugin's UI: a floating panel with a sandboxed iframe (scripts only, opaque origin, no network). */
export function PluginUI() {
  const store = useStore(), plugin = useEditor((s) => s.plugin)
  const frame = useRef<HTMLIFrameElement>(null), ui = plugin?.ui
  useEffect(() => {
    if (!ui) return
    const session = currentSession(store)
    session?.attachUI(frame.current)
    // Only the iframe's own window may speak for the UI.
    const onMessage = (e: MessageEvent) => e.source === frame.current?.contentWindow && session?.fromUI(e.data)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stopPlugin(store)
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey)
    return () => {
      session?.attachUI(null)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey)
    }
  }, [store, ui])
  if (!plugin || !ui) return null
  return (
    <div role="dialog" aria-label={plugin.name} className="fixed bottom-4 right-80 z-40 flex flex-col overflow-hidden rounded-md border border-line bg-panel shadow-xl" style={{ width: ui.w }}>
      <div className="flex h-7 items-center justify-between border-b border-line px-2">
        <span className="truncate font-medium">{plugin.name}</span>
        <button type="button" aria-label="Close plugin" className="rounded px-1 hover:bg-hover" onClick={() => stopPlugin(store)}>×</button>
      </div>
      <iframe ref={frame} title={plugin.name} src={ui.src} sandbox="allow-scripts" style={{ height: ui.h }} className="block w-full border-0 bg-white" />
    </div>
  )
}
