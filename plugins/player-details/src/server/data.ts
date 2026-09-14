/** Data of the game that cannot be read as it is: too large, damaged or in an unknown format. */
export class DataError extends Error {
  override name = 'DataError';
}

/** The formats of Minecraft's files and of the client archive. */
export type Compression = 'gzip' | 'deflate-raw';

/**
 * Unpacks data with the decompression streams of the platform (Node.js and browsers), refusing to
 * unpack more than `limit` bytes.
 */
export async function decompress(
  data: Uint8Array,
  format: Compression,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream(format))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new DataError(`The data unpacks to more than ${limit} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof DataError) throw err;
    throw new DataError(`The data cannot be unpacked: ${String(err)}`);
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

/** Unpacks gzip data, as Minecraft stores player and level data; other data stays as it is. */
export async function gunzip(data: Uint8Array, limit: number): Promise<Uint8Array> {
  return data[0] === 0x1f && data[1] === 0x8b ? decompress(data, 'gzip', limit) : data;
}
