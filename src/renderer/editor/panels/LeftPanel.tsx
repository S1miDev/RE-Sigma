import { useState, type DragEvent } from 'react'
import { isContainer, type Document, type Node } from '../../../shared/document'
import { ColorField, Icon, IconButton, Input, NumberField, type IconName } from '../../ui'
import { isMask } from '../canvas/paintPlan'
import { zoomToFit } from '../canvas/viewport'
import { addPage, childrenOf, moveTo, movePage, patch, removePage } from '../model/ops'
import { deleteStyle, LINKS, renameStyle, updateStyleFrom, type Link } from '../model/styles'
import { addMode, createCollection, createVariable, deleteCollection, deleteMode, deleteVariable, renameCollection, renameMode, renameVariable, setVariableValue } from '../model/variables'
import { useEditor, useStore } from '../store'
import { showPage } from '../tools'
import { useContextMenu } from './ContextMenu'

const TYPE_ICON: Record<Node['type'], IconName> = { PAGE: 'page', FRAME: 'frame', GROUP: 'group', RECTANGLE: 'rectangle', ELLIPSE: 'ellipse', LINE: 'line', TEXT: 'text', VECTOR: 'vector', BOOLEAN: 'boolean', STAR: 'star', POLYGON: 'polygon' }

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
      <Styles />
      <Variables />
      <Comments />
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
    showPage(store, id)
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

