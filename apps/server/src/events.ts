import type { EventBus, EventHandler, EventName } from '@outpost/plugin-api';
import type { FastifyBaseLogger } from 'fastify';

// Any handler is assignable to this type; it is cast back to the event's handler type on emit.
type StoredHandler = (payload: never) => void | Promise<void>;

export function createEventBus(log: FastifyBaseLogger): EventBus {
  const handlers = new Map<EventName, Set<StoredHandler>>();

  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },

    async emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      await Promise.all(
        [...set].map(async (handler) => {
          try {
            await (handler as EventHandler<typeof event>)(payload);
          } catch (err) {
            log.error({ err, event }, 'event handler failed');
          }
        }),
      );
    },
  };
}
