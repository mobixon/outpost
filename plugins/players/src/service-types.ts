/** A player the Players module has seen online on a server. */
export interface KnownPlayer {
  /** Lowercase, with dashes. */
  uuid: string;
  /** The name the player had when last seen. */
  name: string;
}

/** What the Players module offers other modules (`ctx.services.get('outpost.players')`). */
export interface PlayersService {
  /** Who was online at the last look (every 15 seconds). */
  online(serverId: string): Promise<KnownPlayer[]>;
  /** Everyone seen on the server, by name. */
  known(serverId: string): Promise<KnownPlayer[]>;
}
