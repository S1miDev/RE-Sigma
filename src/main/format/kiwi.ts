// Minimal Kiwi (github.com/evanw/kiwi) binary-schema + message decoder, written from the format spec.
// Moved from research/kiwi.mjs. Decoded messages are untyped by nature, hence `any`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import zlib from 'node:zlib'

const MAX_CHUNK = 1024 ** 3 // decompression cap (zip-bomb guard)

class Buf {
  o = 0
  constructor(private b: Uint8Array) {}
  byte() {
    if (this.o >= this.b.length) throw new Error('kiwi: read past end')
    return this.b[this.o++]
  }
  bool() {
    return this.byte() === 1
  }
  varuint() {
    let v = 0, s = 0, x
    do {
      x = this.byte()
      v |= (x & 127) << s
      s += 7
    } while (x & 128 && s < 35)
    return v >>> 0
  }
  varint() {
    const v = this.varuint()
    return v & 1 ? ~(v >>> 1) : v >>> 1
  }
  varuint64() {
    let v = 0n, s = 0n, x
    do {
      x = this.byte()
      v |= BigInt(x & 127) << s
      s += 7n
    } while (x & 128 && s < 63n)
    if (x & 128) v |= BigInt(this.byte()) << s
    return v
  }
  varint64() {
    const v = this.varuint64()
    return v & 1n ? ~(v >> 1n) : v >> 1n
  }
  varfloat() {
    const first = this.byte()
    if (first === 0) return 0
    let bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)
    bits = (bits << 23) | (bits >>> 9)
    const f = new DataView(new ArrayBuffer(4))
    f.setInt32(0, bits, true)
    return f.getFloat32(0, true)
  }
  string() {
    const s = this.o
    while (this.byte() !== 0);
    return Buffer.from(this.b.subarray(s, this.o - 1)).toString('utf8')
  }
  bytes() {
    const n = this.varuint()
    if (this.o + n > this.b.length) throw new Error('kiwi: read past end')
    const r = this.b.subarray(this.o, this.o + n)
    this.o += n
    return r
  }
}

const BUILTIN: Record<number, string> = { [-1]: 'bool', [-2]: 'byte', [-3]: 'int', [-4]: 'uint', [-5]: 'float', [-6]: 'string', [-7]: 'int64', [-8]: 'uint64' }
const KIND = ['ENUM', 'STRUCT', 'MESSAGE']
export interface KiwiDef { name: string; kind: string; fields: { name: string; type: any; isArray: boolean; value: number }[] }

export function decodeSchema(u8: Uint8Array): KiwiDef[] {
  const b = new Buf(u8), defs: KiwiDef[] = []
  for (let n = b.varuint(); n--; ) {
    const name = b.string(), kind = KIND[b.byte()], fields = []
    for (let f = b.varuint(); f--; ) fields.push({ name: b.string(), type: b.varint(), isArray: b.bool(), value: b.varuint() })
    defs.push({ name, kind, fields })
  }
  for (const d of defs)
    for (const f of d.fields) {
      const t = f.type < 0 ? BUILTIN[f.type] : defs[f.type]?.name
      if (!t) throw new Error('kiwi: bad type reference')
      f.type = t
    }
  return defs
}

export function decodeMessage(defs: KiwiDef[], u8: Uint8Array, root = 'Message'): any {
  const byName = Object.fromEntries(defs.map((d) => [d.name, d])), b = new Buf(u8)
  const one = (t: string): any => {
    switch (t) {
      case 'bool': return b.bool()
      case 'byte': return b.byte()
      case 'int': return b.varint()
      case 'uint': return b.varuint()
      case 'float': return b.varfloat()
      case 'string': return b.string()
      case 'int64': return b.varint64()
      case 'uint64': return b.varuint64()
    }
    const d = byName[t]
    if (!d) throw new Error(`kiwi: unknown type ${t}`)
    if (d.kind === 'ENUM') {
      const v = b.varuint()
      return d.fields.find((f) => f.value === v)?.name ?? v
    }
    const o: any = {}
    if (d.kind === 'STRUCT') {
      for (const f of d.fields) o[f.name] = field(f)
      return o
    }
    for (let id; (id = b.varuint()) !== 0; ) {
      const f = d.fields.find((f) => f.value === id)
      if (!f) throw new Error(`kiwi: unknown field ${id} in ${t}`)
      o[f.name] = field(f)
    }
    return o
  }
  const field = (f: KiwiDef['fields'][number]) =>
    f.isArray ? (f.type === 'byte' ? b.bytes() : Array.from({ length: b.varuint() }, () => one(f.type))) : one(f.type)
  return one(root)
}

// canvas.fig = "fig-kiwi" + u32 version + [u32 len + chunk]*; chunk 0 = schema, chunk 1 = message (deflate-raw or zstd).
export function readCanvas(u8: Uint8Array): { version: number; defs: KiwiDef[]; message: any } {
  const buf = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
  if (buf.subarray(0, 8).toString('latin1') !== 'fig-kiwi') throw new Error('Not a Figma file (missing fig-kiwi header)')
  const chunks: Buffer[] = []
  for (let o = 12; o + 4 <= buf.length; ) {
    const n = buf.readUInt32LE(o)
    if (o + 4 + n > buf.length) throw new Error('Figma file is truncated')
    chunks.push(buf.subarray(o + 4, o + 4 + n))
    o += 4 + n
  }
  if (chunks.length < 2) throw new Error('Figma file is truncated')
  const opts = { maxOutputLength: MAX_CHUNK }
  const unpack = (c: Buffer) =>
    c[0] === 0x28 && c[1] === 0xb5 && c[2] === 0x2f && c[3] === 0xfd ? zlib.zstdDecompressSync(c, opts) : zlib.inflateRawSync(c, opts)
  const defs = decodeSchema(unpack(chunks[0]))
  return { version: buf.readUInt32LE(8), defs, message: decodeMessage(defs, unpack(chunks[1])) }
}
