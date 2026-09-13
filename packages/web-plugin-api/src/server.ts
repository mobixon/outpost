import type { ServerSummary } from '@outpost/shared';
import { inject, type Component, type InjectionKey, type Ref } from 'vue';
import type { RouteRecordSingleView } from 'vue-router';

/** Keys of the server tabs of the core; plugins cannot use them. */
export const RESERVED_SERVER_TAB_KEYS: readonly string[] = ['members', 'audit', 'settings'];

/** A tab on the page of a game server, at `/servers/<slug>/<key>`. */
export interface ServerTab {
  /** Unique across plugins: lowercase letters, digits and dashes. */
  key: string;
  /** i18n key of the label. */
  label: string;
  icon: Component;
  component: RouteRecordSingleView['component'];
  /** Permission the user needs on the server to see the tab. */
  permission: string;
  /** Capability the server must have, e.g. `logs.stream`, or a list of which it needs one. */
  capability?: string | readonly string[];
  /** Position among the tabs; lower comes first. Defaults to 500. */
  order?: number;
}

/** What a server tab knows about its server. */
export interface ServerContext {
  /** The server of the page, with the signed-in user's role and permissions. */
  server: Readonly<Ref<ServerSummary>>;
  /** Loads the server again, e.g. after changing it. */
  reload(): Promise<void>;
}

export const serverContextKey: InjectionKey<ServerContext> = Symbol('outpost.server');

/** The server of the current page; only usable in components of a server tab. */
export function useServerContext(): ServerContext {
  const context = inject(serverContextKey);
  if (context === undefined) throw new Error('useServerContext() works only inside a server tab');
  return context;
}
