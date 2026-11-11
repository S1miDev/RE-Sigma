/** A message fit for the user. Strips the wrapper Electron adds to errors that cross IPC. */
export const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

export function dataUrl(bytes: Uint8Array): string {
  const is = (s: string, o = 0) => [...s].every((c, i) => bytes[o + i] === c.charCodeAt(0))
  const type = is('\x89PNG') ? 'image/png' : is('\xff\xd8') ? 'image/jpeg' : is('GIF8') ? 'image/gif' : is('WEBP', 8) ? 'image/webp' : 'application/octet-stream'
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
