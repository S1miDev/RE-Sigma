/** The media type of PNG, JPEG, GIF or WebP bytes, sniffed from their header; null for anything else. */
export function imageType(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  const at = (s: string, o = 0) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0))
  if (at('\x89PNG')) return 'image/png'
  if (at('\xff\xd8\xff')) return 'image/jpeg'
  if (at('GIF8')) return 'image/gif'
  if (at('RIFF') && at('WEBP', 8)) return 'image/webp'
  return null
}
