// MD5 for name-based UUIDs such as the offline UUIDs of Minecraft players; not for security.

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const CONSTANTS = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0,
);

/** The UTF-8 bytes of a text. */
export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** The MD5 digest (16 bytes) of the data. */
export function md5(data: Uint8Array): Uint8Array {
  const total = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(total);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = data.length * 8;
  view.setUint32(total - 8, bits >>> 0, true);
  view.setUint32(total - 4, Math.floor(bits / 2 ** 32), true);

  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < total; offset += 64) {
    let [a = 0, b = 0, c = 0, d = 0] = state;
    for (let step = 0; step < 64; step++) {
      const round = step >> 4;
      const mix =
        round === 0
          ? (b & c) | (~b & d)
          : round === 1
            ? (d & b) | (~d & c)
            : round === 2
              ? b ^ c ^ d
              : c ^ (b | ~d);
      const word = [step, 5 * step + 1, 3 * step + 5, 7 * step][round] ?? 0;
      const sum =
        (a + mix + (CONSTANTS[step] ?? 0) + view.getUint32(offset + (word % 16) * 4, true)) | 0;
      const shift = SHIFTS[round * 4 + (step % 4)] ?? 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] = ((state[0] ?? 0) + a) | 0;
    state[1] = ((state[1] ?? 0) + b) | 0;
    state[2] = ((state[2] ?? 0) + c) | 0;
    state[3] = ((state[3] ?? 0) + d) | 0;
  }
  const digest = new DataView(new ArrayBuffer(16));
  state.forEach((value, index) => digest.setUint32(index * 4, value >>> 0, true));
  return new Uint8Array(digest.buffer);
}
