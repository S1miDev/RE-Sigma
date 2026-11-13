import type { Color } from '../../../shared/document'

/** A colour as a CSS rgba() string, for the canvas. */
export const css = (c: Color) => `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`
/** A colour's rgb() without alpha, for SVG (which carries opacity separately). */
export const rgb = (c: Color) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
