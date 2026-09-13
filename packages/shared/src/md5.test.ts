import { describe, expect, it } from 'vitest';
import { md5, utf8 } from './md5.js';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('md5', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
    ['Привет', '8a669e9418750c81ab90ae159a8ec410'],
    ['a'.repeat(100), '36a92cc94a9e0fa21f625f8bfb007adf'],
  ])('hashes %j', (text, digest) => {
    expect(hex(md5(utf8(text)))).toBe(digest);
  });
});
