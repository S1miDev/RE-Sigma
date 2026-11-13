import { Icon, type IconName } from '../../ui'
import { COMMANDS } from '../commands'
import { useEditor, useStore, type Tool } from '../store'
import { setTool } from '../tools'

const TOOLS: Tool[] = ['move', 'hand', 'frame', 'rectangle', 'ellipse', 'line', 'pen', 'text']

/** The tool strip at the bottom of the canvas. Labels and shortcuts come from the command table. */
export function Toolbar() {
  const store = useStore(), active = useEditor((s) => s.tool)
  return (
    <div role="toolbar" aria-label="Tools" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-xl">
      {TOOLS.map((t) => {
        const cmd = COMMANDS.find((c) => c.id === `tool-${t}`)!
        return (
          <button key={t} type="button" aria-label={cmd.label} aria-pressed={active === t} title={`${cmd.label} (${cmd.keys![0]})`} onClick={() => setTool(store, t)}
            className={`grid h-8 w-8 place-items-center rounded-md ${active === t ? 'bg-accent text-white' : 'text-ink hover:bg-hover'}`}>
            <Icon name={t as IconName} />
          </button>
        )
      })}
    </div>
  )
}
