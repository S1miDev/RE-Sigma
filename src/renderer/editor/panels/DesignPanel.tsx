import { useRef, useState } from 'react'
import type { ExportKind } from '../../../shared/api'
import { solid, STROKE_ALIGNS, TEXT_ALIGNS, type DropShadow, type Node, type Paint } from '../../../shared/document'
import { Button, ColorField, IconButton, NumberField, PanelSection, Select, type IconName } from '../../ui'
import { exportSelection } from '../export'
import { patch, resizeNode } from '../model/ops'
import { useEditor, useStore } from '../store'

const FONTS = ['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Segoe UI', 'Tahoma', 'Trebuchet MS']
const WEIGHTS: [number, string][] = [[100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi Bold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']]
const TYPE_LABEL: Record<Node['type'], string> = { PAGE: 'Page', FRAME: 'Frame', GROUP: 'Group', RECTANGLE: 'Rectangle', ELLIPSE: 'Ellipse', LINE: 'Line', TEXT: 'Text', VECTOR: 'Vector' }
const Row = ({ children }: { children: React.ReactNode }) => <div className="flex items-center gap-1.5">{children}</div>

export function DesignPanel({ report }: { report(e: unknown): void }) {
  const store = useStore()
  const doc = useEditor((s) => s.doc), selection = useEditor((s) => s.selection), pageId = useEditor((s) => s.pageId)
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const ids = nodes.map((n) => n.id)
  /** Applies a change to every selected node. Edits to the same field within a second share one undo step. */
  const edit = (change: Partial<Node>, tag: string) => store.update((d) => patch(d, ids, change), `panel:${tag}:${ids.join()}`)

  if (!nodes.length) {
    const page = doc.nodes[pageId], bg = page.fills[0]
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <PanelSection title="Page">
          {bg?.type === 'SOLID' && (
            <Row>
              <ColorField label="Page background" color={bg.color} onChange={(color) => store.update((d) => patch(d, [pageId], { fills: [{ ...bg, color: { ...color, a: 1 }, visible: true }] }), 'panel:page-bg')} />
            </Row>
          )}
          <p className="text-dim">Select a layer to edit its properties.</p>
        </PanelSection>
      </div>
    )
  }

  const first = nodes[0]
  const common = <K extends keyof Node>(k: K): Node[K] | null => (nodes.every((n) => n[k] === first[k]) ? first[k] : null)
  const all = (...types: Node['type'][]) => nodes.every((n) => types.includes(n.type))
  const none = (...types: Node['type'][]) => nodes.every((n) => !types.includes(n.type))
  const resize = (size: { width?: number; height?: number }) =>
    store.update((d) => ids.reduce((acc, id) => resizeNode(acc, id, { x: acc.nodes[id].x, y: acc.nodes[id].y, width: acc.nodes[id].width, height: acc.nodes[id].height, ...size }), d), `panel:size:${ids.join()}`)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <PanelSection title={nodes.length === 1 ? TYPE_LABEL[first.type] : `${nodes.length} layers selected`}>
        <Row>
          <NumberField label="X" prefix="X" className="flex-1" value={common('x')} onChange={(x) => edit({ x }, 'x')} />
          <NumberField label="Y" prefix="Y" className="flex-1" value={common('y')} onChange={(y) => edit({ y }, 'y')} />
        </Row>
        <Row>
          <NumberField label="Width" prefix="W" className="flex-1" min={1} value={common('width')} onChange={(width) => resize({ width })} />
          {none('LINE', 'TEXT') ? <NumberField label="Height" prefix="H" className="flex-1" min={1} value={common('height')} onChange={(height) => resize({ height })} /> : <div className="flex-1" />}
        </Row>
        <Row>
          <NumberField label="Rotation" prefix="∠" className="flex-1" min={-180} max={180} value={common('rotation')} onChange={(rotation) => edit({ rotation }, 'rotation')} />
          {all('RECTANGLE', 'FRAME') ? <NumberField label="Corner radius" prefix="◜" className="flex-1" min={0} value={common('cornerRadius')} onChange={(cornerRadius) => edit({ cornerRadius }, 'radius')} /> : <div className="flex-1" />}
        </Row>
        <Row>
          <NumberField label="Opacity" prefix="%" className="flex-1" min={0} max={100} value={common('opacity') === null ? null : Math.round(common('opacity')! * 100)} onChange={(v) => edit({ opacity: v / 100 }, 'opacity')} />
          <div className="flex-1" />
        </Row>
        {all('FRAME') && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={common('clipsContent') === true} onChange={(e) => edit({ clipsContent: e.target.checked }, 'clip')} />
            Clip content
          </label>
        )}
      </PanelSection>

      {all('TEXT') && <TextSection nodes={nodes} edit={edit} common={common} />}
      {none('GROUP', 'LINE') && <Paints title="Fill" field="fills" nodes={nodes} report={report} />}
      {none('GROUP') && (
        <Paints title="Stroke" field="strokes" nodes={nodes} report={report}>
          <Row>
            <NumberField label="Stroke weight" prefix="≡" className="flex-1" min={0} value={common('strokeWeight')} onChange={(strokeWeight) => edit({ strokeWeight }, 'stroke-weight')} />
            {none('LINE', 'TEXT', 'VECTOR') ? (
              <Select aria-label="Stroke align" className="flex-1" value={common('strokeAlign') ?? ''} onChange={(e) => edit({ strokeAlign: e.target.value as Node['strokeAlign'] }, 'stroke-align')}>
                {common('strokeAlign') === null && <option value="" disabled>Mixed</option>}
                {STROKE_ALIGNS.map((a) => <option key={a} value={a}>{a[0] + a.slice(1).toLowerCase()}</option>)}
              </Select>
            ) : <div className="flex-1" />}
          </Row>
        </Paints>
      )}
      {none('GROUP') && <Shadows nodes={nodes} />}
      <PanelSection title="Export">
        <ExportControls onDone={() => {}} onError={report} />
      </PanelSection>
    </div>
  )
}