/** The document's styles, to rename, update from the selected layer, or delete. Hidden while there are none (styles are made from the Design panel). */
function Styles() {
  const store = useStore()
  const doc = useEditor((s) => s.doc), selection = useEditor((s) => s.selection)
  const [renaming, setRenaming] = useState<string | null>(null)
  if (!doc.styles.length) return null
  const from = selection.length === 1 ? doc.nodes[selection[0]] : undefined
  const linkOf = (kind: string) => (Object.keys(LINKS) as Link[]).find((l) => LINKS[l].kind === kind)!
  return (
    <section aria-label="Styles" className="shrink-0 border-b border-line py-2">
      <div className="flex h-6 items-center px-3"><h3 className="text-[11px] font-semibold">Styles</h3></div>
      <ul className="mt-1 max-h-40 overflow-auto">
        {doc.styles.map((s) => (
          <li key={s.id} className="group flex h-7 items-center gap-1 px-3 hover:bg-raised/60">
            {renaming === s.id ? (
              <RenameInput label="Style name" value={s.name} onDone={(name) => { setRenaming(null); if (name) store.update((d) => renameStyle(d, s.id, name)) }} />
            ) : (
              <button type="button" className="min-w-0 flex-1 truncate text-left" title={`${s.kind.toLowerCase()} style`} onDoubleClick={() => setRenaming(s.id)}>{s.name}</button>
            )}
            {from && renaming !== s.id && (
              <IconButton label={`Update ${s.name} from selection`} icon="style" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => store.update((d) => updateStyleFrom(d, s.id, from.id, linkOf(s.kind)))} />
            )}
            {renaming !== s.id && <IconButton label={`Delete ${s.name}`} icon="x" className="opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => store.update((d) => deleteStyle(d, s.id))} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Collections of variables: modes as columns, one row per variable. Double click a name to rename it. */
function Variables() {
  const store = useStore(), collections = useEditor((s) => s.doc.collections)
  const [renaming, setRenaming] = useState<string | null>(null)
  const name = (key: string, label: string, value: string, rename: (name: string) => (d: Document) => Document, className = '') =>
    renaming === key ? (
      <RenameInput label={label} value={value} onDone={(n) => { setRenaming(null); if (n) store.update(rename(n)) }} />
    ) : (
      <button type="button" className={`min-w-0 flex-1 truncate text-left ${className}`} title={label} onDoubleClick={() => setRenaming(key)}>{value}</button>
    )
  return (
    <section aria-label="Variables" className="shrink-0 border-b border-line py-2">
      <div className="flex h-6 items-center justify-between px-3">
        <h3 className="text-[11px] font-semibold">Variables</h3>
        <IconButton label="Add collection" icon="plus" onClick={() => store.update((d) => createCollection(d, `Collection ${d.collections.length + 1}`))} />
      </div>
      <div className="max-h-64 overflow-auto">
        {collections.map((c) => (
          <div key={c.id} role="group" aria-label={c.name} className="mt-1 border-t border-line/50 pt-1">
            <div className="group flex h-7 items-center gap-1 px-3 font-semibold">
              {name(`c:${c.id}`, 'Collection name', c.name, (n) => (d) => renameCollection(d, c.id, n))}
              <IconButton label={`Add mode to ${c.name}`} icon="plus" onClick={() => store.update((d) => addMode(d, c.id, `Mode ${c.modes.length + 1}`))} />
              <IconButton label={`Add color variable to ${c.name}`} icon="variable" onClick={() => store.update((d) => createVariable(d, c.id, 'COLOR', `Color ${c.variables.length + 1}`))} />
              <IconButton label={`Add number variable to ${c.name}`} icon="style" onClick={() => store.update((d) => createVariable(d, c.id, 'NUMBER', `Number ${c.variables.length + 1}`))} />
              <IconButton label={`Delete ${c.name}`} icon="x" onClick={() => store.update((d) => deleteCollection(d, c.id))} />
            </div>
            <div className="flex items-center gap-1 px-3 text-dim">
              <span className="min-w-0 flex-1" />
              {c.modes.map((m) => (
                <span key={m.id} className="flex w-24 items-center gap-0.5">
                  {name(`m:${m.id}`, 'Mode name', m.name, (n) => (d) => renameMode(d, c.id, m.id, n))}
                  {c.modes.length > 1 && <IconButton label={`Delete mode ${m.name}`} icon="x" onClick={() => store.update((d) => deleteMode(d, c.id, m.id))} />}
                </span>
              ))}
            </div>
            {c.variables.map((v) => (
              <div key={v.id} className="flex items-center gap-1 px-3 py-0.5">
                {name(`v:${v.id}`, 'Variable name', v.name, (n) => (d) => renameVariable(d, v.id, n))}
                {c.modes.map((m) => (
                  <span key={m.id} className="flex w-24 items-center">
                    {v.type === 'COLOR'
                      ? <ColorField label={`${v.name} in ${m.name}`} color={v.values[m.id]} onChange={(color) => store.update((d) => setVariableValue(d, v.id, m.id, color), { key: `variable:${v.id}:${m.id}` })} />
                      : <NumberField label={`${v.name} in ${m.name}`} className="w-full" value={v.values[m.id]} onChange={(n) => store.update((d) => setVariableValue(d, v.id, m.id, n), { key: `variable:${v.id}:${m.id}` })} />}
                  </span>
                ))}
                <IconButton label={`Delete ${v.name}`} icon="x" onClick={() => store.update((d) => deleteVariable(d, v.id))} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

type Drop = { id: string; zone: 'above' | 'inside' | 'below' }

/** The page's comment threads; click one to open its pin. */
function Comments() {
  const store = useStore(), all = useEditor((s) => s.doc.comments), pageId = useEditor((s) => s.pageId), showResolved = useEditor((s) => s.showResolved), open = useEditor((s) => s.openComment)
  const list = all.filter((c) => c.page === pageId && (showResolved || !c.resolved))
  return (
    <section aria-label="Comments" className="shrink-0 border-b border-line py-2">
      <div className="flex h-6 items-center justify-between px-3">
        <h3 className="text-[11px] font-semibold">Comments</h3>
        <label className="flex items-center gap-1 text-dim"><input type="checkbox" checked={showResolved} onChange={() => store.set({ showResolved: !showResolved })} /> Resolved</label>
      </div>
      <ul className="max-h-40 overflow-auto">
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" aria-pressed={open === c.id} onClick={() => store.set({ openComment: c.id, draft: null })} className={`block w-full truncate px-3 py-1 text-left hover:bg-hover ${c.resolved ? 'text-dim line-through' : ''}`}>{c.text}</button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Layers() {
  const store = useStore()
  const doc = useEditor((s) => s.doc), pageId = useEditor((s) => s.pageId), selection = useEditor((s) => s.selection)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const [filter, setFilter] = useState('')
  const openMenu = useContextMenu()
  const q = filter.trim().toLowerCase()
  // While filtering, a row stays if it or anything under it matches, and everything is expanded so matches show.
  const keeps = (n: Node): boolean => n.name.toLowerCase().includes(q) || childrenOf(doc, n.id).some(keeps)

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
    childrenOf(doc, parentId).toReversed().filter((n) => !q || keeps(n)).map((n) => {
      const selected = selection.includes(n.id), kids = childrenOf(doc, n.id).length > 0, open = q ? true : !collapsed.has(n.id)
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
            onContextMenu={(e) => {
              if (renaming === n.id) return // keep the text field's own menu
              e.preventDefault()
              if (!selected) store.set({ selection: [n.id] })
              openMenu({ x: e.clientX, y: e.clientY })
            }}
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
            {n.component || n.componentSet || n.instanceOf ? <Icon name={n.instanceOf ? 'instance' : 'component'} className="text-[#9747ff]" /> : <Icon name={isMask(n) ? 'mask' : TYPE_ICON[n.type]} className="text-dim" />}
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
  const none = !empty && q !== '' && !childrenOf(doc, pageId).some(keeps)
  return (
    <section aria-label="Layers" className="flex min-h-0 flex-1 flex-col py-2">
      <h3 className="flex h-6 items-center px-3 text-[11px] font-semibold">Layers</h3>
      {!empty && <div className="px-3 pt-1"><Input aria-label="Filter layers" className="w-full" placeholder="Filter layers" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}
      {empty ? (
        <p className="px-3 py-2 text-dim">This page is empty. Pick a tool below and draw on the canvas.</p>
      ) : none ? (
        <p className="px-3 py-2 text-dim">No layers match.</p>
      ) : (
        <ul role="tree" aria-label="Layers" className="mt-1 min-h-0 flex-1 overflow-auto">{rows(pageId, 0)}</ul>
      )}
    </section>
  )
}
