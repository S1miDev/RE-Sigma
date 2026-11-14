import { useRef } from 'react'
import {
  BLEND_MODES, BOOL_OPS, colorAt, CONSTRAINTS, convertPaint, gradientAngle, IMAGE_MODES, LAYOUT_ALIGNS, rotateGradient, solid, STROKE_ALIGNS, STROKE_CAPS, STROKE_ENDS, STROKE_JOINS, TEXT_ALIGNS, TEXT_CASES, TEXT_DECORATIONS, TEXT_LISTS, TEXT_VALIGNS, typeLabel,
  type AutoLayout, type BlendMode, type BoolOp, type Constraint, type Document, type DropShadow, type Effect, type GradientStop, type ImagePaint, type Node, type Paint, type PaintKind, type RunStyle,
} from '../../../shared/document'
import { Button, ColorField, IconButton, Input, NumberField, PanelSection, Row, Select, type IconName } from '../../ui'
import { canMask } from '../canvas/paintPlan'
import { runCommand } from '../commands'
import { setOf, setVariant, variantProps, variantsOf } from '../model/components'
import { useSystemFonts } from '../fonts'
import { applyRunStyle, styleValue } from '../tools/textEdit'
import { addAutoLayout, patch, resizeNode } from '../model/ops'
import { useEditor, useStore, type Step } from '../store'
import { ExportControls } from './ExportControls'
import { StyleButton } from './StyleButton'

const FONTS = ['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Segoe UI', 'Tahoma', 'Trebuchet MS']
const WEIGHTS: [number, string][] = [[100, 'Thin'], [200, 'Extra Light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semi Bold'], [700, 'Bold'], [800, 'Extra Bold'], [900, 'Black']]
/** Panel edits of the same field on the same layers within a second share one undo step. */
const panelStep = (field: string, ids: string[]): Step => ({ key: `panel:${field}:${ids.join()}` })

