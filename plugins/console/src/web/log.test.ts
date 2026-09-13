import { describe, expect, it } from 'vitest';
import { logLevel } from './log.js';

describe('logLevel', () => {
  it.each([
    ['[12:00:00] [Server thread/INFO]: Done (3.2s)!', 'info'],
    ["[12:00:01] [Server thread/WARN]: Can't keep up!", 'warn'],
    ['[12:00:02] [Server thread/ERROR]: Encountered an unexpected exception', 'error'],
    ['[12:00:03 WARN]: Paper style', 'warn'],
    ['[12:00:04 SEVERE]: Old Bukkit style', 'error'],
    ['\tat net.minecraft.server.Main.main(Main.java:42)', 'info'],
    ['<Alex> look: [x/ERROR]', 'error'],
  ])('%s is %s', (text, level) => {
    expect(logLevel(text)).toBe(level);
  });
});
