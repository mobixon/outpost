import { DataError } from './data.js';

// Minecraft's Named Binary Tag format, as in player and level files: big-endian, strings in
// "modified UTF-8" (Java's DataOutput), a named compound at the root.

/** A value of an NBT tag. Longs are bigints; compounds have no prototype. */
export type NbtValue =
  number | bigint | string | NbtValue[] | NbtCompound | Int8Array | Int32Array | BigInt64Array;

export interface NbtCompound {
  [name: string]: NbtValue | undefined;
}

export const isCompound = (value: unknown): value is NbtCompound =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !ArrayBuffer.isView(value);

const MAX_DEPTH = 512;

/** Decodes Java's modified UTF-8: `\0` as two bytes, characters beyond U+FFFF as surrogate pairs. */
function decodeModifiedUtf8(bytes: Uint8Array): string {
  const units: number[] = [];
  for (let at = 0; at < bytes.length;) {
    const first = bytes[at] ?? 0;
    if (first < 0x80) {
      units.push(first);
      at += 1;
    } else if ((first & 0xe0) === 0xc0) {
      units.push(((first & 0x1f) << 6) | ((bytes[at + 1] ?? 0) & 0x3f));
      at += 2;
    } else if ((first & 0xf8) === 0xf0) {
      // Standard UTF-8 for characters beyond U+FFFF, which Java itself never writes.
      const point =
        ((first & 0x07) << 18) |
        (((bytes[at + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[at + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[at + 3] ?? 0) & 0x3f);
      units.push(0xd800 + ((point - 0x10000) >> 10), 0xdc00 + ((point - 0x10000) & 0x3ff));
      at += 4;
    } else {
      units.push(
        ((first & 0x0f) << 12) |
          (((bytes[at + 1] ?? 0) & 0x3f) << 6) |
          ((bytes[at + 2] ?? 0) & 0x3f),
      );
      at += 3;
    }
  }
  let text = '';
  for (let at = 0; at < units.length; at += 8192) {
    text += String.fromCharCode(...units.slice(at, at + 8192));
  }
  return text;
}

/** Reads uncompressed NBT data with a compound at the root. */
export function readNbt(data: Uint8Array): NbtCompound {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const take = (bytes: number): number => {
    if (bytes < 0 || at + bytes > data.length) throw new DataError('The NBT data ends too early');
    const start = at;
    at += bytes;
    return start;
  };
  const length = () => {
    const value = view.getInt32(take(4));
    if (value < 0) throw new DataError('The NBT data has a negative length');
    return value;
  };
  const string = () => {
    const size = view.getUint16(take(2));
    const start = take(size);
    return decodeModifiedUtf8(data.subarray(start, start + size));
  };

  const payload = (type: number, depth: number): NbtValue => {
    if (depth > MAX_DEPTH) throw new DataError('The NBT data is nested too deeply');
    switch (type) {
      case 1:
        return view.getInt8(take(1));
      case 2:
        return view.getInt16(take(2));
      case 3:
        return view.getInt32(take(4));
      case 4:
        return view.getBigInt64(take(8));
      case 5:
        return view.getFloat32(take(4));
      case 6:
        return view.getFloat64(take(8));
      case 7: {
        const size = length();
        const start = take(size);
        return new Int8Array(data.slice(start, start + size).buffer);
      }
      case 8:
        return string();
      case 9: {
        const element = view.getUint8(take(1));
        const size = length();
        // Every element takes at least one byte, so a larger count is damaged data.
        if (size > data.length - at) throw new DataError('The NBT list is longer than the data');
        const list: NbtValue[] = [];
        for (let index = 0; index < size; index++) list.push(payload(element, depth + 1));
        return list;
      }
      case 10: {
        const compound: NbtCompound = Object.create(null) as NbtCompound;
        for (;;) {
          const child = view.getUint8(take(1));
          if (child === 0) return compound;
          const name = string();
          compound[name] = payload(child, depth + 1);
        }
      }
      case 11: {
        const size = length();
        const start = take(size * 4);
        const values = new Int32Array(size);
        for (let index = 0; index < size; index++) values[index] = view.getInt32(start + index * 4);
        return values;
      }
      case 12: {
        const size = length();
        const start = take(size * 8);
        const values = new BigInt64Array(size);
        for (let index = 0; index < size; index++) {
          values[index] = view.getBigInt64(start + index * 8);
        }
        return values;
      }
      default:
        throw new DataError(`Unknown NBT tag type ${type}`);
    }
  };

  if (view.getUint8(take(1)) !== 10)
    throw new DataError('The NBT data has no compound at the root');
  string();
  return payload(10, 0) as NbtCompound;
}
