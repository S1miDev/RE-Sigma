import { useState } from 'react'
import { Icon, MenuList, Popover } from '../../ui'
import { COMMANDS, isEnabled, type Actions, type Command } from '../commands'
import { useEditor, useStore } from '../store'

const GROUPS: Command['group'][] = ['File', 'Edit', 'View', 'Object', 'Arrange']

/** Main menu: only implemented commands, grouped like Figma, each with its shortcut. */
export function MainMenu({ actions }: { actions: Actions }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState<Command['group']>('File')
  const close = () => setOpen(false)
  return (
    <Popover open={open} onClose={close} trigger={
      <button type="button" aria-label="Main menu" title="Main menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className={`grid h-7 w-8 place-items-center rounded hover:bg-hover ${open ? 'bg-hover' : ''}`}>
        <Icon name="menu" />
      </button>
    }>
      <div className="flex items-start gap-1">
        <div role="menu" aria-label="Main menu" className="min-w-36 rounded-md border border-line bg-canvas py-1 shadow-xl">
          {GROUPS.map((g) => (
            <button key={g} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={group === g} onClick={() => setGroup(g)} onPointerEnter={() => setGroup(g)} onFocus={() => setGroup(g)}
              className={`flex w-full items-center justify-between px-3 py-1 text-left outline-none ${group === g ? 'bg-accent' : ''}`}>
              {g}
              <Icon name="right" />
            </button>
          ))}
        </div>
        <Items key={group} group={group} actions={actions} onClose={close} />
      </div>
    </Popover>
  )
}

function Items({ group, actions, onClose }: { group: Command['group']; actions: Actions; onClose(): void }) {
  const store = useStore()
  useEditor((s) => s) // enabled states follow the editor state while the menu is open
  return (
    <MenuList label={group} onClose={onClose} items={COMMANDS.filter((c) => c.group === group).map((c) => ({
      label: c.label, shortcut: c.keys?.[0], disabled: !isEnabled(c, store), onSelect: () => c.run(store, actions),
    }))} />
  )
}
