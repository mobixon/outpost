/** A piece of text with Minecraft formatting (`§` codes) applied. */
export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

const COLORS: Readonly<Record<string, string>> = {
  '0': '#000000',
  '1': '#0000aa',
  '2': '#00aa00',
  '3': '#00aaaa',
  '4': '#aa0000',
  '5': '#aa00aa',
  '6': '#ffaa00',
  '7': '#aaaaaa',
  '8': '#555555',
  '9': '#5555ff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: '#ffffff',
};

/** Splits text at `§` codes into styled segments, the way Minecraft renders them. */
export function parseFormatting(text: string): Segment[] {
  const segments: Segment[] = [];
  let style: Omit<Segment, 'text'> = {};
  let current = '';
  const flush = () => {
    if (current !== '') segments.push({ ...style, text: current });
    current = '';
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const code = text[index + 1]?.toLowerCase();
    if (char !== '§' || code === undefined) {
      current += char;
      continue;
    }
    index++;
    flush();
    const color = COLORS[code];
    // A color code also ends bold, italic and the other formats.
    if (color !== undefined) style = { color };
    else if (code === 'l') style = { ...style, bold: true };
    else if (code === 'o') style = { ...style, italic: true };
    else if (code === 'n') style = { ...style, underline: true };
    else if (code === 'm') style = { ...style, strikethrough: true };
    else if (code === 'r') style = {};
    // §k (obfuscated) and unknown codes are dropped.
  }
  flush();
  return segments;
}
