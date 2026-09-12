import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import {
  HttpError,
  type AuthenticatedUser,
  type PluginDefinition,
  type RouteAccess,
  type RouteDefinition,
  type RouteRequest,
  type RouteSchema,
} from '@outpost/plugin-api';
import { pluginApiPath, type ApiErrorBody } from '@outpost/shared';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { AuditLog } from './audit.js';
import { createProviders, type GithubEndpoints } from './auth/providers.js';
import { AuthService, toAuthenticatedUser } from './auth/service.js';
import type { Config } from './config.js';
import { createDatabase } from './db/connection.js';
import { CORE_SCOPE, coreMigrations } from './db/core-migrations.js';
import { runMigrations } from './db/migrator.js';
import { createEventBus } from './events.js';
import { registerSecurity } from './http/security.js';
import { isClientRoute, registerWebUi } from './http/web-ui.js';
import { PluginHost, resolvePlugins } from './plugins/host.js';
import { builtInPlugins } from './plugins/registry.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerExternalAuthRoutes } from './routes/external-auth.js';
import { registerInvitationRoutes } from './routes/invitations.js';
import { registerMeRoutes } from './routes/me.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerUserRoutes } from './routes/users.js';

export interface BuildAppOptions {
  /** Plugins to choose from instead of the built-in ones (used by tests). */
  plugins?: readonly PluginDefinition[];
  /** GitHub URLs instead of github.com (used by tests). */
  githubEndpoints?: GithubEndpoints;
}

/** Creates the server with database, plugins and routes ready. Call `listen()` to serve. */
export async function buildApp(
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(config),
    trustProxy: config.trustProxy,
    // Per-request log lines are too noisy for a panel that polls; errors are still logged.
    logController: new Fastify.LogController({ disableRequestLogging: true }),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Set before any route: Fastify binds these to a route when the route is built, and an
  // `await app.register(...)` later on builds all routes declared so far.
  app.setErrorHandler(handleError);
  const serveWebUi = config.webDir !== undefined;
  app.setNotFoundHandler(async (request, reply) => {
    if (serveWebUi && isClientRoute(request)) return reply.sendFile('index.html');
    return reply
      .code(404)
      .send(errorBody('not_found', `Route ${request.method} ${request.url} not found`));
  });

  const { db, dialect } = createDatabase(config.databaseUrl);
  let host: PluginHost | undefined;
  app.addHook('onClose', async () => {
    await host?.stop();
    await db.destroy();
  });

  try {
    // Must be registered before any route so that every route appears in the OpenAPI document.
    await app.register(swagger, {
      openapi: { info: { title: 'Outpost API', version: config.version } },
      transform: jsonSchemaTransform,
    });
    await app.register(cookie);
    // A general limit per client IP; login and code attempts have stricter limits of their own.
    await app.register(rateLimit, {
      max: 600,
      timeWindow: '1 minute',
      errorResponseBuilder: (_request, context) =>
        new HttpError(429, 'rate_limited', `Too many requests. Try again in ${context.after}.`),
    });
    await registerSecurity(app, config.publicUrl);

    await runMigrations(
      db,
      dialect,
      CORE_SCOPE,
      coreMigrations,
      app.log.child({ scope: CORE_SCOPE }),
    );

    if (config.usingDevelopmentSecretKey) {
      app.log.warn('OUTPOST_SECRET_KEY is not set: using an insecure development key');
    }
    const audit = new AuditLog(db, app.log);
    const providers = createProviders(config.providers, options.githubEndpoints);
    const auth = new AuthService(db, config, audit, providers);
    await auth.setup.init(db, app.log);
    app.decorateRequest('auth', null);
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api/')) request.auth = await auth.authenticate(request);
    });

    const events = createEventBus(app.log);
    const plugins = new PluginHost(
      resolvePlugins(options.plugins ?? builtInPlugins, config.plugins),
      {
        db,
        dialect,
        events,
        audit,
        logger: app.log,
        instanceVersion: config.version,
        registerRoute: (pluginId, route) => registerPluginRoute(app, auth, pluginId, route),
      },
    );
    host = plugins;

    registerSystemRoutes(app, {
      plugins,
      requireUser: (request) => auth.requireUser(request),
      checkDatabase: async () => {
        try {
          await sql`select 1`.execute(db);
          return true;
        } catch {
          return false;
        }
      },
    });
    registerAuthRoutes(app, auth);
    registerExternalAuthRoutes(app, auth);
    registerInvitationRoutes(app, auth);
    registerMeRoutes(app, auth);
    registerUserRoutes(app, auth);
    await plugins.start();

    if (config.webDir) await registerWebUi(app, config.webDir);

    app.addHook('onReady', async () => {
      await events.emit('outpost.started', { version: config.version });
    });
    app.addHook('preClose', async () => {
      await events.emit('outpost.stopping', {});
    });

    await app.ready();
    app.log.info(
      { version: config.version, database: dialect, plugins: plugins.list() },
      'Outpost is ready',
    );
  } catch (err) {
    await app.close();
    throw err;
  }
  return app;
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.env === 'development') {
    return {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: config.logLevel };
}

function registerPluginRoute(
  app: FastifyInstance,
  auth: AuthService,
  pluginId: string,
  route: RouteDefinition<RouteSchema, RouteAccess>,
): void {
  if (route.url !== '' && !route.url.startsWith('/')) {
    throw new Error(`Plugin "${pluginId}" route URL must start with "/": ${route.url}`);
  }
  const { params, querystring, body, response } = route.schema ?? {};
  app.route({
    method: route.method,
    url: pluginApiPath(pluginId, route.url),
    schema: {
      tags: [pluginId],
      ...(params && { params }),
      ...(querystring && { querystring }),
      ...(body && { body }),
      ...(response && { response: { 200: response } }),
    },
    handler: async (request) => {
      let user: AuthenticatedUser | undefined;
      if (route.access === 'public') {
        const ctx = request.auth;
        if (ctx !== null && ctx.session.status === 'active' && !auth.enrollmentRequired(ctx)) {
          user = toAuthenticatedUser(ctx.user);
        }
      } else {
        user = toAuthenticatedUser(auth.requireUser(request).user);
      }
      return route.handler({
        params: request.params,
        query: request.query,
        body: request.body,
        user,
        ip: request.ip,
      } as RouteRequest<RouteSchema, RouteAccess>);
    },
  });
}

function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

function handleError(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply
      .code(400)
      .send(errorBody('validation_error', 'Request validation failed', error.validation));
  }
  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'response does not match its schema');
    return reply.code(500).send(errorBody('internal_error', 'Internal server error'));
  }
  const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (status >= 500) {
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send(errorBody('internal_error', 'Internal server error'));
  }
  return reply.code(status).send(errorBody(error.code ?? 'bad_request', error.message));
}
