import type { Node } from '../../../shared/document'
import { Icon, Menu, type MenuItem } from '../../ui'
import { bindVariable, createCollection, createVariableFrom, unbindVariable } from '../model/variables'
import { useEditor, useStore } from '../store'

/** Variable picker beside one field of the Design panel: bind it to a variable of the right type, make one from its value, or detach. */
export function VariableButton({ field, type, nodes }: { field: string; type: 'COLOR' | 'NUMBER'; nodes: Node[] }) {
  const store = useStore(), collections = useEditor((s) => s.doc.collections)
  const ids = nodes.map((n) => n.id), current = nodes[0].bindings?.[field], bound = nodes.some((n) => n.bindings?.[field])
  const items: MenuItem[] = [
    ...collections.flatMap((c) => c.variables.filter((v) => v.type === type).map((v): MenuItem => ({
      label: `${v.id === current ? '✓ ' : ''}${c.name} / ${v.name}`,
      onSelect: () => store.update((d) => bindVariable(d, ids, field, v.id)),
    }))),
    null,
    {
      label: 'Create variable from value',
      onSelect: () => {
        const count = store.get().doc.collections.flatMap((c) => c.variables).filter((v) => v.type === type).length + 1
        store.update((d) => {
          const withCollection = d.collections.length ? d : createCollection(d, 'Collection 1')
          return createVariableFrom(withCollection, withCollection.collections[0].id, ids[0], field, `${type === 'COLOR' ? 'Color' : 'Number'} ${count}`)
        })
        // the other selected layers follow the new variable too
        const id = store.get().doc.nodes[ids[0]].bindings?.[field]
        if (id && ids.length > 1) store.update((d) => bindVariable(d, ids, field, id))
      },
    },
    { label: 'Detach variable', disabled: !bound, onSelect: () => store.update((d) => unbindVariable(d, ids, field)) },
  ]
  return (
    <Menu label={`Variable for ${field}`} items={items} align="right" className={bound ? 'text-accent' : undefined}>
      <Icon name="variable" />
    </Menu>
  )
}
