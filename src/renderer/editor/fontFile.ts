// Font files for outlining and embedding: installed fonts (Local Font Access API), else the bundled Inter.
import { create, type Font } from 'fontkit'
import type { Node } from '../../shared/document'
import { layoutText } from './canvas/text'
import interUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import interItalicUrl from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url'

/** `standIn`: Inter used for a family we couldn't load. Neither it nor a face from a .ttc (which @font-face can't select) is `embed`ded. */
export interface FontFile { font: Font; bytes: Uint8Array; mime: string; variable: boolean; embed: boolean; standIn?: boolean }
export type FontKey = { family: string; weight: number; italic: boolean }

const WEIGHTS: [RegExp, number][] = [[/thin|hairline/, 100], [/extra.?light|ultra.?light/, 200], [/light/, 300], [/medium/, 500], [/semi.?bold|demi/, 600], [/extra.?bold|ultra.?bold/, 800], [/bold/, 700], [/black|heavy/, 900]]
const weightOf = (style: string) => WEIGHTS.find(([re]) => re.test(style.toLowerCase()))?.[1] ?? 400
const MIME: Record<string, string> = { '\0\x01\0\0': 'font/ttf', OTTO: 'font/otf', wOFF: 'font/woff', wOF2: 'font/woff2' }
const mimeOf = (b: Uint8Array) => MIME[String.fromCharCode(...b.slice(0, 4))] ?? 'font/ttf'

const files = new Map<string, Promise<FontFile | undefined>>()
const done = new Map<string, FontFile | undefined>()
const keyOf = ({ family, weight, italic }: FontKey) => `${family}|${weight}|${italic}`

/** A font fontkit can read; for a collection (.ttc), the face named `postscriptName`. Undefined for anything else. */
function read(bytes: Uint8Array, postscriptName?: string): FontFile | undefined {
  try {
    const r = create(bytes)
    const font = 'fonts' in r ? (postscriptName ? r.getFont(postscriptName) : null) : r
    if (!font) return undefined
    return { font, bytes, mime: mimeOf(bytes), variable: !!font.variationAxes && Object.keys(font.variationAxes).length > 0, embed: !('fonts' in r) }
  } catch { return undefined } // a corrupt file
}

type LocalFont = { family: string; style: string; postscriptName: string; blob(): Promise<Blob> }
let local: Promise<LocalFont[]> | undefined // enumerated once per session (it lists every installed font and may ask for permission)
function localFonts(): Promise<LocalFont[]> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
  if (!q) return Promise.resolve([])
  local ??= q.call(window)
  return local.catch(() => ((local = undefined), [])) // denied or failed: try again next time
}

async function system(k: FontKey): Promise<FontFile | undefined> {
  const all = (await localFonts()).filter((f) => f.family === k.family)
  const score = (f: { style: string }) => Math.abs(weightOf(f.style) - k.weight) + (/italic|oblique/i.test(f.style) !== k.italic ? 1000 : 0)
  const best = all.sort((a, b) => score(a) - score(b))[0]
  return best && read(new Uint8Array(await (await best.blob()).arrayBuffer()), best.postscriptName)
}

const inter = async (k: FontKey): Promise<FontFile | undefined> => {
  const f = await fetch(k.italic ? interItalicUrl : interUrl).then((r) => r.arrayBuffer()).then((b) => read(new Uint8Array(b)), () => undefined)
  return f && k.family !== 'Inter' ? { ...f, embed: false, standIn: true } : f
}

/**
 * The file for a font, falling back to the bundled Inter (not embedded) for a family that can't be loaded. Resolves undefined if
 * nothing can be read; a failure isn't kept, so the next call tries again.
 */
export function loadFont(k: FontKey): Promise<FontFile | undefined> {
  const key = keyOf(k)
  let p = files.get(key)
  if (!p) {
    p = (async () => (await system(k).catch(() => undefined)) ?? (await inter(k)))()
    files.set(key, p)
    void p.then((f) => (f ? done.set(key, f) : files.delete(key)))
  }
  return p
}

/** A font already loaded by loadFont (sync, for layout code). */
export const loadedFont = (k: FontKey): FontFile | undefined => done.get(keyOf(k))

/** The font at the key's weight (variable fonts are instanced). */
export const fontAt = (f: FontFile, weight: number): Font => (f.variable ? f.font.getVariation({ wght: weight }) : f.font)

const keyOfStyle = (s: Node): FontKey => ({ family: s.fontFamily ?? 'Inter', weight: s.fontWeight ?? 400, italic: !!s.fontItalic })
const stylesOf = (n: Node) => layoutText(n).lines.flatMap((l) => l.segs.map((s) => s.style))

/** Whether every font the text node uses is loaded (so its outline can be computed). */
export const fontsReady = (n: Node): boolean => stylesOf(n).every((s) => loadedFontFor(s))

/** Loads every font the text nodes use. Call before the sync helpers below. Resolves to a warning naming the families that weren't available, if any. */
export async function preloadFonts(nodes: Node[]): Promise<string | undefined> {
  const keys = nodes.flatMap(stylesOf).map(keyOfStyle)
  const files = await Promise.all(keys.map(loadFont))
  const missing = [...new Set(keys.filter((_, i) => !files[i] || files[i]!.standIn).map((k) => k.family))]
  return missing.length ? `Font not available, Inter used for outlines and export: ${missing.join(', ')}` : undefined
}

/** The loaded font for a text style (sync; undefined until preloadFonts has run). */
export const loadedFontFor = (s: Node): Font | undefined => { const k = keyOfStyle(s), f = loadedFont(k); return f && fontAt(f, k.weight) }

/** The distinct loaded font files the text nodes use, as @font-face rules (base64 data URLs). */
export function fontFaces(nodes: Node[]): string {
  const seen = new Set<string>()
  return nodes.flatMap(stylesOf).flatMap((s) => {
    const k = keyOfStyle(s), key = keyOf(k), f = loadedFont(k)
    if (!f?.embed || seen.has(key)) return [] // a stand-in isn't embedded: a viewer with the real font installed shows it
    seen.add(key)
    return [`@font-face{font-family:"${cssName(k.family)}";font-weight:${k.weight};font-style:${k.italic ? 'italic' : 'normal'};src:url(data:${f.mime};base64,${toBase64(f.bytes)})}`]
  }).join('')
}
/** A family name as a CSS string body that is also safe XML text (the rule goes in an SVG <style>); XML decodes it back to the name the text's font-family attribute holds. */
export const cssName = (s: string) =>
  s.replace(/[\\"\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `).replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
const toBase64 =(b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
