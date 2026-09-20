/**
 * Events and their payloads. Plugins add their own events through declaration merging:
 *
 * ```ts
 * declare module '@outpost/plugin-api' {
 *   interface OutpostEvents {
 *     'acme.bridge.message': { text: string };
 *   }
 * }
 * ```
 */
export interface OutpostEvents {
  /** Startup finished: all plugins are set up and all routes are registered. */
  'outpost.started': { version: string };
  /** A module was switched on or off for a server. */
  'outpost.module.changed': { serverId: string; pluginId: string; enabled: boolean };
  /** Shutdown has begun; plugins are stopped right after the handlers finish. */
  'outpost.stopping': Record<string, never>;
}

export type EventName = keyof OutpostEvents;

export type EventHandler<K extends EventName> = (payload: OutpostEvents[K]) => void | Promise<void>;

export interface EventBus {
  /** Subscribes to an event and returns a function that unsubscribes. */
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void;
  /** Calls all handlers and waits for them. A failing handler is logged and does not stop others. */
  emit<K extends EventName>(event: K, payload: OutpostEvents[K]): Promise<void>;
}
