import { API_PREFIX, externalAuthStartResultSchema, type ExternalAuthStart } from '@outpost/shared';
import { apiSend } from '@outpost/web-plugin-api';
import { safeNextPath } from './session.js';

const RETURN_KEY = 'outpost.externalAuthReturn';

/**
 * Sends the browser to a login provider. The server always redirects back to the fixed return
 * page (AuthReturnPage), so the page to continue with is kept in sessionStorage.
 */
export async function startExternalAuth(
  provider: string,
  body: ExternalAuthStart,
  returnTo: string,
): Promise<void> {
  const { url } = await apiSend(
    'POST',
    `${API_PREFIX}/auth/providers/${encodeURIComponent(provider)}/start`,
    body,
    externalAuthStartResultSchema,
  );
  try {
    sessionStorage.setItem(RETURN_KEY, returnTo);
  } catch {
    // Without storage the return page falls back to a default page.
  }
  window.location.assign(url);
}

/** Reads and forgets the page stored by startExternalAuth. */
export function takeStoredReturn(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return value;
  } catch {
    return null;
  }
}

/** The page to continue with after the provider sent the browser back. */
export function returnTarget(
  intent: string | undefined,
  failed: boolean,
  stored: string | null,
): string {
  switch (intent) {
    case 'login':
      return failed ? '/login' : safeNextPath(stored);
    case 'invite':
      return failed ? safeNextPath(stored) : '/';
    case 'sudo':
      return safeNextPath(stored ?? '/account');
    default:
      return '/account';
  }
}
