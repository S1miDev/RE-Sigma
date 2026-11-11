// Minimal Kiwi (github.com/evanw/kiwi) binary-schema + message decoder, written from the format spec.
// Usage: node research/kiwi.mjs <canvas.fig> <outDir>
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

class Buf {
  constructor(u8) { this.b = u8; this.o = 0; }
  byte() { if (this.o >= this.b.length) throw new Error('kiwi: read past end'); return this.b[this.o++]; }
  bool() { return this.byte() === 1; }
  varuint() { let v = 0, s = 0, x; do { x = this.byte(); v |= (x & 127) << s; s += 7; } while (x & 128 && s < 35); return v >>> 0; }
  varint() { const v = this.varuint(); return v & 1 ? ~(v >>> 1) : v >>> 1; }
  varuint64() { let v = 0n, s = 0n, x; do { x = this.byte(); v |= BigInt(x & 127) << s; s += 7n; } while (x & 128 && s < 63n); if (x & 128) v |= BigInt(this.byte()) << s; return v; }
  varint64() { const v = this.varuint64(); return v & 1n ? ~(v >> 1n) : v >> 1n; }
  varfloat() {
    const first = this.byte(); if (first === 0) return 0;
    let bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24);
    bits = (bits << 23) | (bits >>> 9);
    const f = new DataView(new ArrayBuffer(4)); f.setInt32(0, bits, true); return f.getFloat32(0, true);
  }
  string() { const s = this.o; while (this.byte() !== 0); return Buffer.from(this.b.subarray(s, this.o - 1)).toString('utf8'); }
  bytes() { const n = this.varuint(); const r = this.b.subarray(this.o, this.o + n); this.o += n; return r; }
}

const BUILTIN = { [-1]: 'bool', [-2]: 'byte', [-3]: 'int', [-4]: 'uint', [-5]: 'float', [-6]: 'string', [-7]: 'int64', [-8]: 'uint64' };
const KIND = ['ENUM', 'STRUCT', 'MESSAGE'];

export function decodeSchema(u8) {
  const b = new Buf(u8), defs = [];
  for (let n = b.varuint(); n--;) {
    const name = b.string(), kind = KIND[b.byte()], fields = [];
    for (let f = b.varuint(); f--;) fields.push({ name: b.string(), type: b.varint(), isArray: b.bool(), value: b.varuint() });
    defs.push({ name, kind, fields });
  }
  for (const d of defs) for (const f of d.fields) f.type = f.type < 0 ? BUILTIN[f.type] : defs[f.type].name;
  return defs;
}

export function decodeMessage(defs, u8, root = 'Message') {
  const byName = Object.fromEntries(defs.map(d => [d.name, d])), b = new Buf(u8);
  const one = t => {
    switch (t) {
      case 'bool': return b.bool(); case 'byte': return b.byte(); case 'int': return b.varint(); case 'uint': return b.varuint();
      case 'float': return b.varfloat(); case 'string': return b.string(); case 'int64': return b.varint64(); case 'uint64': return b.varuint64();
    }
    const d = byName[t];
    if (d.kind === 'ENUM') { const v = b.varuint(); return d.fields.find(f => f.value === v)?.name ?? v; }
    const o = {};
    if (d.kind === 'STRUCT') { for (const f of d.fields) o[f.name] = field(f); return o; }
    for (let id; (id = b.varuint()) !== 0;) {
      const f = d.fields.find(f => f.value === id);
      if (!f) throw new Error(`kiwi: unknown field ${id} in ${t}`);
      o[f.name] = field(f);
    }
    return o;
  };
  const field = f => f.isArray ? (f.type === 'byte' ? b.bytes() : Array.from({ length: b.varuint() }, () => one(f.type))) : one(f.type);
  return one(root);
}

// .fig container: zip(canvas.fig, meta.json, thumbnail.png, images/*); canvas.fig = "fig-kiwi" + u32 version + [u32 len + chunk]*
export function readCanvas(buf) {
  const magic = buf.subarray(0, 8).toString();
  if (magic !== 'fig-kiwi') throw new Error('not a fig-kiwi canvas: ' + magic);
  const chunks = [];
  for (let o = 12; o < buf.length;) { const n = buf.readUInt32LE(o); chunks.push(buf.subarray(o + 4, o + 4 + n)); o += 4 + n; }
  const unpack = c => c[0] === 0x28 && c[1] === 0xb5 && c[2] === 0x2f && c[3] === 0xfd ? zlib.zstdDecompressSync(c) : zlib.inflateRawSync(c);
  const defs = decodeSchema(unpack(chunks[0]));
  return { version: buf.readUInt32LE(8), defs, message: decodeMessage(defs, unpack(chunks[1])) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('kiwi.mjs')) {
  const [inFile, outDir] = process.argv.slice(2);
  const { version, defs, message } = readCanvas(fs.readFileSync(inFile));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'schema.txt'), defs.map(d => `${d.kind.toLowerCase()} ${d.name} {\n${d.fields.map(f => d.kind === 'ENUM' ? `  ${f.name} = ${f.value};` : `  ${f.type}${f.isArray ? '[]' : ''} ${f.name}${d.kind === 'STRUCT' ? '' : ' = ' + f.value};`).join('\n')}\n}`).join('\n\n'));
  fs.writeFileSync(path.join(outDir, 'message.json'), JSON.stringify(message, (k, v) => typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? `<bytes ${v.length}>` : v, 1));
  console.log({ version, definitions: defs.length, messageKeys: Object.keys(message), nodeChanges: message.nodeChanges?.length, blobs: message.blobs?.length });
}
