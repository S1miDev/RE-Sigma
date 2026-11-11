// Reusable UI components. Everything interactive is a real button/input with an accessible name.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { Color } from '../../shared/document'
import { Icon, type IconName } from './icons'

export { Icon, type IconName }
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

const BUTTON = {
  primary: 'bg-accent text-white hover:brightness-110',
  secondary: 'bg-raised text-ink hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110',
  ghost: 'text-ink hover:bg-hover',
}
export function Button({ variant = 'secondary', className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return <button type={type} className={cx('inline-flex h-7 items-center justify-center gap-1.5 rounded px-3 text-xs font-medium disabled:cursor-default disabled:opacity-40', BUTTON[variant], className)} {...props} />
}

export function IconButton({ label, icon, active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('grid h-6 w-6 shrink-0 place-items-center rounded disabled:opacity-40', active ? 'bg-accent text-white' : 'text-dim hover:bg-hover hover:text-ink', className)} {...props}>
      <Icon name={icon} />
    </button>
  )
}

const FIELD = 'h-6 min-w-0 rounded border border-transparent bg-raised px-1.5 text-xs text-ink outline-none placeholder:text-dim hover:border-line focus:border-accent'
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(FIELD, className)} {...props} />
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(FIELD, 'pr-0', className)} {...props} />
}

/** Text input that commits on Enter or blur and reverts on Escape. */
export function TextField({ label, value, onCommit, className, placeholder }: { label: string; value: string; onCommit(v: string): void; className?: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = useRef(false)
  return (
    <Input
      aria-label={label}
      title={label}
      className={className}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && !cancel.current && draft !== value) onCommit(draft)
        cancel.current = false
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() }
      }}
    />
  )
}

/** Numeric input. `value: null` means the selection has mixed values. Arrow keys step (Shift ×10). */
export function NumberField({ label, prefix, value, onChange, min = -1e9, max = 1e9, step = 1, placeholder, className }: {
  label: string; prefix?: ReactNode; value: number | null; onChange(v: number): void; min?: number; max?: number; step?: number; placeholder?: string; className?: string
}) {
  const shown = value === null ? '' : String(Math.round(value * 100) / 100)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = useRef(false)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setDraft(null)
      onChange(clamp((Number((draft ?? shown).replace(',', '.')) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))
    }
  }
  return (
    <label title={label} className={cx(FIELD, 'flex items-center gap-1 focus-within:border-accent', className)}>
      {prefix !== undefined && <span aria-hidden="true" className="shrink-0 text-dim">{prefix}</span>}
      <input
        aria-label={label}
        inputMode="decimal"
        className="w-full min-w-0 bg-transparent outline-none placeholder:text-dim"
        placeholder={placeholder ?? (value === null ? 'Mixed' : undefined)}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKey}
        onBlur={() => {
          const v = Number((draft ?? '').replace(',', '.'))
          if (draft !== null && !cancel.current && draft.trim() !== '' && Number.isFinite(v) && clamp(v) !== value) onChange(clamp(v))
          cancel.current = false
          setDraft(null)
        }}
      />
    </label>
  )
}

export const toHex = (c: Color) => [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
export function fromHex(text: string): Pick<Color, 'r' | 'g' | 'b'> | null {
  let h = text.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }
}
/** Solid colour: native picker swatch, hex field and opacity. */
export function ColorField({ label, color, onChange }: { label: string; color: Color; onChange(c: Color): void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="color"
        aria-label={`${label} colour`}
        title={`${label} colour`}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
        value={`#${toHex(color).toLowerCase()}`}
        onChange={(e) => onChange({ ...fromHex(e.target.value)!, a: color.a })}
      />
      <TextField label={`${label} hex`} className="w-0 flex-1 uppercase" value={toHex(color)} onCommit={(v) => { const rgb = fromHex(v); if (rgb) onChange({ ...rgb, a: color.a }) }} />
      <NumberField label={`${label} opacity`} className="w-14" prefix="%" min={0} max={100} value={Math.round(color.a * 100)} onChange={(v) => onChange({ ...color, a: v / 100 })} />
    </div>
  )
}

