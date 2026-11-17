// The slice of fontkit (which ships no types) that Refig uses.
declare module 'fontkit' {
  export interface PathCommand { command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath'; args: number[] }
  export interface Glyph { path: { commands: PathCommand[] }; advanceWidth: number }
  export interface Font {
    unitsPerEm: number
    variationAxes?: Record<string, unknown>
    getVariation(settings: Record<string, number>): Font
    layout(text: string): { glyphs: Glyph[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] }
  }
  /** A collection (.ttc/.dfont) comes back as a FontCollection, not a Font. */
  export interface FontCollection { fonts: Font[]; getFont(postscriptName: string): Font | null }
  export function create(data: Uint8Array): Font | FontCollection
}
