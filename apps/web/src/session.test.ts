import type { SessionState } from '@outpost/shared';
import { describe, expect, it } from 'vitest';
import { redirectFor, safeNextPath } from './session.js';

const state = (overrides: Partial<SessionState>): SessionState => ({
  setupRequired: false,
  status: 'active',
  user: null,
  twoFactorEnrollmentRequired: false,
  sudoUntil: null,
  ...overrides,
});

describe('redirectFor', () => {
  it('sends everyone to setup until the first account exists', () => {
    const fresh = state({ setupRequired: true, status: 'anonymous' });
    expect(redirectFor('/', fresh)).toBe('/setup');
    expect(redirectFor('/login', fresh)).toBe('/setup');
    expect(redirectFor('/setup', fresh)).toBeNull();
  });

  it('sends signed-out users to login and remembers the page', () => {
    const anonymous = state({ status: 'anonymous' });
    expect(redirectFor('/', anonymous)).toBe('/login');
    expect(redirectFor('/about', anonymous)).toBe('/login?next=%2Fabout');
    expect(redirectFor('/login', anonymous)).toBeNull();
    expect(redirectFor('/setup', anonymous)).toBe('/');
    expect(redirectFor('/about', state({ status: 'mfa' }))).toBe('/login?next=%2Fabout');
  });

  it('keeps accounts that must enable 2FA on the account page', () => {
    const enrolling = state({ twoFactorEnrollmentRequired: true });
    expect(redirectFor('/', enrolling)).toBe('/account');
    expect(redirectFor('/account', enrolling)).toBeNull();
  });

  it('lets signed-in users through and away from login', () => {
    expect(redirectFor('/about', state({}))).toBeNull();
    expect(redirectFor('/login', state({}))).toBe('/');
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/about', '/about'],
    ['/servers/1?tab=console', '/servers/1?tab=console'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('%j -> %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