export type MenuItem = { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; onSelect(): void } | null // null = separator

/** The popup of a menu: arrow keys move, Escape or an outside click closes. */
export function MenuList({ items, onClose, className, label }: { items: MenuItem[]; onClose(): void; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [])
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const all = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], i = all.indexOf(document.activeElement as HTMLButtonElement)
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
  }
  return (
    <div ref={ref} role="menu" aria-label={label} onKeyDown={onKey} className={cx('min-w-44 rounded-md border border-line bg-canvas py-1 shadow-xl', className)}>
      {items.map((item, i) =>
        item === null ? (
          <div key={i} role="separator" className="my-1 border-t border-line" />
        ) : (
          <button key={i} type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.onSelect() }}
            className={cx('flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-xs outline-none hover:bg-accent focus:bg-accent disabled:opacity-40 disabled:hover:bg-transparent', item.danger && 'text-danger hover:text-white focus:text-white')}>
            <span>{item.label}</span>
            {item.shortcut && <span className="text-dim">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}

/** Wraps a trigger and its popup: closes on outside press and Escape, and returns focus to the trigger. */
export function Popover({ open, onClose, trigger, children, align = 'left' }: { open: boolean; onClose(): void; trigger: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
      ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, onClose])
  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && <div className={cx('absolute top-full z-40 mt-1', align === 'right' ? 'right-0' : 'left-0')}>{children}</div>}
    </div>
  )
}

/** A button that opens a menu. */
export function Menu({ label, items, children, align, className }: { label: string; items: MenuItem[]; children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onClose={() => setOpen(false)} align={align} trigger={
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cx('flex h-6 items-center gap-0.5 rounded px-1 text-dim hover:bg-hover hover:text-ink', open && 'bg-hover text-ink', className)}>
        {children}
      </button>
    }>
      <MenuList label={label} items={items} onClose={() => setOpen(false)} />
    </Popover>
  )
}

/** Modal dialog. Escape or a click on the backdrop closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="w-96 max-w-[90vw] rounded-lg border border-line bg-panel p-4 shadow-2xl"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        <h2 id={id} className="mb-3 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}
export const DialogActions = ({ children }: { children: ReactNode }) => <div className="mt-4 flex justify-end gap-2">{children}</div>

export function PanelSection({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-line px-3 py-2.5">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-[11px] font-semibold">{title}</h3>
        {action}
      </div>
      {children && <div className="mt-1.5 flex flex-col gap-1.5">{children}</div>}
    </section>
  )
}

/** A side panel whose width can be dragged from its inner edge. */
export function SidePanel({ side, label, children }: { side: 'left' | 'right'; label: string; children: ReactNode }) {
  const [width, setWidth] = useState(240)
  const drag = useRef<{ x: number; w: number } | null>(null)
  return (
    <aside aria-label={label} style={{ width }} className={cx('relative flex shrink-0 flex-col bg-panel', side === 'left' ? 'border-r border-line' : 'border-l border-line')}>
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        className={cx('absolute top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/50', side === 'left' ? '-right-1' : '-left-1')}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, w: width } }}
        onPointerMove={(e) => drag.current && setWidth(Math.min(480, Math.max(200, drag.current.w + (e.clientX - drag.current.x) * (side === 'left' ? 1 : -1))))}
        onPointerUp={() => (drag.current = null)}
      />
    </aside>
  )
}

export function Toast({ message, onDone }: { message: string; onDone(): void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 5000)
    return () => clearTimeout(t)
  }, [message, onDone])
  return <div role="status" className="fixed bottom-16 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-black shadow-xl">{message}</div>
}

export function EmptyState({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      {text && <p className="text-dim">{text}</p>}
      {children && <div className="mt-2 flex gap-2">{children}</div>}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex items-center gap-2 text-dim">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}…
    </div>
  )
}
