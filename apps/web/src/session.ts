import {
  API_PREFIX,
  EXTERNAL_AUTH_RETURN_PATH,
  sessionStateSchema,
  type SessionState,
} from '@outpost/shared';
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
 * then login, then the mandatory two-factor enrollment, then the panel. `next` is the `?next=`
 * query value of the login page.
 */
export function redirectFor(path: string, session: SessionState, next?: unknown): string | null {
  if (session.setupRequired) return path === '/setup' ? null : '/setup';
  if (path === '/setup') return '/';
  // Invitation links and the page that external logins return to work in every session state.
  if (path === EXTERNAL_AUTH_RETURN_PATH || path.startsWith('/invite/')) return null;
  if (session.status !== 'active') {
    if (path === '/login') return null;
    return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
  }
  if (session.twoFactorEnrollmentRequired) return path === '/account' ? null : '/account';
  // Signed in on the login page (the page reloads after a login): go on to the requested page.
  if (path === '/login') return safeNextPath(next);
  if (path.startsWith('/admin/') && session.user?.isSuperadmin !== true) return '/';
  return null;
}

/** The page to open after login; only same-site paths are accepted, so it cannot redirect away. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}
