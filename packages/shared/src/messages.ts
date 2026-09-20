import { utf8 } from './md5.js';

// Chat messages to players: `&` color codes, `tellraw` commands and message templates.

const COLORS: Record<string, { name: string; hex: string }> = {
  '0': { name: 'black', hex: '#000000' },
  '1': { name: 'dark_blue', hex: '#0000aa' },
  '2': { name: 'dark_green', hex: '#00aa00' },
  '3': { name: 'dark_aqua', hex: '#00aaaa' },
  '4': { name: 'dark_red', hex: '#aa0000' },
  '5': { name: 'dark_purple', hex: '#aa00aa' },
  '6': { name: 'gold', hex: '#ffaa00' },
  '7': { name: 'gray', hex: '#aaaaaa' },
  '8': { name: 'dark_gray', hex: '#555555' },
  '9': { name: 'blue', hex: '#5555ff' },
  a: { name: 'green', hex: '#55ff55' },
  b: { name: 'aqua', hex: '#55ffff' },
  c: { name: 'red', hex: '#ff5555' },
  d: { name: 'light_purple', hex: '#ff55ff' },
  e: { name: 'yellow', hex: '#ffff55' },
  f: { name: 'white', hex: '#ffffff' },
};
const FORMATS = 'lonmr';

/** A piece of a message with the formatting of its `&` codes. */
export interface MessagePart {
  text: string;
  /** The Minecraft color name and the color for the web. */
  color?: { name: string; hex: string };
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
}

/**
 * Splits a message at `&` codes the way Minecraft renders `§` codes: `&0`–`&f` colors (a color
 * also ends the other formats), `&l` bold, `&o` italic, `&n` underlined, `&m` strikethrough and
 * `&r` reset. Any other `&` is kept as text.
 */
export function parseMessage(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let style: Omit<MessagePart, 'text'> = {};
  let current = '';
  const flush = () => {
    if (current !== '') parts.push({ ...style, text: current });
    current = '';
  };
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    const code = text.charAt(index + 1).toLowerCase();
    const color = COLORS[code];
    if (char !== '&' || code === '' || (color === undefined && !FORMATS.includes(code))) {
      current += char;
      continue;
    }
    index++;
    flush();
    if (color !== undefined) style = { color };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'n') style = { ...style, underlined: true };
    else if (code === 'm') style = { ...style, strikethrough: true };
    else style = {};
  }
  flush();
  return parts;
}

/**
 * The `tellraw` command that shows a message to the players `target` selects (`@a`, or the name
 * of one player). The text is JSON-encoded and line breaks become spaces.
 */
export function tellrawCommand(target: string, message: string): string {
  const components = parseMessage(message.replace(/[\r\n]+/g, ' ')).map(
    ({ text, color, ...formats }) => ({ text, ...(color && { color: color.name }), ...formats }),
  );
  // The first element of a text array passes its style on to the others, so it stays empty.
  return `tellraw ${target} ${JSON.stringify(['', ...components])}`;
}

const byteLength = (text: string) => utf8(text).length;

/**
 * The `tellraw` commands that show several lines to the players `target` selects, as few as fit
 * into `maxBytes` each: lines that fit together go into one command, so a message of several lines
 * costs the server one command, not one per line. Throws a RangeError for a line that does not fit
 * a command alone.
 */
export function tellrawLines(target: string, lines: readonly string[], maxBytes: number): string[] {
  const componentsOf = (line: string) =>
    parseMessage(line.replace(/[\r\n]+/g, ' ')).map(({ text, color, ...formats }) => ({
      text,
      ...(color && { color: color.name }),
      ...formats,
    }));
  const commandOf = (parts: readonly object[]) =>
    `tellraw ${target} ${JSON.stringify(['', ...parts])}`;
  const commands: string[] = [];
  let current: object[] = [];
  for (const line of lines) {
    const parts = componentsOf(line);
    if (byteLength(commandOf(parts)) > maxBytes) throw new RangeError('A line is too long');
    const joined = current.length === 0 ? parts : [...current, { text: '\n' }, ...parts];
    if (current.length > 0 && byteLength(commandOf(joined)) > maxBytes) {
      commands.push(commandOf(current));
      current = parts;
    } else {
      current = joined;
    }
  }
  if (current.length > 0) commands.push(commandOf(current));
  return commands;
}

/** The `tellraw` command that shows an announcement to all players. */
export function announcementCommand(message: string): string {
  return tellrawCommand('@a', message);
}

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

/** The names of the `{placeholders}` a template uses, each once, in order of appearance. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ''))];
}

/**
 * Replaces the `{placeholders}` of a template with their values. A placeholder without a value
 * stays as it is, so that a typo is visible in the preview. A value is inserted as it is: `&`
 * codes in a value work like those of the template.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}
