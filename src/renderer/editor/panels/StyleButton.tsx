import type { Node } from '../../../shared/document'
import { Icon, Menu, type MenuItem } from '../../ui'
import { applyStyle, createStyle, detachStyle, LINKS, type Link } from '../model/styles'
import { useEditor, useStore } from '../store'

/** Style picker for one section of the Design panel: apply a style of the right kind, make one from the selection, or detach. */
export function StyleButton({ link, nodes }: { link: Link; nodes: Node[] }) {
  const store = useStore(), styles = useEditor((s) => s.doc.styles)
  const ids = nodes.map((n) => n.id), current = nodes[0][link], linked = nodes.some((n) => n[link])
  const kind = LINKS[link].kind, label = link === 'strokeStyle' ? 'Stroke style' : `${kind[0] + kind.slice(1).toLowerCase()} style`
  const items: MenuItem[] = [
    ...styles.filter((s) => s.kind === kind).map((s): MenuItem => ({
      label: (s.id === current ? '✓ ' : '') + s.name,
      onSelect: () => store.update((d) => applyStyle(d, ids, s.id, link)),
    })),
    null,
    {
      label: 'Create style from selection',
      onSelect: () => {
        const n = store.get().doc.styles.filter((s) => s.kind === kind).length + 1
        store.update((d) => createStyle(d, ids[0], link, `${kind[0] + kind.slice(1).toLowerCase()} ${n}`))
        // the other selected layers follow the new style too
        const id = store.get().doc.nodes[ids[0]][link]
        if (id && ids.length > 1) store.update((d) => applyStyle(d, ids, id, link))
      },
    },
    { label: 'Detach style', disabled: !linked, onSelect: () => store.update((d) => detachStyle(d, ids, link)) },
  ]
  return (
    <Menu label={label} items={items} align="right">
      <Icon name="style" />
    </Menu>
  )
}
