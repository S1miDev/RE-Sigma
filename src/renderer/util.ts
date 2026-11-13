import { imageType } from '../shared/image'

/** A message fit for the user. Strips the wrapper Electron adds to errors that cross IPC. */
export const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

export function dataUrl(bytes: Uint8Array): string {
  const type = imageType(bytes) ?? 'application/octet-stream'
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(bin)}`
}

export const relativeTime = (iso: string, now = Date.now()) => {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

/** True when a key event belongs to a text field rather than the editor. */
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/**
 * True when a key or clipboard event belongs to the page rather than the editor's shortcuts: typing in a field,
 * anything while a dialog is open or inside a menu, and Enter/Space on a focused button (which press it).
 */
export function keyBelongsToPage(e: Event): boolean {
  const t = e.target instanceof HTMLElement ? e.target : null, key = (e as KeyboardEvent).key
  return isTyping(t) || document.querySelector('[aria-modal="true"]') !== null || t?.closest('[role="menu"]') != null
    || (t?.closest('button') != null && (key === 'Enter' || key === ' '))
}
