/** Removes Minecraft formatting codes (`§` followed by one character). */
export function stripFormatting(text: string): string {
  return text.replace(/§./gs, '');
}

export interface PlayerList {
  online: number;
  max: number;
  names: string[];
}

// Vanilla: "There are 2 of a max of 20 players online: Steve, Alex"
// Before 1.13: "There are 2/20 players online:" and the names on the next line
// Paper: "There are 2 out of maximum 20 players online."
const LIST_PATTERN =
  /There are (\d+)\s*(?:of a max(?:imum)?(?: of)?|out of maximum|\/)\s*(\d+) players online[.:]?\s*(.*)$/s;

/** Parses the reply of the `list` command; null when the format is unknown. */
export function parsePlayerList(reply: string): PlayerList | null {
  const match = LIST_PATTERN.exec(stripFormatting(reply).trim());
  if (match === null) return null;
  const names = (match[3] ?? '')
    .split(/[,\n]/)
    // Paper can list players by group: "default: Steve, Alex".
    .map((name) => name.replace(/^[^:]*:\s*/, '').trim())
    .filter((name) => /^[\w.-]{1,32}$/.test(name));
  return { online: Number(match[1]), max: Number(match[2]), names };
}