export function DesignPanel({ report }: { report(e: unknown): void }) {
  const store = useStore()
  const doc = useEditor((s) => s.doc), selection = useEditor((s) => s.selection), pageId = useEditor((s) => s.pageId)
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean)
  const ids = nodes.map((n) => n.id)
  /** Applies a change to every selected node. Edits to the same field within a second share one undo step. */
  const edit = (change: Partial<Node>, tag: string) => store.update((d) => patch(d, ids, change), panelStep(tag, ids))

  if (!nodes.length) {
    const page = doc.nodes[pageId], bg = page.fills[0]
    return (
      <div data-keep-text className="min-h-0 flex-1 overflow-auto">
        <PanelSection title="Page">
          {bg?.type === 'SOLID' && (
            <Row>
              <ColorField label="Page background" color={bg.color} onChange={(color) => store.update((d) => patch(d, [pageId], { fills: [{ ...bg, color: { ...color, a: 1 }, visible: true }] }), panelStep('page-bg', [pageId]))} />
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
    store.update((d) => ids.reduce((acc, id) => resizeNode(acc, id, { x: acc.nodes[id].x, y: acc.nodes[id].y, width: acc.nodes[id].width, height: acc.nodes[id].height, ...size }), d), panelStep('size', ids))

  return (
    <div data-keep-text className="min-h-0 flex-1 overflow-auto">
      <PanelSection title={nodes.length === 1 ? typeLabel(first.type) : `${nodes.length} layers selected`}>
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
          {all('RECTANGLE', 'FRAME') ? <NumberField label="Corner radius" prefix="◜" className="flex-1" min={0} value={nodes.some((n) => n.cornerRadii) ? null : common('cornerRadius')} onChange={(cornerRadius) => edit({ cornerRadius, cornerRadii: undefined }, 'radius')} /> : <div className="flex-1" />}
        </Row>
        <Row>
          <NumberField label="Opacity" prefix="%" className="flex-1" min={0} max={100} value={common('opacity') === null ? null : Math.round(common('opacity')! * 100)} onChange={(v) => edit({ opacity: v / 100 }, 'opacity')} />
          <Select aria-label="Blend mode" className="flex-1" value={nodes.every((n) => (n.blendMode ?? 'NORMAL') === (nodes[0].blendMode ?? 'NORMAL')) ? (nodes[0].blendMode ?? 'NORMAL') : ''} onChange={(e) => edit({ blendMode: e.target.value as BlendMode }, 'blend')}>
            <option value="" disabled>Mixed</option>
            {BLEND_MODES.map((m) => <option key={m} value={m}>{typeLabel(m as never).replace(/_/g, ' ')}</option>)}
          </Select>
        </Row>
        {all('RECTANGLE', 'FRAME') && <CornerSection nodes={nodes} edit={edit} />}
        {all('ELLIPSE') && <ArcSection nodes={nodes} edit={edit} />}
        {all('STAR', 'POLYGON') && (
          <Row>
            <NumberField label="Points" prefix="★" className="flex-1" min={3} max={60} value={common('points') ?? null} onChange={(points) => edit({ points: Math.round(points) }, 'points')} />
            {all('STAR') ? <NumberField label="Inner radius" prefix="%" className="flex-1" min={1} max={99} value={nodes.every((n) => n.innerRatio === first.innerRatio) ? Math.round((first.innerRatio ?? 0.38) * 100) : null} onChange={(v) => edit({ innerRatio: v / 100 }, 'inner-ratio')} /> : <div className="flex-1" />}
          </Row>
        )}
        {all('FRAME') && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={common('clipsContent') === true} onChange={(e) => edit({ clipsContent: e.target.checked }, 'clip')} />
            Clip content
          </label>
        )}
        {nodes.every((n) => doc.nodes[n.parentId ?? '']?.layout) && (
          <Row>
            <Check label="Fill width" checked={common('fillW') === true} onChange={(fillW) => edit({ fillW }, 'fill-w')} />
            <Check label="Fill height" checked={common('fillH') === true} onChange={(fillH) => edit({ fillH }, 'fill-h')} />
          </Row>
        )}
      </PanelSection>

      {nodes.every((n) => { const p = doc.nodes[n.parentId ?? '']; return p?.type === 'FRAME' && !p.layout }) && (
        <PanelSection title="Constraints">
          <Row>
            {(['h', 'v'] as const).map((axis) => {
              const values = new Set(nodes.map((n) => n.constraints?.[axis] ?? 'MIN')), value = values.size === 1 ? [...values][0] : ''
              const names = axis === 'h' ? { MIN: 'Left', MAX: 'Right', STRETCH: 'Left & right', CENTER: 'Center', SCALE: 'Scale' } : { MIN: 'Top', MAX: 'Bottom', STRETCH: 'Top & bottom', CENTER: 'Center', SCALE: 'Scale' }
              return (
                <Select key={axis} aria-label={axis === 'h' ? 'Horizontal constraint' : 'Vertical constraint'} className="flex-1" value={value}
                  onChange={(e) => store.update((d) => patch(d, ids, (n) => ({ constraints: { h: 'MIN', v: 'MIN', ...n.constraints, [axis]: e.target.value as Constraint } })), panelStep(`constraint-${axis}`, ids))}>
                  {!value && <option value="" disabled>Mixed</option>}
                  {CONSTRAINTS.map((c) => <option key={c} value={c}>{names[c]}</option>)}
                </Select>
              )
            })}
          </Row>
        </PanelSection>
      )}

      {nodes.length === 1 && (first.component || first.componentSet || first.instanceOf) && <ComponentSection node={first} />}
      {nodes.length === 1 && first.type === 'FRAME' && <AutoLayoutSection node={first} edit={edit} />}
      {nodes.length === 1 && canMask(first) && (
        <PanelSection title="Mask">
          <Row>
            <Button className="flex-1" aria-pressed={!!first.mask} onClick={() => runCommand(store, 'use-as-mask')}>{first.mask ? 'Remove mask' : 'Use as mask'}</Button>
          </Row>
        </PanelSection>
      )}
      {nodes.length === 1 && first.type === 'BOOLEAN' && (
        <PanelSection title="Boolean">
          <Row>
            <Select aria-label="Boolean operation" className="flex-1" value={first.boolOp ?? 'UNION'} onChange={(e) => edit({ boolOp: e.target.value as BoolOp }, 'bool-op')}>
              {BOOL_OPS.map((o) => <option key={o} value={o}>{o[0] + o.slice(1).toLowerCase()}</option>)}
            </Select>
          </Row>
        </PanelSection>
      )}

      {all('TEXT') && <TextSection nodes={nodes} edit={edit} common={common} />}
      {none('GROUP', 'LINE') && <Paints title="Fill" field="fills" nodes={nodes} report={report} />}
      {none('GROUP') && (
        <Paints title="Stroke" field="strokes" nodes={nodes} report={report}>
          <Row>
            <NumberField label="Stroke weight" prefix="≡" className="flex-1" min={0} value={common('strokeWeight')} onChange={(strokeWeight) => edit({ strokeWeight }, 'stroke-weight')} />
            {none('LINE', 'TEXT', 'VECTOR', 'BOOLEAN', 'STAR', 'POLYGON') ? (
              <Select aria-label="Stroke align" className="flex-1" value={common('strokeAlign') ?? ''} onChange={(e) => edit({ strokeAlign: e.target.value as Node['strokeAlign'] }, 'stroke-align')}>
                {common('strokeAlign') === null && <option value="" disabled>Mixed</option>}
                {STROKE_ALIGNS.map((a) => <option key={a} value={a}>{a[0] + a.slice(1).toLowerCase()}</option>)}
              </Select>
            ) : <div className="flex-1" />}
          </Row>
          <StrokeStyle nodes={nodes} edit={edit} />
        </Paints>
      )}
      <Shadows nodes={nodes} />
      <PanelSection title="Export">
        <ExportControls onDone={() => {}} onError={report} />
      </PanelSection>
    </div>
  )
}

/** Each variant property of a set with its values, in variant order. */
function propertyValues(doc: Document, setId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const v of variantsOf(doc, setId)) for (const [k, val] of Object.entries(variantProps(v.name))) if (!(out[k] ??= []).includes(val)) out[k].push(val)
  return out
}

type Edit = (change: Partial<Node>, tag: string) => void

const END_NAMES = { NONE: 'None', ARROW: 'Arrow', TRIANGLE: 'Triangle', CIRCLE: 'Circle', DIAMOND: 'Diamond' }

/** Dash pattern, cap, join, end markers (lines and vectors) and per-side weights (rectangles and frames). */
function StrokeStyle({ nodes, edit }: { nodes: Node[]; edit: Edit }) {
  const first = nodes[0]
  const same = <K extends keyof Node>(k: K, dflt: Node[K]) => (nodes.every((n) => (n[k] ?? dflt) === (first[k] ?? dflt)) ? (first[k] ?? dflt) : '')
  const all = (...types: Node['type'][]) => nodes.every((n) => types.includes(n.type))
  const dash = nodes.every((n) => (n.strokeDash ?? []).join() === (first.strokeDash ?? []).join()) ? (first.strokeDash ?? []).join(' ') : ''
  const sel = <K extends 'strokeCap' | 'strokeJoin' | 'strokeStart' | 'strokeEnd'>(key: K, label: string, options: readonly string[], dflt: string, names?: Record<string, string>) => (
    <Select aria-label={label} className="flex-1" value={String(same(key, dflt as Node[K]))} onChange={(e) => edit({ [key]: e.target.value } as Partial<Node>, key)}>
      {same(key, dflt as Node[K]) === '' && <option value="" disabled>Mixed</option>}
      {options.map((o) => <option key={o} value={o}>{names?.[o] ?? o[0] + o.slice(1).toLowerCase()}</option>)}
    </Select>
  )
  const sides = all('RECTANGLE', 'FRAME') && nodes.every((n) => n.strokeSides)
  const setSides = (s: NonNullable<Node['strokeSides']> | undefined) => edit(s ? { strokeSides: s, strokeWeight: Math.max(...s) } : { strokeSides: undefined }, 'stroke-sides')
  return (
    <>
      <Row>
        <Input aria-label="Stroke dash" className="flex-1" placeholder="Dash, gap" key={dash} defaultValue={dash}
          onBlur={(e) => {
            const v = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number).slice(0, 8)
            if (v.every((x) => Number.isFinite(x) && x >= 0)) edit({ strokeDash: v.length ? v : undefined }, 'stroke-dash')
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      </Row>
      <Row>
        {sel('strokeCap', 'Stroke cap', STROKE_CAPS, 'NONE')}
        {sel('strokeJoin', 'Stroke join', STROKE_JOINS, 'MITER')}
      </Row>
      {all('LINE', 'VECTOR') && (
        <Row>
          {sel('strokeStart', 'Start marker', STROKE_ENDS, 'NONE', END_NAMES)}
          {sel('strokeEnd', 'End marker', STROKE_ENDS, 'NONE', END_NAMES)}
        </Row>
      )}
      {all('RECTANGLE', 'FRAME') && (
        <>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!sides} onChange={(e) => setSides(e.target.checked ? [first.strokeWeight, first.strokeWeight, first.strokeWeight, first.strokeWeight] : undefined)} />
            Independent sides
          </label>
          {sides && (
            <Row>
              {['Top', 'Right', 'Bottom', 'Left'].map((name, i) => (
                <NumberField key={name} label={`Stroke ${name.toLowerCase()}`} prefix={name[0]} className="flex-1" min={0} value={nodes.every((n) => n.strokeSides![i] === first.strokeSides![i]) ? first.strokeSides![i] : null}
                  onChange={(v) => setSides(first.strokeSides!.map((x, j) => (j === i ? v : x)) as NonNullable<Node['strokeSides']>)} />
              ))}
            </Row>
          )}
        </>
      )}
    </>
  )
}
const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left']

/** Corner smoothing, and independent radii for one selected rectangle or frame. */
function CornerSection({ nodes, edit }: { nodes: Node[]; edit: Edit }) {
  const first = nodes[0], radii = nodes.length === 1 ? first.cornerRadii : undefined
  const smooth = nodes.every((n) => (n.cornerSmoothing ?? 0) === (first.cornerSmoothing ?? 0)) ? Math.round((first.cornerSmoothing ?? 0) * 100) : null
  return (
    <>
      <Row>
        <NumberField label="Corner smoothing" prefix="⌒" className="flex-1" min={0} max={100} value={smooth} onChange={(v) => edit({ cornerSmoothing: v ? v / 100 : undefined }, 'smoothing')} />
        {nodes.length === 1 ? (
          <label className="flex flex-1 items-center gap-2">
            <input type="checkbox" checked={!!radii} onChange={(e) => edit(e.target.checked ? { cornerRadii: [first.cornerRadius, first.cornerRadius, first.cornerRadius, first.cornerRadius] } : { cornerRadius: radii?.[0] ?? first.cornerRadius, cornerRadii: undefined }, 'corners')} />
            Independent
          </label>
        ) : <div className="flex-1" />}
      </Row>
      {radii && (
        <Row>
          {CORNERS.map((name, i) => (
            <NumberField key={name} label={`Corner radius ${name}`} prefix={'↖↗↘↙'[i]} className="min-w-0 flex-1" min={0} value={radii[i]}
              onChange={(v) => edit({ cornerRadii: radii.map((r, j) => (j === i ? v : r)) as NonNullable<Node['cornerRadii']> }, 'radii')} />
          ))}
        </Row>
      )}
    </>
  )
}

/** An ellipse's arc: where it starts, how far it sweeps and how large the hole is. A full ellipse has no arc. */
function ArcSection({ nodes, edit }: { nodes: Node[]; edit: Edit }) {
  const first = nodes[0], arc = first.arc ?? { start: 0, sweep: 360, inner: 0 }
  const same = nodes.every((n) => JSON.stringify(n.arc) === JSON.stringify(first.arc))
  const set = (change: Partial<typeof arc>) => {
    const next = { ...arc, ...change }
    edit({ arc: next.start === 0 && next.sweep === 360 && next.inner === 0 ? undefined : next }, 'arc')
  }
  return (
    <Row>
      <NumberField label="Arc start" prefix="⌓" className="min-w-0 flex-1" min={-360} max={360} value={same ? arc.start : null} onChange={(start) => set({ start })} />
      <NumberField label="Arc sweep" prefix="∠" className="min-w-0 flex-1" min={-360} max={360} value={same ? arc.sweep : null} onChange={(sweep) => set({ sweep })} />
      <NumberField label="Arc ratio" prefix="◌" className="min-w-0 flex-1" min={0} max={99} value={same ? Math.round(arc.inner * 100) : null} onChange={(v) => set({ inner: v / 100 })} />
    </Row>
  )
}

/** Main component: make instances. Instance: where it comes from, and the way back out. */
function ComponentSection({ node }: { node: Node }) {
  const store = useStore(), doc = useEditor((s) => s.doc)
  const run = (id: string) => runCommand(store, id)
  if (node.componentSet) {
    const props = propertyValues(doc, node.id)
    return (
      <PanelSection title="Variants">
        {Object.entries(props).map(([prop, values]) => <p key={prop}><span className="text-dim">{prop}:</span> {values.join(', ')}</p>)}
        <Row>
          <Button className="flex-1" onClick={() => run('add-variant')}>Add variant</Button>
          <Button className="flex-1" onClick={() => run('create-instance')}>Create instance</Button>
        </Row>
      </PanelSection>
    )
  }
  if (node.component) return (
    <PanelSection title="Component">
      <Row>
        {setOf(doc, node.id) ? <Button className="flex-1" onClick={() => run('add-variant')}>Add variant</Button> : <Button className="flex-1" onClick={() => run('combine-variants')}>Combine as variants</Button>}
        <Button className="flex-1" onClick={() => run('create-instance')}>Create instance</Button>
      </Row>
    </PanelSection>
  )
  const main = doc.nodes[node.instanceOf!], set = main && setOf(doc, main.id)
  const current = main ? variantProps(main.name) : {}
  return (
    <PanelSection title="Instance">
      <p className="text-dim">{main ? `Instance of ${set ? `${set.name} / ` : ''}${main.name}` : 'Main component was deleted'}</p>
      {set && Object.entries(propertyValues(doc, set.id)).map(([prop, values]) => (
        <Row key={prop}>
          <span className="w-20 shrink-0 truncate text-dim">{prop}</span>
          <Select aria-label={`Variant ${prop}`} className="flex-1" value={current[prop] ?? ''} onChange={(e) => store.update((d) => setVariant(d, node.id, prop, e.target.value))}>
            {current[prop] === undefined && <option value="" disabled>—</option>}
            {values.map((v) => <option key={v}>{v}</option>)}
          </Select>
        </Row>
      ))}
      <Row>
        {main && <Button className="flex-1" onClick={() => run('go-to-main')}>Go to main</Button>}
        <Button className="flex-1" onClick={() => run('reset-instance')}>Reset</Button>
        <Button className="flex-1" onClick={() => run('detach-instance')}>Detach</Button>
      </Row>
    </PanelSection>
  )
}

const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) => (
  <label className="flex flex-1 items-center gap-2">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
)