function TextSection({ nodes, edit, common }: { nodes: Node[]; edit(change: Partial<Node>, tag: string): void; common<K extends keyof Node>(k: K): Node[K] | null }) {
  const family = common('fontFamily'), weight = common('fontWeight'), align = common('textAlign')
  const fonts = family && !FONTS.includes(family) ? [family, ...FONTS] : FONTS // keep an imported file's font selectable
  return (
    <PanelSection title="Text">
      <Select aria-label="Font family" value={family ?? ''} onChange={(e) => edit({ fontFamily: e.target.value }, 'font')}>
        {family === null && <option value="" disabled>Mixed</option>}
        {fonts.map((f) => <option key={f}>{f}</option>)}
      </Select>
      <Row>
        <Select aria-label="Font weight" className="flex-1" value={weight ?? ''} onChange={(e) => edit({ fontWeight: Number(e.target.value) }, 'weight')}>
          {(weight === null || !WEIGHTS.some(([w]) => w === weight)) && <option value={weight ?? ''} disabled>{weight ?? 'Mixed'}</option>}
          {WEIGHTS.map(([w, name]) => <option key={w} value={w}>{name}</option>)}
        </Select>
        <NumberField label="Font size" className="w-16" min={1} max={2000} value={common('fontSize') ?? null} onChange={(fontSize) => edit({ fontSize }, 'size')} />
      </Row>
      <Row>
        <NumberField label="Line height" prefix="↕" className="flex-1" min={0} placeholder="Auto" value={common('lineHeight') || null} onChange={(lineHeight) => edit({ lineHeight }, 'line-height')} />
        <NumberField label="Letter spacing" prefix="↔" className="flex-1" step={0.5} value={common('letterSpacing') ?? null} onChange={(letterSpacing) => edit({ letterSpacing }, 'spacing')} />
      </Row>
      <div role="group" aria-label="Text align" className="flex gap-1">
        {TEXT_ALIGNS.map((a) => (
          <IconButton key={a} label={`Align ${a.toLowerCase()}`} icon={`align${a[0]}${a.slice(1).toLowerCase()}` as IconName} active={align === a} aria-pressed={align === a} onClick={() => edit({ textAlign: a }, 'align')} />
        ))}
      </div>
      {nodes.some((n) => !n.textAutoWidth) && <Button onClick={() => edit({ textAutoWidth: true }, 'auto-width')}>Auto width</Button>}
    </PanelSection>
  )
}

