// Adapted from lizupingsama/Honor-of-Kings-Match-Dashboard, xxtea.ts,
// commit c04acbabe21c85230c5911a07c6aba55577ea634. Mulan PSL v2.
// See ../../../../docs/arena-third-party.md and ../../../../docs/licenses/MulanPSL-2.0.txt.
// THIS SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTIES OF ANY KIND.
const DELTA = 0x9e3779b9;

function words(bytes, includeLength) {
  const out = Array.from({ length: Math.ceil(bytes.length / 4) }, (_, i) =>
    ((bytes[4 * i] || 0) | ((bytes[4 * i + 1] || 0) << 8) |
    ((bytes[4 * i + 2] || 0) << 16) | ((bytes[4 * i + 3] || 0) << 24)) >>> 0);
  if (includeLength) out.push(bytes.length);
  return out;
}

function bytes(values, includeLength) {
  const capacity = values.length * 4;
  const length = includeLength ? values.at(-1) : capacity;
  if (includeLength && (length > capacity - 4 || length < capacity - 7)) throw new Error('Invalid XXTEA length');
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++) out[i] = values[i >>> 2] >>> ((i & 3) * 8) & 255;
  return out;
}

function mix(sum, y, z, position, e, key) {
  return (((z >>> 5 ^ y << 2) + (y >>> 3 ^ z << 4)) ^ ((sum ^ y) + (key[position & 3 ^ e] ^ z))) >>> 0;
}

function keyWords(key) {
  const out = words(Buffer.from(key), false);
  while (out.length < 4) out.push(0);
  return out;
}

export function encryptXXTEA(input, key) {
  const data = Buffer.from(input);
  if (!data.length) return Buffer.alloc(0);
  const v = words(data, true), k = keyWords(key), last = v.length - 1;
  let z = v[last], sum = 0;
  for (let rounds = Math.floor(6 + 52 / v.length); rounds > 0; rounds--) {
    sum = sum + DELTA >>> 0;
    const e = sum >>> 2 & 3;
    for (let p = 0; p < last; p++) z = v[p] = v[p] + mix(sum, v[p + 1], z, p, e, k) >>> 0;
    z = v[last] = v[last] + mix(sum, v[0], z, last, e, k) >>> 0;
  }
  return bytes(v, false);
}

export function decryptXXTEA(input, key) {
  const data = Buffer.from(input);
  if (!data.length) return Buffer.alloc(0);
  if (data.length < 8 || data.length % 4) throw new Error('Invalid XXTEA block');
  const v = words(data, false), k = keyWords(key), last = v.length - 1;
  let sum = Math.floor(6 + 52 / v.length) * DELTA >>> 0, y = v[0];
  while (sum !== 0) {
    const e = sum >>> 2 & 3;
    for (let p = last; p > 0; p--) y = v[p] = v[p] - mix(sum, y, v[p - 1], p, e, k) >>> 0;
    y = v[0] = v[0] - mix(sum, y, v[last], 0, e, k) >>> 0;
    sum = sum - DELTA >>> 0;
  }
  return bytes(v, true);
}
