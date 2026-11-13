import { useState, type DragEvent } from 'react'
import { isContainer, type Node } from '../../../shared/document'
import { Icon, IconButton, type IconName } from '../../ui'
import { zoomToFit } from '../commands'
import { addPage, childrenOf, moveTo, movePage, patch, removePage } from '../model/ops'
import { useEditor, useStore } from '../store'

const TYPE_ICON: Record<Node['type'], IconName> = { PAGE: 'page', FRAME: 'frame', GROUP: 'group', RECTANGLE: 'rectangle', ELLIPSE: 'ellipse', LINE: 'line', TEXT: 'text', VECTOR: 'vector' }

/** Inline rename field: Enter or blur commits a non-empty name, Escape cancels. */
function RenameInput({ label, value, onDone }: { label: string; value: string; onDone(name: string | null): void }) {
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={value}
      maxLength={200}
      className="h-5 min-w-0 flex-1 rounded border border-accent bg-canvas px-1 outline-none"
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') onDone(null)
      }}
    />
  )
}

export function LeftPanel() {
  return (
    <>
      <Pages />
      <Layers />
    </>
  )
}

function Pages() {
  const store = useStore()
  const doc = useEditor((s) => s.doc), current = useEditor((s) => s.pageId)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const go = (id: string) => {
    store.set({ pageId: id, selection: [], editingText: null })
    zoomToFit(store, 1)
  }
  return (
    <section aria-label="Pages" className="shrink-0 border-b border-line py-2">
      <div className="flex h-6 items-center justify-between px-3">
        <h3 className="text-[11px] font-semibold">Pages</h3>
        <IconButton label="Add page" icon="plus" onClick={() => { store.update(addPage); go(store.get().doc.pages.at(-1)!) }} />
      </div>
      <ul className="mt-1 max-h-40 overflow-auto">
        {doc.pages.map((id, index) => (
          <li
            key={id}
            draggable={renaming !== id}
            onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => dragging && e.preventDefault()}
            onDrop={() => { if (dragging && dragging !== id) store.update((d) => movePage(d, dragging, index)); setDragging(null) }}
            onDragEnd={() => setDragging(null)}
            className={`group flex h-7 items-center gap-1 px-3 ${id === current ? 'bg-raised font-semibold' : 'hover:bg-raised/60'}`}
          >
            {renaming === id ? (
              <RenameInput label="Page name" value={doc.nodes[id].name} onDone={(name) => { setRenaming(null); if (name) store.update((d) => patch(d, [id], { name })) }} />
            ) : (
              <button type="button" aria-current={id === current ? 'page' : undefined} className="min-w-0 flex-1 truncate text-left outline-offset-[-1px]" onClick={() => go(id)} onDoubleClick={() => setRenaming(id)}>
                {doc.nodes[id].name}
              </button>
            )}
            {doc.pages.length > 1 && renaming !== id && (
              <IconButton label={`Delete ${doc.nodes[id].name}`} icon="x" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => store.update((d) => removePage(d, id))} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

type Drop = { id: string; zone: 'above' | 'inside' | 'below' }

function Layers() {
  const store = useStore()
  const doc = useEditor((s) => s.doc), pageId = useEditor((s) => s.pageId), selection = useEditor((s) => s.selection)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)

  const zoneOf = (e: DragEvent, n: Node): Drop['zone'] => {
    const r = e.currentTarget.getBoundingClientRect(), f = r.height ? (e.clientY - r.top) / r.height : 0.5
    if (isContainer(n)) return f < 0.25 ? 'above' : f > 0.75 ? 'below' : 'inside'
    return f < 0.5 ? 'above' : 'below'
  }
  // The list shows the top-most layer first, so "above" a row means higher in z-order.
  const onDrop = (e: DragEvent, n: Node) => {
    e.preventDefault()
    const zone = zoneOf(e, n), ids = store.get().selection
    setDrop(null)
    store.update((d) => (zone === 'inside' ? moveTo(d, ids, n.id) : moveTo(d, ids, n.parentId!, zone === 'above' ? { after: n.id } : { before: n.id })))
  }

  const rows = (parentId: string, depth: number): React.ReactNode =>
    childrenOf(doc, parentId).toReversed().map((n) => {
      const selected = selection.includes(n.id), kids = childrenOf(doc, n.id).length > 0, open = !collapsed.has(n.id)
      const mark = drop?.id === n.id ? (drop.zone === 'inside' ? 'outline outline-1 -outline-offset-1 outline-accent' : drop.zone === 'above' ? 'shadow-[inset_0_2px_0_var(--color-accent)]' : 'shadow-[inset_0_-2px_0_var(--color-accent)]') : ''
      return (
        <li key={n.id} role="treeitem" aria-selected={selected} aria-expanded={kids ? open : undefined} aria-label={n.name}>
          <div
            draggable={renaming !== n.id}
            onDragStart={(e) => { if (!selected) store.set({ selection: [n.id] }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.name) }}
            onDragOver={(e) => { e.preventDefault(); const zone = zoneOf(e, n); if (drop?.id !== n.id || drop.zone !== zone) setDrop({ id: n.id, zone }) }}
            onDragLeave={() => setDrop(null)}
            onDrop={(e) => onDrop(e, n)}
            onClick={(e) => store.set({ selection: e.shiftKey || e.ctrlKey || e.metaKey ? (selected ? selection.filter((i) => i !== n.id) : [...selection, n.id]) : [n.id] })}
            onDoubleClick={() => setRenaming(n.id)}
            style={{ paddingLeft: 8 + depth * 14 }}
            className={`group flex h-7 items-center gap-1 pr-2 ${selected ? 'bg-accent/30' : 'hover:bg-raised/60'} ${n.visible ? '' : 'text-dim'} ${mark}`}
          >
            {kids ? (
              <button type="button" aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`} className="grid h-4 w-4 shrink-0 place-items-center text-dim hover:text-ink"
                onClick={(e) => { e.stopPropagation(); const next = new Set(collapsed); if (open) next.add(n.id); else next.delete(n.id); setCollapsed(next) }}>
                <Icon name={open ? 'down' : 'right'} />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            {n.component || n.componentSet || n.instanceOf ? <Icon name={n.instanceOf ? 'instance' : 'component'} className="text-[#9747ff]" /> : <Icon name={TYPE_ICON[n.type]} className="text-dim" />}
            {renaming === n.id ? (
              <RenameInput label="Layer name" value={n.name} onDone={(name) => { setRenaming(null); if (name) store.update((d) => patch(d, [n.id], { name })) }} />
            ) : (
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
            )}
            <span className={`flex ${n.locked || !n.visible ? '' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'}`} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <IconButton label={n.locked ? `Unlock ${n.name}` : `Lock ${n.name}`} icon={n.locked ? 'lock' : 'unlock'} aria-pressed={n.locked} onClick={() => store.update((d) => patch(d, [n.id], { locked: !n.locked }))} />
              <IconButton label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`} icon={n.visible ? 'eye' : 'eyeOff'} aria-pressed={!n.visible} onClick={() => store.update((d) => patch(d, [n.id], { visible: !n.visible }))} />
            </span>
          </div>
          {kids && open && <ul role="group">{rows(n.id, depth + 1)}</ul>}
        </li>
      )
    })

  const empty = childrenOf(doc, pageId).length === 0
  return (
    <section aria-label="Layers" className="flex min-h-0 flex-1 flex-col py-2">
      <h3 className="flex h-6 items-center px-3 text-[11px] font-semibold">Layers</h3>
      {empty ? (
        <p className="px-3 py-2 text-dim">This page is empty. Pick a tool below and draw on the canvas.</p>
      ) : (
        <ul role="tree" aria-label="Layers" className="mt-1 min-h-0 flex-1 overflow-auto">{rows(pageId, 0)}</ul>
      )}
    </section>
  )
}
