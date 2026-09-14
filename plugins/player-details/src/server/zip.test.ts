import { describe, expect, it } from 'vitest';
import { DataError } from './data.js';
import { writeZip } from './testing.js';
import { readZip, unzip } from './zip.js';

describe('readZip', () => {
  it('lists the entries of an archive and unpacks them', async () => {
    const archive = await writeZip({
      'assets/minecraft/lang/en_us.json': '{"item.minecraft.stick":"Stick"}',
      'assets/minecraft/textures/item/stick.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const entries = readZip(archive);
    expect([...entries.keys()]).toEqual([
      'assets/minecraft/lang/en_us.json',
      'assets/minecraft/textures/item/stick.png',
    ]);
    const lang = entries.get('assets/minecraft/lang/en_us.json');
    const texture = entries.get('assets/minecraft/textures/item/stick.png');
    expect(lang && new TextDecoder().decode(await unzip(archive, lang))).toBe(
      '{"item.minecraft.stick":"Stick"}',
    );
    expect(texture && (await unzip(archive, texture))).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('refuses data that is not an archive', () => {
    expect(() => readZip(new Uint8Array(100))).toThrow(DataError);
  });
});
