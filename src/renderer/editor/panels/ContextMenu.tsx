import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MenuList, type MenuItem } from '../../ui'
import { COMMANDS, isEnabled, type Actions } from '../commands'
import { useEditor, useStore } from '../store'

type At = { x: number; y: number }
const Open = createContext<(at: At) => void>(() => {})
/** Opens the context menu at a screen point. The caller selects what was clicked first. */
export const useContextMenu = () => useContext(Open)

// Command ids per section; null = separator. Disabled items stay visible so the menu doesn't jump.
const SELECTED = [
  'cut', 'copy', 'paste', 'duplicate', 'delete', null,
  'bring-front', 'bring-forward', 'send-backward', 'send-back', null,
  'group', 'ungroup', 'frame-selection', 'add-auto-layout', 'remove-auto-layout', null,
  'use-as-mask', 'union', 'subtract', 'intersect', 'exclude', 'flatten', null,
  'create-component', 'create-instance', 'go-to-main', 'reset-instance', 'detach-instance', null,
  'select-parent', 'toggle-visible', 'toggle-lock', null,
  'export',
]
const NOTHING = ['paste', 'select-all']

export function ContextMenuHost({ actions, children }: { actions: Actions; children: ReactNode }) {
  const [at, setAt] = useState<At | null>(null)
  return (
    <Open.Provider value={setAt}>
      {children}
      {at && <ContextMenu at={at} actions={actions} onClose={() => setAt(null)} />}
    </Open.Provider>
  )
}

function ContextMenu({ at, actions, onClose }: { at: At; actions: Actions; onClose(): void }) {
  const store = useStore()
  const some = useEditor((s) => s.selection.length > 0)
  useEditor((s) => s) // enabled states follow the editor while the menu is open
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(at)
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({ x: Math.max(0, Math.min(at.x, innerWidth - r.width)), y: Math.max(0, Math.min(at.y, innerHeight - r.height)) })
  }, [at, some])
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const items: MenuItem[] = (some ? SELECTED : NOTHING).map((id) => {
    const c = id && COMMANDS.find((c) => c.id === id)
    return c ? { label: c.label, shortcut: c.keys?.[0], disabled: !isEnabled(c, store), onSelect: () => c.run(store, actions) } : null
  })
  return (
    <div ref={ref} className="fixed z-50" style={{ left: pos.x, top: pos.y }}>
      <MenuList label="Context menu" items={items} onClose={onClose} />
    </div>
  )
}
