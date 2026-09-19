import type { PlayersService } from './service-types.js';

export type { PlayersService, KnownPlayer } from './service-types.js';

declare module '@outpost/plugin-api' {
  interface OutpostServices {
    /** Who plays on the servers, from the history the Players module keeps. */
    'outpost.players': PlayersService;
  }
}