function AutoLayoutSection({ node, edit }: { node: Node; edit(change: Partial<Node>, tag: string): void }) {
  const store = useStore(), L = node.layout
  const set = (change: Partial<AutoLayout>, tag: string) => L && edit({ layout: { ...L, ...change } }, `layout-${tag}`)
  const pad = (i: number, v: number) => set({ padding: L!.padding.map((p, j) => (j === i ? v : p)) as AutoLayout['padding'] }, `pad${i}`)
  return (
    <PanelSection title="Auto layout" action={
      L ? <IconButton label="Remove auto layout" icon="minus" onClick={() => edit({ layout: undefined }, 'layout')} />
        : <IconButton label="Add auto layout" icon="plus" onClick={() => store.update((d) => addAutoLayout(d, node.id))} />
    }>
      {L && (
        <>
          <Row>
            <Select aria-label="Direction" className="flex-1" value={L.mode} onChange={(e) => set({ mode: e.target.value as AutoLayout['mode'] }, 'mode')}>
              <option value="HORIZONTAL">Horizontal</option>
              <option value="VERTICAL">Vertical</option>
            </Select>
            <NumberField label="Gap" prefix="↔" className="flex-1" min={0} value={L.gap} onChange={(gap) => set({ gap }, 'gap')} />
          </Row>
          <Row>
            {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side, i) => (
              <NumberField key={side} label={`Padding ${side.toLowerCase()}`} prefix={side[0]} className="flex-1" min={0} value={L.padding[i]} onChange={(v) => pad(i, v)} />
            ))}
          </Row>
          <Row>
            <Select aria-label="Align" className="flex-1" value={L.align} onChange={(e) => set({ align: e.target.value as AutoLayout['align'] }, 'align')}>
              {LAYOUT_ALIGNS.map((a) => <option key={a} value={a}>{L.mode === 'HORIZONTAL' ? { MIN: 'Top', CENTER: 'Center', MAX: 'Bottom' }[a] : { MIN: 'Left', CENTER: 'Center', MAX: 'Right' }[a]}</option>)}
            </Select>
          </Row>
          <Row>
            <Check label="Hug width" checked={L.hugW} onChange={(hugW) => set({ hugW }, 'hug-w')} />
            <Check label="Hug height" checked={L.hugH} onChange={(hugH) => set({ hugH }, 'hug-h')} />
          </Row>
        </>
      )}
    </PanelSection>
  )
}

