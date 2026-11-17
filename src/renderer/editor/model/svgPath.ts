// SVG path data (any command, relative or absolute) → the absolute M L C Q Z that parsePath reads.
import { fmt } from './geometry'

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** An elliptical arc from (x0,y0) as cubic Béziers (SVG implementation notes F.6.5). Returns the C segments' numbers. */
function arcToCubics(x0: number, y0: number, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number): number[][] {
  rx = Math.abs(rx); ry = Math.abs(ry)
  if (!rx || !ry) return [[x0, y0, x, y, x, y]] // a zero radius is a straight line
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2, cy = sin * cx1 + cos * cy1 + (y0 + y) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  else if (sweep && dt < 0) dt += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / n, h = (4 / 3) * Math.tan(step / 4)
  const pt = (t: number): [number, number] => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]
  const d = (t: number): [number, number] => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos]
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const a = t1 + i * step, b = a + step, p0 = pt(a), p1 = pt(b), d0 = d(a), d1 = d(b)
    out.push([p0[0] + h * d0[0], p0[1] + h * d0[1], p1[0] - h * d1[0], p1[1] - h * d1[1], i === n - 1 ? x : p1[0], i === n - 1 ? y : p1[1]])
  }
  return out
}

/** Any SVG path data → absolute M L C Q Z. Malformed trailing data is dropped, as browsers do. */
export function absolutePath(d: string): string {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let out = '', cmd = '', i = 0, cx = 0, cy = 0, sx = 0, sy = 0, lastC: [number, number] | null = null, lastQ: [number, number] | null = null
  const f = fmt
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) { cmd = tokens[i++]; if (!(cmd.toUpperCase() in ARGS)) break }
    else if (!cmd) break
    const up = cmd.toUpperCase(), rel = cmd !== up
    if (up === 'Z') { out += 'Z'; cx = sx; cy = sy; lastC = lastQ = null; cmd = ''; continue }
    if (i + ARGS[up] > tokens.length) break
    // flags in an arc may be written without separators ("a1 1 0 00.5.5"); this reader needs them spaced, as most files do
    const a = tokens.slice(i, i + ARGS[up]).map(Number)
    i += ARGS[up]
    if (a.some(Number.isNaN)) break
    const ox = rel ? cx : 0, oy = rel ? cy : 0
    let nextC: [number, number] | null = null, nextQ: [number, number] | null = null
    if (up === 'M') { cx = a[0] + ox; cy = a[1] + oy; sx = cx; sy = cy; out += `M${f(cx)} ${f(cy)}`; cmd = rel ? 'l' : 'L' }
    else if (up === 'L') { cx = a[0] + ox; cy = a[1] + oy; out += `L${f(cx)} ${f(cy)}` }
    else if (up === 'H') { cx = a[0] + ox; out += `L${f(cx)} ${f(cy)}` }
    else if (up === 'V') { cy = a[0] + oy; out += `L${f(cx)} ${f(cy)}` }
    else if (up === 'C' || up === 'S') {
      const c1: [number, number] = up === 'C' ? [a[0] + ox, a[1] + oy] : lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]
      const k = up === 'C' ? 2 : 0, c2: [number, number] = [a[k] + ox, a[k + 1] + oy], p: [number, number] = [a[k + 2] + ox, a[k + 3] + oy]
      out += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p[0])} ${f(p[1])}`
      nextC = c2; cx = p[0]; cy = p[1]
    } else if (up === 'Q' || up === 'T') {
      const q: [number, number] = up === 'Q' ? [a[0] + ox, a[1] + oy] : lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]
      const k = up === 'Q' ? 2 : 0, p: [number, number] = [a[k] + ox, a[k + 1] + oy]
      out += `Q${f(q[0])} ${f(q[1])} ${f(p[0])} ${f(p[1])}`
      nextQ = q; cx = p[0]; cy = p[1]
    } else { // A
      const x = a[5] + ox, y = a[6] + oy
      for (const c of arcToCubics(cx, cy, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, x, y)) out += `C${c.map(f).join(' ')}`
      cx = x; cy = y
    }
    lastC = nextC; lastQ = nextQ
  }
  return out
}
