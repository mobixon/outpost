import helmet from '@fastify/helmet';
import { HttpError } from '@outpost/plugin-api';
import { CSRF_HEADER } from '@outpost/shared';
import type { FastifyInstance } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Security headers for every response, and CSRF protection for the API: state-changing requests
 * must carry a custom header (which cross-site forms cannot set) and, when the browser sends an
 * Origin, come from Outpost's own origin. The session cookie is SameSite=Lax on top of that.
 */
export async function registerSecurity(app: FastifyInstance, publicUrl: string): Promise<void> {
  const https = publicUrl.startsWith('https:');
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Popovers and menus are positioned with inline styles.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: https ? [] : null,
      },
    },
    strictTransportSecurity: https ? { maxAge: 31_536_000 } : false,
  });

  const allowedOrigin = new URL(publicUrl).origin;
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== allowedOrigin) {
      throw new HttpError(403, 'origin_not_allowed', `Requests from ${origin} are not allowed`);
    }
    if (request.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'csrf_header_missing', `Send the ${CSRF_HEADER}: 1 header`);
    }
  });
}