function TextSection({ nodes, edit, common }: { nodes: Node[]; edit(change: Partial<Node>, tag: string): void; common<K extends keyof Node>(k: K): Node[K] | null }) {
  const store = useStore(), mode = useEditor((s) => s.mode)
  // While one text is being edited, character-level fields act on the selected range (or what is typed next), not on the whole node.
  const editing = mode.kind === 'text' && nodes.length === 1 && nodes[0].id === mode.id ? mode : null
  const val = <K extends keyof RunStyle>(k: K): RunStyle[K] | null => (editing ? styleValue(editing, nodes[0], k) : (common(k as keyof Node) as RunStyle[K] | null))
  const set = (change: RunStyle, tag: string, refocus = true) => {
    if (!(editing && applyRunStyle(store, change))) return edit(change as Partial<Node>, tag)
    if (refocus) document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit text"]')?.focus() // keep typing after a panel change
  }
  const family = val('fontFamily'), weight = val('fontWeight'), align = common('textAlign')
  const italic = val('fontItalic'), truncate = common('textTruncate')
  const system = useSystemFonts()
  const base = system.length ? system : FONTS
  const fonts = family && !base.includes(family) ? [family, ...base] : base // keep an imported file's font selectable
  const paint = nodes[0].fills.find((p) => p.visible && p.type === 'SOLID')
  const colour = (editing ? val('fill') : null) ?? (paint?.type === 'SOLID' ? paint.color : { r: 0, g: 0, b: 0, a: 1 })
  return (
    <PanelSection title={editing ? 'Text (selection)' : 'Text'} action={editing ? undefined : <StyleButton link="textStyle" nodes={nodes} />}>
      <Select aria-label="Font family" value={family ?? ''} onChange={(e) => set({ fontFamily: e.target.value }, 'font')}>
        {family === null && <option value="" disabled>Mixed</option>}
        {fonts.map((f) => <option key={f}>{f}</option>)}
      </Select>
      <Row>
        <Select aria-label="Font weight" className="flex-1" value={weight ?? ''} onChange={(e) => set({ fontWeight: Number(e.target.value) }, 'weight')}>
          {(weight === null || !WEIGHTS.some(([w]) => w === weight)) && <option value={weight ?? ''} disabled>{weight ?? 'Mixed'}</option>}
          {WEIGHTS.map(([w, name]) => <option key={w} value={w}>{name}</option>)}
        </Select>
        <NumberField label="Font size" className="w-16" min={1} max={2000} value={val('fontSize') ?? null} onChange={(fontSize) => set({ fontSize }, 'size')} />
      </Row>
      <Row>
        <NumberField label="Line height" prefix="↕" className="flex-1" min={0} placeholder="Auto" value={val('lineHeight') || null} onChange={(lineHeight) => set({ lineHeight }, 'line-height')} />
        <NumberField label="Letter spacing" prefix="↔" className="flex-1" step={0.5} value={val('letterSpacing') ?? null} onChange={(letterSpacing) => set({ letterSpacing }, 'spacing')} />
      </Row>
      <div role="group" aria-label="Text align" className="flex gap-1">
        {TEXT_ALIGNS.map((a) => (
          <IconButton key={a} label={`Align ${a.toLowerCase()}`} icon={`align${a[0]}${a.slice(1).toLowerCase()}` as IconName} active={align === a} aria-pressed={align === a} onClick={() => edit({ textAlign: a }, 'align')} />
        ))}
      </div>
      <Row>
        <Select aria-label="Text decoration" className="flex-1" value={val('textDecoration') ?? 'NONE'} onChange={(e) => set({ textDecoration: e.target.value as RunStyle['textDecoration'] }, 'decoration')}>
          {TEXT_DECORATIONS.map((v) => <option key={v} value={v}>{v === 'NONE' ? 'No decoration' : v === 'UNDERLINE' ? 'Underline' : 'Strikethrough'}</option>)}
        </Select>
        <Select aria-label="Text case" className="flex-1" value={val('textCase') ?? 'ORIGINAL'} onChange={(e) => set({ textCase: e.target.value as RunStyle['textCase'] }, 'case')}>
          {TEXT_CASES.map((v) => <option key={v} value={v}>{{ ORIGINAL: 'Original case', UPPER: 'UPPER', LOWER: 'lower', TITLE: 'Title Case' }[v]}</option>)}
        </Select>
      </Row>
      {editing && <Row><ColorField label="Text" color={colour} onChange={(fill) => set({ fill }, 'text-colour', false)} /></Row>}
      <Row>
        <Select aria-label="List style" className="flex-1" value={common('listStyle') ?? 'NONE'} onChange={(e) => edit({ listStyle: e.target.value as Node['listStyle'] }, 'list')}>
          {TEXT_LISTS.map((v) => <option key={v} value={v}>{{ NONE: 'No list', BULLET: 'Bullets', NUMBERED: 'Numbers' }[v]}</option>)}
        </Select>
        <Select aria-label="Vertical align" className="flex-1" value={common('textAlignVertical') ?? 'TOP'} onChange={(e) => edit({ textAlignVertical: e.target.value as Node['textAlignVertical'] }, 'valign')}>
          {TEXT_VALIGNS.map((v) => <option key={v} value={v}>{{ TOP: 'Align top', CENTER: 'Align middle', BOTTOM: 'Align bottom' }[v]}</option>)}
        </Select>
      </Row>
      <Row>
        <Button aria-pressed={italic === true} onClick={() => set({ fontItalic: !italic }, 'italic')}>Italic</Button>
        <Button aria-pressed={truncate === true} onClick={() => edit({ textTruncate: !truncate }, 'truncate')}>Truncate</Button>
        <NumberField label="Max lines" className="w-16" min={0} placeholder="∞" value={common('maxLines') || null} onChange={(maxLines) => edit({ maxLines }, 'max-lines')} />
      </Row>
      {nodes.some((n) => !n.textAutoWidth) && <Button onClick={() => edit({ textAutoWidth: true }, 'auto-width')}>Auto width</Button>}
      {nodes.some((n) => n.textFixedHeight) && <Button onClick={() => edit({ textFixedHeight: false }, 'auto-height')}>Auto height</Button>}
    </PanelSection>
  )
}

