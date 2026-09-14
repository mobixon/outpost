// Helpers for tests: NBT and ZIP data as Minecraft and Mojang write them. Outpost does not use
// them itself.

interface Tagged {
  readonly nbt: number;
  readonly value: unknown;
}

export type NbtInput = string | number | Tagged | NbtInput[] | { [name: string]: NbtInput };

const tagged =
  (nbt: number) =>
  (value: unknown): Tagged => ({ nbt, value });
export const byte = tagged(1);
export const short = tagged(2);
export const int = tagged(3);
export const long = tagged(4);
export const float = tagged(5);
export const double = tagged(6);
export const intArray = tagged(11);
/** A list of one tag type, e.g. `list(6, [double(1), double(2)])`; plain arrays hold compounds. */
export const list = (type: number, values: NbtInput[]): Tagged => ({
  nbt: 9,
  value: { type, values },
});

const isTagged = (value: unknown): value is Tagged =>
  typeof value === 'object' && value !== null && 'nbt' in value && 'value' in value;

function typeOf(value: NbtInput): number {
  if (typeof value === 'string') return 8;
  if (typeof value === 'number') return 3;
  if (isTagged(value)) return value.nbt;
  return Array.isArray(value) ? 9 : 10;
}

/** Writes uncompressed NBT with a compound at the root. */
export function writeNbt(root: { [name: string]: NbtInput }): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  const scratch = new DataView(new ArrayBuffer(8));
  const push = (size: number) => {
    for (let index = 0; index < size; index++) bytes.push(scratch.getUint8(index));
  };
  // Java's modified UTF-8: `\0` as two bytes, surrogates one by one as three bytes each.
  const string = (text: string) => {
    const encoded: number[] = [];
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      if (unit !== 0 && unit < 0x80) encoded.push(unit);
      else if (unit < 0x800) encoded.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
      else encoded.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
    }
    scratch.setUint16(0, encoded.length);
    push(2);
    bytes.push(...encoded);
  };
  const payload = (type: number, input: NbtInput): void => {
    const value = isTagged(input) ? input.value : input;
    switch (type) {
      case 1:
        scratch.setInt8(0, Number(value));
        return push(1);
      case 2:
        scratch.setInt16(0, Number(value));
        return push(2);
      case 3:
        scratch.setInt32(0, Number(value));
        return push(4);
      case 4:
        scratch.setBigInt64(0, BigInt(value as bigint | number));
        return push(8);
      case 5:
        scratch.setFloat32(0, Number(value));
        return push(4);
      case 6:
        scratch.setFloat64(0, Number(value));
        return push(8);
      case 8:
        return string(String(value));
      case 9: {
        const { type: element, values } = Array.isArray(value)
          ? {
              type: value.length === 0 ? 0 : typeOf(value[0] as NbtInput),
              values: value as NbtInput[],
            }
          : (value as { type: number; values: NbtInput[] });
        bytes.push(element);
        scratch.setInt32(0, values.length);
        push(4);
        for (const entry of values) payload(element, entry);
        return;
      }
      case 10:
        for (const [name, entry] of Object.entries(value as Record<string, NbtInput>)) {
          bytes.push(typeOf(entry));
          string(name);
          payload(typeOf(entry), entry);
        }
        bytes.push(0);
        return;
      case 11: {
        const values = value as number[];
        scratch.setInt32(0, values.length);
        push(4);
        for (const entry of values) {
          scratch.setInt32(0, entry);
          push(4);
        }
        return;
      }
      default:
        throw new Error(`Cannot write NBT tag type ${type}`);
    }
  };
  bytes.push(10);
  string('');
  payload(10, root);
  return Uint8Array.from(bytes);
}

async function compress(data: Uint8Array, format: 'gzip' | 'deflate-raw'): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const gzip = (data: Uint8Array) => compress(data, 'gzip');

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive of deflated files, like a JAR. */
export async function writeZip(
  files: Record<string, Uint8Array | string>,
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const compressed = await compress(data, 'deflate-raw');
    const name = encoder.encode(path);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, 8, true);
    header.setUint32(14, crc32(data), true);
    header.setUint32(18, compressed.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    local.push(new Uint8Array(header.buffer), name, compressed);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, 8, true);
    entry.setUint32(16, crc32(data), true);
    entry.setUint32(20, compressed.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + compressed.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
