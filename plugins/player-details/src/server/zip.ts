import { DataError, decompress } from './data.js';

// Just enough of the ZIP format to read the Minecraft client (a JAR): stored and deflated entries,
// no ZIP64, no encryption.

export interface ZipEntry {
  method: number;
  /** Offset of the local header. */
  offset: number;
  compressedSize: number;
  size: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** The entries of a ZIP archive by name. */
export function readZip(data: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new DataError('Not a ZIP archive');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new DataError('The ZIP directory is damaged');
    }
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

/** The content of one entry. */
export async function unzip(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (entry.offset + 30 > data.length || view.getUint32(entry.offset, true) !== LOCAL_HEADER) {
    throw new DataError('A ZIP entry is damaged');
  }
  const start =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new DataError(`Unsupported ZIP compression ${entry.method}`);
  return decompress(raw, 'deflate-raw', entry.size);
}