/** Show/hide and remove buttons for one row of a fill, stroke or shadow list. */
const RowActions = ({ name, visible, onToggle, onRemove }: { name: string; visible: boolean; onToggle(): void; onRemove(): void }) => (
  <>
    <IconButton label={`${visible ? 'Hide' : 'Show'} ${name}`} icon={visible ? 'eye' : 'eyeOff'} aria-pressed={!visible} onClick={onToggle} />
    <IconButton label={`Remove ${name}`} icon="minus" onClick={onRemove} />
  </>
)

const PAINT_KINDS: [PaintKind, string][] =[['SOLID', 'Solid'], ['LINEAR', 'Linear'], ['RADIAL', 'Radial'], ['ANGULAR', 'Angular'], ['DIAMOND', 'Diamond']]

/** Fill or stroke list. With several layers selected it shows the first layer's paints and applies edits to all. */
function Paints({ title, field, nodes, report, children }: { title: string; field: 'fills' | 'strokes'; nodes: Node[]; report(e: unknown): void; children?: React.ReactNode }) {
  const store = useStore(), file = useRef<HTMLInputElement>(null)
  const ids = nodes.map((n) => n.id), paints = nodes[0][field]
  const set = (next: Paint[], tag?: string) =>
    store.update((d) => patch(d, ids, (n) => ({ [field]: next, ...(field === 'strokes' && next.length && !n.strokeWeight && { strokeWeight: 1 }) })), tag ? panelStep(`${field}:${tag}`, ids) : undefined)
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
        <StyleButton link={field === 'fills' ? 'fillStyle' : 'strokeStyle'} nodes={nodes} />
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
          {paints.map((p, i) => {
            const name = `${title} ${i + 1}`
            return (
              <div key={i} className="flex flex-col gap-1.5">
                {/* the type gets its own line so the colour field below keeps the full width */}
                <Row>
                  {p.type !== 'IMAGE' ? (
                    <Select aria-label={`${name} type`} className="flex-1" value={p.type === 'SOLID' ? 'SOLID' : p.kind} onChange={(e) => set(at(i, convertPaint(p, e.target.value as PaintKind)))}>
                      {PAINT_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </Select>
                  ) : <span className="flex h-6 flex-1 items-center rounded bg-raised px-1.5 text-dim">Image</span>}
                  <RowActions name={`${title.toLowerCase()} ${i + 1}`} visible={p.visible} onToggle={() => set(at(i, { ...p, visible: !p.visible }))} onRemove={() => set(paints.filter((_, j) => j !== i))} />
                </Row>
                <Row><NumberField label={`${name} opacity`} prefix="%" className="flex-1" min={0} max={100} value={Math.round((p.opacity ?? 1) * 100)} onChange={(v) => set(at(i, { ...p, opacity: v / 100 }), `opacity${i}`)} /></Row>
                {p.type === 'IMAGE' && (
                  <>
                    <Row>
                      <Select aria-label={`${name} image mode`} className="flex-1" value={p.scaleMode ?? 'FILL'} onChange={(e) => set(at(i, { ...p, scaleMode: e.target.value as ImagePaint['scaleMode'] }))}>
                        {IMAGE_MODES.map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
                      </Select>
                      {p.scaleMode === 'CROP' && field === 'fills' && nodes.length === 1 && <Button onClick={() => store.set({ mode: { kind: 'crop', id: ids[0], paint: i } })}>Crop</Button>}
                    </Row>
                    {(p.scaleMode === 'CROP' || p.scaleMode === 'TILE') && (
                      <>
                        <Row><NumberField label={`${name} scale`} prefix="%" className="flex-1" min={1} max={10000} value={Math.round((p.scale ?? 1) * 100)} onChange={(v) => set(at(i, { ...p, scale: v / 100 }), `scale${i}`)} /></Row>
                        <Row>
                          <NumberField label={`${name} offset X`} prefix="X" className="flex-1" value={Math.round(p.offsetX ?? 0)} onChange={(v) => set(at(i, { ...p, offsetX: v }), `ox${i}`)} />
                          <NumberField label={`${name} offset Y`} prefix="Y" className="flex-1" value={Math.round(p.offsetY ?? 0)} onChange={(v) => set(at(i, { ...p, offsetY: v }), `oy${i}`)} />
                        </Row>
                      </>
                    )}
                  </>
                )}
                {p.type === 'SOLID' && <Row><ColorField label={name} color={p.color} onChange={(color) => set(at(i, { ...p, color }), `color${i}`)} /></Row>}
                {p.type === 'GRADIENT' && <Row><NumberField label={`${name} angle`} prefix="∠" className="flex-1" min={-180} max={180} value={Math.round(gradientAngle(p))} onChange={(deg) => set(at(i, rotateGradient(p, deg)), `angle${i}`)} /></Row>}
                {p.type === 'GRADIENT' && (
                  <div className="flex flex-col gap-1.5">
                    {p.stops.map((s, k) => {
                      const stop = (change: Partial<GradientStop>, tag: string) => set(at(i, { ...p, stops: p.stops.map((o, j) => (j === k ? { ...o, ...change } : o)) }), `${tag}${i}-${k}`)
                      return (
                        <Row key={k}>
                          <NumberField label={`${name} stop ${k + 1} position`} prefix="@" className="w-12" min={0} max={100} value={Math.round(s.pos * 100)} onChange={(v) => stop({ pos: v / 100 }, 'pos')} />
                          <ColorField label={`${name} stop ${k + 1}`} color={s.color} onChange={(color) => stop({ color }, 'stop')} />
                          {p.stops.length > 2 && <IconButton label={`Remove ${name} stop ${k + 1}`} icon="minus" onClick={() => set(at(i, { ...p, stops: p.stops.filter((_, j) => j !== k) }))} />}
                        </Row>
                      )
                    })}
                    {/* .refig files hold at most 32 stops per gradient */}
                    <Button disabled={p.stops.length >= 32} onClick={() => set(at(i, { ...p, stops: [...p.stops, { pos: 0.5, color: colorAt(p.stops, 0.5) }] }))}>Add stop</Button>
                  </div>
                )}
              </div>
            )
          })}
          {children}
        </>
      )}
    </PanelSection>
  )
}

