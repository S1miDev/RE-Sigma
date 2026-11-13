import { useState } from 'react'
import type { ExportKind } from '../../../shared/api'
import { Button, Row, Select } from '../../ui'
import { exportSelection } from '../export'
import { useEditor, useStore } from '../store'

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
