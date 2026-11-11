// node --test research/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeSchema, decodeMessage, readCanvas } from './kiwi.mjs';

test('decodes a hand-built schema and message', () => {
  // enum Kind {A=0;B=1}  message Message { string name = 1; Kind kind = 2; int[] xs = 3; }
  const s = (t) => [...Buffer.from(t), 0];
  const schema = Uint8Array.from([
    2,
    ...s('Kind'), 0, 2, ...s('A'), 0, 0, 0, ...s('B'), 0, 0, 1,
    ...s('Message'), 2, 3, ...s('name'), 11, 0, 1, ...s('kind'), 0, 0, 2, ...s('xs'), 5, 1, 3,
  ]);
  const defs = decodeSchema(schema);
  assert.equal(defs[1].fields[0].type, 'string');
  const msg = decodeMessage(defs, Uint8Array.from([1, ...s('hi'), 2, 1, 3, 2, 3, 4, 0]));
  assert.deepEqual(msg, { name: 'hi', kind: 'B', xs: [-2, 2] });
});

test('decodes a real Figma .fig canvas', { skip: !fs.existsSync(new URL('./fixtures/canvas.fig', import.meta.url)) }, () => {
  const { version, message } = readCanvas(fs.readFileSync(new URL('./fixtures/canvas.fig', import.meta.url)));
  assert.equal(version, 106);
  assert.equal(message.type, 'NODE_CHANGES');
  assert.equal(message.nodeChanges[0].type, 'DOCUMENT');
  assert.ok(message.nodeChanges.some(n => n.type === 'CANVAS' && n.name === 'RE-probe'));
});
