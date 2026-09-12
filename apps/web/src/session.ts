import { API_PREFIX, sessionStateSchema, type SessionState } from '@outpost/shared';
import { apiFetch } from '@outpost/web-plugin-api';

/** The session state, or null when the server cannot be reached. */
export async function loadSession(): Promise<SessionState | null> {
  try {
    return await apiFetch(`${API_PREFIX}/auth/session`, sessionStateSchema);
  } catch {
    return null;
  }
}

/**
 * Where to send the user instead of `path`, or null when the page may be shown: first-run setup,
 * then login, then the mandatory two-factor enrollment, then the panel.
 */
export function redirectFor(path: string, session: SessionState): string | null {
  if (session.setupRequired) return path === '/setup' ? null : '/setup';
  if (path === '/setup') return '/';
  if (session.status !== 'active') {
    if (path === '/login') return null;
    return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
  }
  if (path === '/login') return '/';
  if (session.twoFactorEnrollmentRequired) return path === '/account' ? null : '/account';
  return null;
}

/** The page to open after login; only same-site paths are accepted, so it cannot redirect away. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