const BLUR_NAME = { LAYER_BLUR: 'Layer blur', BACKGROUND_BLUR: 'Background blur' } as const
const SHADOW: DropShadow = { visible: true, x: 0, y: 4, blur: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.25 } }

function Shadows({ nodes }: { nodes: Node[] }) {
  const store = useStore()
  const ids = nodes.map((n) => n.id), effects = nodes[0].effects, group = nodes[0].type === 'GROUP'
  const set = (next: Effect[], tag?: string) => store.update((d) => patch(d, ids, { effects: next }), tag ? panelStep(`shadow:${tag}`, ids) : undefined)
  const at = (i: number, change: Partial<DropShadow>, tag: string) => set(effects.map((s, j) => (j === i ? ({ ...s, ...change } as Effect) : s)), `${tag}${i}`)
  const add = (e: Effect) => set([...effects, e])
  const actions = (
    <>
      <StyleButton link="effectStyle" nodes={nodes} />
      {!group && <IconButton label="Add drop shadow" icon="plus" onClick={() => add(SHADOW)} />}
      {!group && <IconButton label="Add inner shadow" icon="plus" onClick={() => add({ ...SHADOW, type: 'INNER_SHADOW', y: 2 })} />}
      <IconButton label="Add layer blur" icon="plus" onClick={() => add({ type: 'LAYER_BLUR', visible: true, blur: 4 })} />
      {!group && <IconButton label="Add background blur" icon="plus" onClick={() => add({ type: 'BACKGROUND_BLUR', visible: true, blur: 8 })} />}
    </>
  )
  return (
    <PanelSection title="Effects" action={actions}>
      {effects.map((s, i) => {
        const toggle = () => set(effects.map((e, j) => (j === i ? { ...e, visible: !e.visible } : e)))
        const remove = () => set(effects.filter((_, j) => j !== i))
        if (!('color' in s))
          return (
            <Row key={i}>
              <NumberField label={`${BLUR_NAME[s.type]} ${i + 1}`} prefix="B" className="flex-1" min={0} value={s.blur} onChange={(blur) => at(i, { blur }, 'blur')} />
              <RowActions name={`${BLUR_NAME[s.type].toLowerCase()} ${i + 1}`} visible={s.visible} onToggle={toggle} onRemove={remove} />
            </Row>
          )
        const name = s.type === 'INNER_SHADOW' ? 'Inner shadow' : 'Shadow'
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <Row>
              <ColorField label={`${name} ${i + 1}`} color={s.color} onChange={(color) => at(i, { color }, 'color')} />
              <RowActions name={`${name.toLowerCase()} ${i + 1}`} visible={s.visible} onToggle={toggle} onRemove={remove} />
            </Row>
            <Row>
              <NumberField label={`${name} ${i + 1} X`} prefix="X" className="flex-1" value={s.x} onChange={(x) => at(i, { x }, 'x')} />
              <NumberField label={`${name} ${i + 1} Y`} prefix="Y" className="flex-1" value={s.y} onChange={(y) => at(i, { y }, 'y')} />
            </Row>
            <Row>
              <NumberField label={`${name} ${i + 1} blur`} prefix="B" className="flex-1" min={0} value={s.blur} onChange={(blur) => at(i, { blur }, 'blur')} />
              <NumberField label={`${name} ${i + 1} spread`} prefix="S" className="flex-1" value={s.spread} onChange={(spread) => at(i, { spread }, 'spread')} />
            </Row>
          </div>
        )
      })}
    </PanelSection>
  )
}
