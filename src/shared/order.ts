// Fractional order keys: orderBetween(a, b) returns a string k with a < k < b (plain string comparison).
// '' means "no bound". Keys never end with the lowest character, so a key between any two always exists.
const MIN = 33
const MAX = 126

export function orderBetween(a = '', b = ''): string {
  let out = ''
  for (let i = 0; ; i++) {
    const lo = i < a.length ? a.charCodeAt(i) : MIN
    const hi = i < b.length ? b.charCodeAt(i) : MAX + 1
    if (hi - lo > 1) return out + String.fromCharCode((lo + hi) >> 1)
    out += String.fromCharCode(lo)
    if (hi > lo) b = '' // the prefix is now below b, so the rest is unbounded above
  }
}
