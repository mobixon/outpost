import { describe, expect, it } from 'vitest';
import { returnTarget } from './external-auth.js';

describe('returnTarget', () => {
  it.each([
    ['login', false, '/about', '/about'],
    ['login', false, null, '/'],
    ['login', false, '//evil.example', '/'],
    ['login', true, '/about', '/login'],
    ['invite', false, '/invite/abc', '/'],
    ['invite', true, '/invite/abc', '/invite/abc'],
    ['sudo', false, '/admin/users', '/admin/users'],
    ['sudo', true, null, '/account'],
    ['link', false, '/elsewhere', '/account'],
    [undefined, true, null, '/account'],
  ] as const)('%s (failed: %s, stored: %j) -> %s', (intent, failed, stored, expected) => {
    expect(returnTarget(intent, failed, stored)).toBe(expected);
  });
});
