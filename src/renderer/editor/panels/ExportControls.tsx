import { useState } from 'react'
import type { ExportKind } from '../../../shared/api'
import { EXPORT_FORMATS, type ExportSetting } from '../../../shared/document'
import { Button, IconButton, Input, Row, Select } from '../../ui'
import { defaultSetting, exportPage, exportSelection, exportSettings } from '../export'
import { patch } from '../model/ops'
import { useEditor, useStore } from '../store'

const SCALES = [0.5, 1, 1.5, 2, 3, 4]
const vector = (f: ExportKind) => f === 'svg' || f === 'pdf'

/**
 * Quick export of the selection (or the page, with nothing selected), plus the saved export list of the one selected layer
 * (or the page). Used in the Design panel and the File → Export… dialog.
 */
export function ExportControls({ onDone, onError }: { onDone(path: string | null): void; onError(e: unknown): void }) {
  const store = useStore()
  const selection = useEditor((s) => s.selection), pageId = useEditor((s) => s.pageId), doc = useEditor((s) => s.doc)
  const [kind, setKind] = useState<ExportKind>('png')
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState(false)
  const targets = selection.length ? selection : [pageId], target = targets.length === 1 ? doc.nodes[targets[0]] : null
  const saved = target?.exports ?? []
  const setSaved = (next: ExportSetting[]) => store.update((d) => patch(d, [target!.id], { exports: next.length ? next : undefined }), { key: `exports:${target!.id}` })
  const change = (i: number, c: Partial<ExportSetting>) => setSaved(saved.map((e, j) => (j === i ? { ...e, ...c } : e)))
  const run = async (job: () => Promise<string | null>) => {
    setBusy(true)
    try {
      onDone(await job())
    } catch (e) {
      onError(e)
    }
    setBusy(false)
  }
  const withSettings = targets.filter((id) => doc.nodes[id]?.exports?.length)
  return (
    <>
      <Row>
        <Select aria-label="Export scale" className="flex-1" value={scale} disabled={vector(kind)} onChange={(e) => setScale(Number(e.target.value))}>
          {SCALES.map((s) => <option key={s} value={s}>{s}x</option>)}
        </Select>
        <Select aria-label="Export format" className="flex-1" value={kind} onChange={(e) => setKind(e.target.value as ExportKind)}>
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
          <option value="webp">WebP</option>
          <option value="svg">SVG</option>
          <option value="pdf">PDF</option>
        </Select>
      </Row>
      <Row>
        {selection.length > 0
          ? <Button className="flex-1" onClick={() => run(() => exportSelection(store, kind, scale))} disabled={busy}>{busy ? 'Exporting…' : 'Export selection'}</Button>
          : <Button className="flex-1" onClick={() => run(() => exportPage(store, kind, scale))} disabled={busy}>{busy ? 'Exporting…' : 'Export page'}</Button>}
        {target && <IconButton label="Save as export setting" icon="plus" disabled={saved.length >= 20} onClick={() => setSaved([...saved, defaultSetting(kind, scale)])} />}
      </Row>
      {saved.map((e, i) => (
        <Row key={i}>
          <Select aria-label="Saved export scale" className="w-14" value={e.scale} disabled={vector(e.format)} onChange={(ev) => change(i, { scale: Number(ev.target.value) })}>
            {[...new Set([...SCALES, e.scale])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s}x</option>)}
          </Select>
          <Input aria-label="Saved export suffix" className="flex-1" placeholder="Suffix" value={e.suffix} maxLength={100} onChange={(ev) => change(i, { suffix: ev.target.value })} />
          <Select aria-label="Saved export format" className="w-16" value={e.format} onChange={(ev) => change(i, { format: ev.target.value as ExportSetting['format'] })}>
            {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </Select>
          <IconButton label="Remove export setting" icon="minus" onClick={() => setSaved(saved.filter((_, j) => j !== i))} />
        </Row>
      ))}
      {withSettings.length > 0 && <Button onClick={() => run(() => exportSettings(store, withSettings))} disabled={busy}>Export saved settings</Button>}
    </>
  )
}