/** Fill or stroke list. With several layers selected it shows the first layer's paints and applies edits to all. */
function Paints({ title, field, nodes, report, children }: { title: string; field: 'fills' | 'strokes'; nodes: Node[]; report(e: unknown): void; children?: React.ReactNode }) {
  const store = useStore(), file = useRef<HTMLInputElement>(null)
  const ids = nodes.map((n) => n.id), paints = nodes[0][field]
  const set = (next: Paint[], tag?: string) =>
    store.update((d) => patch(d, ids, (n) => ({ [field]: next, ...(field === 'strokes' && next.length && !n.strokeWeight && { strokeWeight: 1 }) })), tag && `panel:${field}:${tag}:${ids.join()}`)
  const at = (i: number, p: Paint) => paints.map((old, j) => (j === i ? p : old))
  const addImage = async (f: File | undefined) => {
    if (!f) return
    try {
      const hash = await store.addImage(new Uint8Array(await f.arrayBuffer()))
      set([...paints, { type: 'IMAGE', visible: true, hash }])
    } catch (e) {
      report(e)
    }
  }
  return (
    <PanelSection title={title} action={
      <div className="flex">
        {field === 'fills' && (
          <>
            <IconButton label="Add image fill" icon="image" onClick={() => file.current?.click()} />
            <input ref={file} type="file" hidden aria-label="Image file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }} />
          </>
        )}
        <IconButton label={`Add ${title.toLowerCase()}`} icon="plus" onClick={() => set([...paints, field === 'fills' ? solid(0.85, 0.85, 0.85) : solid(0, 0, 0)])} />
      </div>
    }>
      {paints.length > 0 && (
        <>
          {paints.map((p, i) => (
            <Row key={i}>
              {p.type === 'SOLID' ? <ColorField label={`${title} ${i + 1}`} color={p.color} onChange={(color) => set(at(i, { ...p, color }), `color${i}`)} /> : <span className="flex h-6 flex-1 items-center rounded bg-raised px-1.5 text-dim">Image</span>}
              <IconButton label={p.visible ? `Hide ${title.toLowerCase()} ${i + 1}` : `Show ${title.toLowerCase()} ${i + 1}`} icon={p.visible ? 'eye' : 'eyeOff'} aria-pressed={!p.visible} onClick={() => set(at(i, { ...p, visible: !p.visible }))} />
              <IconButton label={`Remove ${title.toLowerCase()} ${i + 1}`} icon="minus" onClick={() => set(paints.filter((_, j) => j !== i))} />
            </Row>
          ))}
          {children}
        </>
      )}
    </PanelSection>
  )
}

function Shadows({ nodes }: { nodes: Node[] }) {
  const store = useStore()
  const ids = nodes.map((n) => n.id), effects = nodes[0].effects
  const set = (next: DropShadow[], tag?: string) => store.update((d) => patch(d, ids, { effects: next }), tag && `panel:shadow:${tag}:${ids.join()}`)
  const at = (i: number, change: Partial<DropShadow>, tag: string) => set(effects.map((s, j) => (j === i ? { ...s, ...change } : s)), `${tag}${i}`)
  return (
    <PanelSection title="Drop shadow" action={<IconButton label="Add drop shadow" icon="plus" onClick={() => set([...effects, { visible: true, x: 0, y: 4, blur: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }])} />}>
      {effects.length > 0 &&
        effects.map((s, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Row>
              <ColorField label={`Shadow ${i + 1}`} color={s.color} onChange={(color) => at(i, { color }, 'color')} />
              <IconButton label={s.visible ? `Hide shadow ${i + 1}` : `Show shadow ${i + 1}`} icon={s.visible ? 'eye' : 'eyeOff'} aria-pressed={!s.visible} onClick={() => set(effects.map((e, j) => (j === i ? { ...e, visible: !e.visible } : e)))} />
              <IconButton label={`Remove shadow ${i + 1}`} icon="minus" onClick={() => set(effects.filter((_, j) => j !== i))} />
            </Row>
            <Row>
              <NumberField label={`Shadow ${i + 1} X`} prefix="X" className="flex-1" value={s.x} onChange={(x) => at(i, { x }, 'x')} />
              <NumberField label={`Shadow ${i + 1} Y`} prefix="Y" className="flex-1" value={s.y} onChange={(y) => at(i, { y }, 'y')} />
            </Row>
            <Row>
              <NumberField label={`Shadow ${i + 1} blur`} prefix="B" className="flex-1" min={0} value={s.blur} onChange={(blur) => at(i, { blur }, 'blur')} />
              <NumberField label={`Shadow ${i + 1} spread`} prefix="S" className="flex-1" value={s.spread} onChange={(spread) => at(i, { spread }, 'spread')} />
            </Row>
          </div>
        ))}
    </PanelSection>
  )
}

/** Format + scale + button. Exports the current selection; used in the Design panel and the File → Export… dialog. */
export function ExportControls({ onDone, onError }: { onDone(path: string | null): void; onError(e: unknown): void }) {
  const store = useStore()
  const hasSelection = useEditor((s) => s.selection.length > 0)
  const [kind, setKind] = useState<ExportKind>('png')
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      onDone(await exportSelection(store, kind, scale))
    } catch (e) {
      onError(e)
    }
    setBusy(false)
  }
  return (
    <>
      <Row>
        <Select aria-label="Export scale" className="flex-1" value={scale} disabled={kind !== 'png'} onChange={(e) => setScale(Number(e.target.value))}>
          {[1, 2, 3].map((s) => <option key={s} value={s}>{s}x</option>)}
        </Select>
        <Select aria-label="Export format" className="flex-1" value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
          <option value="pdf">PDF</option>
        </Select>
      </Row>
      <Button onClick={run} disabled={busy || !hasSelection}>{busy ? 'Exporting…' : 'Export selection'}</Button>
    </>
  )
}
