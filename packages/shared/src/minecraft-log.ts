// Lines of `logs/latest.log` of Minecraft Java that tell what players do.

/** What a line of the log tells about a player. */
export type GameLogEvent =
  | { type: 'chat'; player: string; message: string }
  | { type: 'joined'; player: string }
  | { type: 'left'; player: string };

// The header of a line: vanilla and Fabric write "[12:00:00] [Server thread/INFO]: " (Fabric and
// mods add a source, "(Minecraft)" or "[minecraft/MinecraftServer]"), Paper "[12:00:00 INFO]: ".
const HEADER = /^\[\d{2}:\d{2}:\d{2}(?: INFO\]|\] \[[^\]/]+\/INFO\](?: \([^)]*\)| \[[^\]]*\])?):? /;
const NAME = '[A-Za-z0-9_.-]{1,32}';
// Servers without chat signing mark the messages: "[Not Secure] <Steve> hello".
const CHAT = new RegExp(`^(?:\\[Not Secure\\] )?<(${NAME})> (.*)$`);
const JOINED = new RegExp(`^(${NAME}) joined the game$`);
const LEFT = new RegExp(`^(${NAME}) left the game$`);

/**
 * Reads a line of the log; null for anything but chat messages and joins and leaves. A chat
 * message always starts with the name of its author in `<>`, so what a player types cannot pass
 * for the line of a join.
 */
export function parseLogLine(line: string): GameLogEvent | null {
  const header = HEADER.exec(line);
  if (header === null) return null;
  const text = line.slice(header[0].length).trimEnd();
  const chat = CHAT.exec(text);
  if (chat !== null) return { type: 'chat', player: chat[1] ?? '', message: chat[2] ?? '' };
  const joined = JOINED.exec(text);
  if (joined !== null) return { type: 'joined', player: joined[1] ?? '' };
  const left = LEFT.exec(text);
  if (left !== null) return { type: 'left', player: left[1] ?? '' };
  return null;
}
