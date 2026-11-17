import { useMemo, useState } from 'react'
import { Dialog, Input } from '../../ui'
import { fitView, zoomToFit } from '../canvas/viewport'
import { COMMANDS, isEnabled, type Actions } from '../commands'
import { worldBox } from '../model/geometry'
import { pageOf } from '../model/ops'
import { runPlugin } from '../plugins/host'
import { useStore } from '../store'
import { showPage } from '../tools'

interface Item { key: string; label: string; hint?: string; disabled?: boolean; run(): void }
const MAX = 50

/** Ctrl+K: commands, pages and layers (of every page) in one list, filtered by name. */
export function Palette({ actions, onClose }: { actions: Actions; onClose(): void }) {
  const store = useStore()
  const [query, setQuery] = useState(''), [active, setActive] = useState(0)

  const items = useMemo(() => {
    const q = query.trim().toLowerCase(), { doc } = store.get()
    const match = (s: string) => s.toLowerCase().includes(q)
    const out: Item[] = COMMANDS.filter((c) => c.id !== 'command-palette' && match(c.label))
      .map((c) => ({ key: `c:${c.id}`, label: c.label, hint: c.keys?.[0], disabled: !isEnabled(c, store), run: () => c.run(store, actions) }))
    for (const p of store.get().plugins)
      for (const c of p.commands) {
        const label = p.commands.length > 1 ? `${p.name} › ${c.label}` : p.name
        if (match(label)) out.push({ key: `x:${p.id}:${c.id}`, label, hint: 'Plugin', run: () => void runPlugin(store, p, c.id) })
      }
    if (q) {
      for (const id of doc.pages) if (match(doc.nodes[id].name)) out.push({ key: `p:${id}`, label: doc.nodes[id].name, hint: 'Page', run: () => { showPage(store, id); zoomToFit(store, 1) } })
      for (const n of Object.values(doc.nodes)) {
        const page = n.type !== 'PAGE' && pageOf(doc, n.id)
        if (page && match(n.name)) out.push({ key: `n:${n.id}`, label: n.name, hint: doc.nodes[page].name, run: () => {
          showPage(store, page, [n.id])
          const s = store.get()
          store.set({ view: fitView(worldBox(s.doc, [n.id]), s.size) })
        } })
      }
    }
    return out.slice(0, MAX)
  }, [query, store, actions])

  const pick = (item?: Item) => {
    if (!item || item.disabled) return
    onClose() // first, so a command that opens a dialog (Export) isn't fighting this one for focus
    item.run()
  }
  const at = Math.min(active, items.length - 1)
  return (
    <Dialog title="Command palette" onClose={onClose}>
      <Input
        autoFocus
        aria-label="Search commands, pages and layers"
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={items[at] ? `palette-${at}` : undefined}
        className="w-full"
        placeholder="Search commands, pages and layers"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(items.length ? (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length : 0)
          } else if (e.key === 'Enter') pick(items[at])
        }}
      />
      <ul id="palette-list" role="listbox" aria-label="Results" className="mt-2 max-h-72 overflow-auto">
        {items.map((item, i) => (
          <li
            key={item.key}
            id={`palette-${i}`}
            role="option"
            aria-selected={i === at}
            aria-disabled={item.disabled || undefined}
            className={`flex h-7 items-center gap-2 rounded px-2 ${i === at ? 'bg-accent/30' : 'hover:bg-raised/60'} ${item.disabled ? 'text-dim' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => pick(item)}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="shrink-0 text-dim">{item.hint}</span>}
          </li>
        ))}
        {!items.length && <li className="px-2 py-2 text-dim">Nothing matches.</li>}
      </ul>
    </Dialog>
  )
}
