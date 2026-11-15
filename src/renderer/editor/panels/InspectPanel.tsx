import { useState } from 'react'
import { typeLabel, type Node } from '../../../shared/document'
import { dataUrl } from '../../util'
import { Button, PanelSection, Row, Select } from '../../ui'
import { cssText, cssOf, htmlOf, rgba } from '../model/code'
import { toSvg } from '../export/svg'
import { fmt, worldBox } from '../model/geometry'
import { useEditor, useStore } from '../store'
import { ExportControls } from './ExportControls'

const LANGS = ['CSS', 'HTML + CSS', 'SVG'] as const
type Lang = (typeof LANGS)[number]

/** Dev mode's right panel: what the selected layer measures, which colours and type it uses, and its code. Read-only. */
export function InspectPanel({ report }: { report(e: unknown): void }) {
  const store = useStore()
  const doc = useEditor((s) => s.doc), selection = useEditor((s) => s.selection)
  const [lang, setLang] = useState<Lang>('CSS')
  const [copied, setCopied] = useState(false)
  const n: Node | undefined = selection.length === 1 ? doc.nodes[selection[0]] : undefined

  if (!n) {
    return (
      <div data-keep-text className="min-h-0 flex-1 overflow-auto">
        <PanelSection title="Inspect">
          <p className="text-dim">{selection.length > 1 ? 'Select a single layer to inspect it.' : 'Select a layer to see its measurements and code.'}</p>
        </PanelSection>
        <PanelSection title="Assets"><ExportControls onDone={() => {}} onError={report} /></PanelSection>
      </div>
    )
  }

  const parent = n.parentId ? doc.nodes[n.parentId] : undefined, box = worldBox(doc, [n.id]), pbox = parent && parent.type !== 'PAGE' ? worldBox(doc, [parent.id]) : null
  const code =
    lang === 'CSS' ? `.${n.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'layer'} {\n${cssText(cssOf(doc, n))}\n}`
    : lang === 'HTML + CSS' ? htmlOf(doc, n.id)
    : toSvg(doc, [n.id], (hash) => (store.imageBytes(hash) ? dataUrl(store.imageBytes(hash)!) : undefined))
  const copy = () => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(report) }
  const swatches = [...n.fills.map((p) => ['Fill', p] as const), ...n.strokes.map((p) => ['Stroke', p] as const)].filter(([, p]) => p.visible && p.type === 'SOLID')

  return (
    <div data-keep-text className="min-h-0 flex-1 overflow-auto">
      <PanelSection title={`${typeLabel(n.type)}: ${n.name}`}>
        <Row><Info label="X" value={n.x} /><Info label="Y" value={n.y} /></Row>
        <Row><Info label="W" value={n.width} /><Info label="H" value={n.height} /></Row>
        {!!n.rotation && <Row><Info label="Rotation" value={`${fmt(n.rotation)}°`} /></Row>}
        {box && pbox && (
          <Row>
            <Info label="Left" value={box.x - pbox.x} /><Info label="Top" value={box.y - pbox.y} />
            <Info label="Right" value={pbox.x + pbox.w - box.x - box.w} /><Info label="Bottom" value={pbox.y + pbox.h - box.y - box.h} />
          </Row>
        )}
      </PanelSection>

      {!!swatches.length && (
        <PanelSection title="Colors">
          {swatches.map(([kind, p], i) => p.type === 'SOLID' && (
            <Row key={i}>
              <span className="h-4 w-4 shrink-0 rounded border border-line" style={{ background: rgba(p.color, p.opacity) }} />
              <span className="flex-1">{kind}</span><code>{rgba(p.color, p.opacity).toUpperCase()}</code>
            </Row>
          ))}
        </PanelSection>
      )}

      {n.type === 'TEXT' && (
        <PanelSection title="Typography">
          <Row><Info label="Font" value={`${n.fontFamily ?? 'Inter'} ${n.fontWeight ?? 400}`} /><Info label="Size" value={n.fontSize ?? 16} /></Row>
          <Row><Info label="Line" value={n.lineHeight || 'auto'} /><Info label="Spacing" value={n.letterSpacing ?? 0} /></Row>
        </PanelSection>
      )}

      <PanelSection title="Code">
        <Row>
          <Select aria-label="Code language" className="flex-1" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l}>{l}</option>)}
          </Select>
          <Button onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </Row>
        <pre aria-label="Generated code" className="max-h-80 select-text overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-canvas p-2 font-mono">{code}</pre>
      </PanelSection>

      <PanelSection title="Assets"><ExportControls onDone={() => {}} onError={report} /></PanelSection>
    </div>
  )
}

function Info({ label, value }: { label: string; value: number | string }) {
  return <div className="flex min-w-0 flex-1 gap-1"><span className="text-dim">{label}</span><span className="truncate">{typeof value === 'number' ? fmt(value) : value}</span></div>
}
