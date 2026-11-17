import { ACTIONS, EASINGS, TRANSITIONS, TRIGGERS, type Interaction, type Node } from '../../../shared/document'
import { IconButton, Input, NumberField, PanelSection, Row, Select } from '../../ui'
import { childrenOf } from '../model/ops'
import { useEditor } from '../store'

const LABEL: Record<string, string> = {
  click: 'On click', hover: 'On hover', press: 'On press', key: 'On key', delay: 'After delay',
  navigate: 'Navigate to', back: 'Back', overlay: 'Open overlay', closeOverlay: 'Close overlay', url: 'Open link',
  instant: 'Instant', dissolve: 'Dissolve', slideLeft: 'Slide left', slideRight: 'Slide right', slideUp: 'Slide up', slideDown: 'Slide down',
  linear: 'Linear', easeIn: 'Ease in', easeOut: 'Ease out', easeInOut: 'Ease in and out',
}
const NEW: Interaction = { trigger: 'click', action: 'navigate', transition: 'instant', duration: 300, easing: 'easeOut' }

/** Prototype interactions of one layer: what runs when the trigger fires in the preview (Ctrl+Alt+Enter). */
export function PrototypeSection({ node, edit }: { node: Node; edit(change: Partial<Node>, tag: string): void }) {
  const pageId = useEditor((s) => s.pageId), doc = useEditor((s) => s.doc)
  const frames = childrenOf(doc, pageId).filter((n) => n.type === 'FRAME' && !n.section)
  const list = node.interactions ?? []
  const set = (next: Interaction[]) => edit({ interactions: next.length ? next : undefined }, 'interactions')
  const change = (i: number, c: Partial<Interaction>) => set(list.map((it, j) => (j === i ? { ...it, ...c } : it)))
  const opts = (values: readonly string[]) => values.map((v) => <option key={v} value={v}>{LABEL[v]}</option>)
  return (
    <PanelSection title="Prototype" action={<IconButton label="Add interaction" icon="plus" disabled={list.length >= 20} onClick={() => set([...list, { ...NEW, target: frames.find((f) => f.id !== node.id)?.id }])} />}>
      {node.type === 'FRAME' && node.parentId === pageId && !node.section && (
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!node.flowStart} onChange={(e) => edit({ flowStart: e.target.checked || undefined }, 'flow-start')} /> Flow starting point</label>
      )}
      {list.map((it, i) => (
        <div key={i} className="flex flex-col gap-1.5 border-b border-line pb-2" role="group" aria-label={`Interaction ${i + 1}`}>
          <Row>
            <Select aria-label="Trigger" className="flex-1" value={it.trigger} onChange={(e) => change(i, { trigger: e.target.value as Interaction['trigger'] })}>{opts(TRIGGERS)}</Select>
            {it.trigger === 'key' && <Input aria-label="Key" className="w-16" maxLength={32} placeholder="Key" value={it.key ?? ''} onChange={(e) => change(i, { key: e.target.value || undefined })} />}
            {it.trigger === 'delay' && <NumberField label="Delay (ms)" prefix="ms" className="w-20" min={0} max={3_600_000} value={it.delay ?? 0} onChange={(delay) => change(i, { delay })} />}
            <IconButton label="Remove interaction" icon="minus" onClick={() => set(list.filter((_, j) => j !== i))} />
          </Row>
          <Row>
            <Select aria-label="Action" className="flex-1" value={it.action} onChange={(e) => change(i, { action: e.target.value as Interaction['action'] })}>{opts(ACTIONS)}</Select>
            {(it.action === 'navigate' || it.action === 'overlay') && (
              <Select aria-label="Target frame" className="flex-1" value={it.target ?? ''} onChange={(e) => change(i, { target: e.target.value || undefined })}>
                <option value="">None</option>
                {frames.filter((f) => f.id !== node.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            )}
          </Row>
          {it.action === 'url' && <Input aria-label="Link" placeholder="https://" maxLength={2048} value={it.url ?? ''} onChange={(e) => change(i, { url: /^https?:\/\//.test(e.target.value) ? e.target.value : undefined })} />}
          {it.action === 'navigate' && (
            <Row>
              <Select aria-label="Transition" className="flex-1" value={it.transition} onChange={(e) => change(i, { transition: e.target.value as Interaction['transition'] })}>{opts(TRANSITIONS)}</Select>
              <NumberField label="Duration (ms)" prefix="ms" className="w-20" min={0} max={10_000} value={it.duration} onChange={(duration) => change(i, { duration })} />
              <Select aria-label="Easing" className="flex-1" value={it.easing} onChange={(e) => change(i, { easing: e.target.value as Interaction['easing'] })}>{opts(EASINGS)}</Select>
            </Row>
          )}
        </div>
      ))}
    </PanelSection>
  )
}
