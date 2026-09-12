import { describe, expect, it } from 'vitest';
import { findMissingMessageKeys } from './messages.js';

describe('findMissingMessageKeys', () => {
  it('returns nothing for catalogs with the same keys', () => {
    expect(findMissingMessageKeys({ a: 'A', b: { c: 'C' } }, { a: 'А', b: { c: 'Ц' } })).toEqual(
      [],
    );
  });

  it('reports missing keys and shape mismatches as dotted paths', () => {
    const reference = { a: 'A', b: { c: 'C', d: 'D' }, e: { f: 'F' } };
    const candidate = { b: { c: 'C' }, e: 'E' };
    expect(findMissingMessageKeys(reference, candidate)).toEqual(['a', 'b.d', 'e']);
  });
});
