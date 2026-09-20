import { z } from 'zod';

export * from './admin.js';
export * from './auth.js';
export * from './connection.js';
export * from './messages.js';
export * from './minecraft-files.js';
export * from './minecraft-log.js';
export * from './minecraft.js';
export * from './servers.js';
export * from './time.js';

/** Base path of the HTTP API. */
export const API_PREFIX = '/api/v1';

// At least two dot-separated segments of lowercase words joined by single hyphens.
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;

/** Plugin ids look like `outpost.players` or `acme.discord-bridge`. */
export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id);
}

/** URL of a plugin's HTTP route, e.g. `pluginApiPath('outpost.about', '/info')`. */
export function pluginApiPath(pluginId: string, path = ''): string {
  return `${API_PREFIX}/plugins/${pluginId}${path}`;
}

/** URL of a plugin's route of one game server (see `ctx.http.serverRoute`). */
export function serverPluginApiPath(serverId: string, pluginId: string, path = ''): string {
  return `${API_PREFIX}/servers/${encodeURIComponent(serverId)}/plugins/${pluginId}${path}`;
}

export const pluginInfoSchema = z.object({
  id: z.string(),
  version: z.string(),
  /** The games the plugin supports; null when it works with any game. */
  games: z.array(z.string()).nullable(),
  /** The plugin cannot be switched off for a server. */
  essential: z.boolean(),
  /** Whether the module is on for a server that has not been told otherwise. */
  defaultEnabled: z.boolean(),
});
export type PluginInfo = z.infer<typeof pluginInfoSchema>;

export const pluginListSchema = z.object({
  plugins: z.array(pluginInfoSchema),
});
export type PluginList = z.infer<typeof pluginListSchema>;

export const healthSchema = z.object({
  status: z.literal('ok'),
});

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.boolean()),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** Body of every error response of the API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
