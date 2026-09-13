import { z } from 'zod';

// Replies of Minecraft Java to RCON commands, as of version 26.x (older formats where known).
// Over RCON Minecraft joins the lines of a reply without line breaks.

/** Removes formatting codes (`§` followed by one character). */
export function stripFormatting(text: string): string {
  return text.replace(/§./gs, '');
}

/** Player names: vanilla allows 3–16 letters, digits and `_`; offline servers are laxer. */
export const PLAYER_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,16}$/;
export const playerNameSchema = z.string().trim().regex(PLAYER_NAME_PATTERN);
export const ipAddressSchema = z.union([z.ipv4(), z.ipv6()]);

export interface OnlinePlayer {
  name: string;
  /** Lowercase; null when the server did not send UUIDs (plain `list`). */
  uuid: string | null;
}

export interface PlayerList {
  online: number;
  max: number;
  players: OnlinePlayer[];
  names: string[];
}

// Vanilla: "There are 2 of a max of 20 players online: Steve (uuid), Alex (uuid)"
// Before 1.13: "There are 2/20 players online:" and the names on the next line
// Paper: "There are 2 out of maximum 20 players online."
const LIST_PATTERN =
  /There are (\d+)\s*(?:of a max(?:imum)?(?: of)?|out of maximum|\/)\s*(\d+) players online[.:]?\s*(.*)$/s;
const LIST_ENTRY = /^([A-Za-z0-9_.-]{1,32})(?:\s*\(([0-9a-fA-F-]{36})\))?$/;

/** Parses the reply of `list` or `list uuids`; null when the format is unknown. */
export function parsePlayerList(reply: string): PlayerList | null {
  const match = LIST_PATTERN.exec(stripFormatting(reply).trim());
  if (match === null) return null;
  const players = (match[3] ?? '')
    .split(/[,\n]/)
    // Paper can list players by group: "default: Steve, Alex".
    .map((entry) => LIST_ENTRY.exec(entry.replace(/^[^:()]*:\s*/, '').trim()))
    .filter((entry) => entry !== null)
    .map((entry) => ({ name: entry[1] ?? '', uuid: entry[2]?.toLowerCase() ?? null }));
  return {
    online: Number(match[1]),
    max: Number(match[2]),
    players,
    names: players.map((player) => player.name),
  };
}

/** Parses `whitelist list`; null when the format is unknown. */
export function parseWhitelist(reply: string): string[] | null {
  const text = stripFormatting(reply).trim();
  if (/^There are no whitelisted players/.test(text)) return [];
  const match = /^There (?:are|is) \d+ whitelisted players?(?:\(s\))?:\s*(.*)$/s.exec(text);
  if (match === null) return null;
  return (match[1] ?? '')
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

export interface BanEntry {
  /** Player name or IP address. */
  target: string;
  /** Who banned: a player name, `Rcon`, `Server`, … */
  source: string;
  reason: string;
}

const BAN_MARKER = ' was banned by ';
const IPV4_SUFFIX =
  /((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|[0-9a-fA-F]*:[0-9a-fA-F:]+)$/;

/**
 * Parses `banlist players` or `banlist ips`; null when the format is unknown. The entries arrive
 * joined without separators ("…reason.Notch was banned by Rcon: …"), so they are split at
 * "<target> was banned by". Where a reason ends with letters or digits the start of the next
 * name is ambiguous: `known` names (players seen before) settle it.
 */
export function parseBanList(
  reply: string,
  kind: 'players' | 'ips',
  known: readonly string[] = [],
): BanEntry[] | null {
  const text = stripFormatting(reply).replace(/\r?\n/g, '').trim();
  if (/^There are no bans/.test(text)) return [];
  const header = /^There (?:are|is) \d+ bans?(?:\(s\))?:/.exec(text);
  if (header === null) return null;
  const body = text.slice(header[0].length);

  const ends: number[] = [];
  for (let at = body.indexOf(BAN_MARKER); at !== -1; at = body.indexOf(BAN_MARKER, at + 1)) {
    ends.push(at);
  }
  const starts = ends.map((end, index) => {
    if (index === 0) return 0;
    const before = body.slice((ends[index - 1] ?? 0) + BAN_MARKER.length, end);
    return end - targetLength(before, kind, known);
  });
  return ends.map((end, index) => {
    const next = starts[index + 1] ?? body.length;
    const rest = body.slice(end + BAN_MARKER.length, next);
    const colon = rest.indexOf(': ');
    return {
      target: body.slice(starts[index] ?? 0, end),
      source: colon === -1 ? rest : rest.slice(0, colon),
      reason: colon === -1 ? '' : rest.slice(colon + 2),
    };
  });
}

/** Length of the target at the end of `text` (the previous entry's source and reason come first). */
function targetLength(text: string, kind: 'players' | 'ips', known: readonly string[]): number {
  if (kind === 'ips') return IPV4_SUFFIX.exec(text)?.[1]?.length ?? 0;
  const lower = text.toLowerCase();
  const knownName = known
    .filter((name) => lower.endsWith(name.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (knownName !== undefined) return knownName.length;
  return /[A-Za-z0-9_]{1,16}$/.exec(text)?.[0].length ?? 0;
}

/**
 * A ban reason as one line that ends with a punctuation mark, so that the next entry of a ban
 * list can be told apart from it.
 */
export function normalizeReason(reason: string | undefined): string {
  const text = (reason ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (text === '') return '';
  return /[\p{L}\p{N}]$/u.test(text) ? `${text}.` : text;
}

/** `offline` for name-based (version 3) UUIDs, `online` for Mojang (version 4) UUIDs. */
export function uuidMode(uuid: string): 'online' | 'offline' | null {
  const version = uuid.replace(/-/g, '').charAt(12);
  return version === '3' ? 'offline' : version === '4' ? 'online' : null;
}
