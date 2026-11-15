import { useState } from 'react'
import type { Color } from '../../../shared/document'
import { ColorField, fromHex, Popover, toHex } from '../../ui'
import { documentColors, pushColor } from '../model/colors'
import { useEditor, useStore } from '../store'

type EyeDropperApi = { new (): { open(): Promise<{ sRGBHex: string }> } }

function Swatches({ title, colors, pick }: { title: string; colors: Color[]; pick(c: Color): void }) {
  if (!colors.length) return null
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-dim">{title}</div>
      <div className="flex flex-wrap gap-1">
        {colors.map((c) => (
          <button key={toHex(c)} type="button" aria-label={`${title} ${toHex(c)}`} title={`#${toHex(c)}`} onClick={() => pick(c)}
            className="h-5 w-5 rounded border border-line" style={{ background: `#${toHex(c)}` }} />
        ))}
      </div>
    </div>
  )
}

/** ColorField plus a popover of recent and document colours, and an eyedropper where the platform has one. */
export function PickField({ label, color, onChange }: { label: string; color: Color; onChange(c: Color): void }) {
  const store = useStore(), doc = useEditor((s) => s.doc), recent = useEditor((s) => s.recent)
  const [open, setOpen] = useState(false)
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper
  const pick = (c: Color) => {
    setOpen(false)
    onChange({ ...c, a: color.a })
    store.set({ recent: pushColor(store.get().recent, c) })
  }
  const sample = async () => {
    try {
      const rgb = fromHex((await new EyeDropper!().open()).sRGBHex)
      if (rgb) pick({ ...rgb, a: 1 })
    } catch {
      // Escape cancels the eyedropper
    }
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <ColorField label={label} color={color} onChange={onChange} />
      <Popover open={open} onClose={() => setOpen(false)} align="right" trigger={
        <button type="button" aria-label={`${label} swatches`} title="Recent and document colours" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
          className="h-6 w-5 rounded text-dim hover:bg-hover hover:text-ink">▾</button>
      }>
        <div role="dialog" aria-label={`${label} swatches`} className="w-44 rounded-md border border-line bg-canvas p-2 text-xs shadow-xl">
          {EyeDropper && <button type="button" className="mb-2 w-full rounded border border-line py-0.5 hover:bg-hover" onClick={() => void sample()}>Pick from screen</button>}
          <Swatches title="Recent" colors={recent} pick={pick} />
          <Swatches title="Document" colors={documentColors(doc)} pick={pick} />
        </div>
      </Popover>
    </div>
  )
}
