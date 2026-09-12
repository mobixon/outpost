/** Commands of vanilla Minecraft Java, for completing the first word in the console. */
export const VANILLA_COMMANDS: readonly string[] = [
  'advancement',
  'attribute',
  'ban',
  'ban-ip',
  'banlist',
  'bossbar',
  'clear',
  'clone',
  'damage',
  'data',
  'datapack',
  'debug',
  'defaultgamemode',
  'deop',
  'difficulty',
  'effect',
  'enchant',
  'execute',
  'experience',
  'fill',
  'fillbiome',
  'forceload',
  'function',
  'gamemode',
  'gamerule',
  'give',
  'help',
  'item',
  'kick',
  'kill',
  'list',
  'locate',
  'loot',
  'me',
  'msg',
  'op',
  'pardon',
  'pardon-ip',
  'particle',
  'place',
  'playsound',
  'random',
  'recipe',
  'reload',
  'ride',
  'save-all',
  'save-off',
  'save-on',
  'say',
  'schedule',
  'scoreboard',
  'seed',
  'setblock',
  'setidletimeout',
  'setworldspawn',
  'spawnpoint',
  'spectate',
  'spreadplayers',
  'stop',
  'stopsound',
  'summon',
  'tag',
  'team',
  'teammsg',
  'teleport',
  'tell',
  'tellraw',
  'tick',
  'time',
  'title',
  'tp',
  'transfer',
  'trigger',
  'weather',
  'whitelist',
  'worldborder',
  'xp',
];

/**
 * Completes the command name (the first word): the longest common beginning of the matching
 * names, with a space after a single match, plus the matches to show.
 */
export function complete(input: string): { value: string; matches: string[] } {
  const text = input.replace(/^\//, '');
  if (text.includes(' ')) return { value: input, matches: [] };
  const matches = VANILLA_COMMANDS.filter((name) => name.startsWith(text.toLowerCase()));
  if (matches.length === 0) return { value: input, matches };
  if (matches.length === 1) return { value: `${matches[0]} `, matches };
  let prefix = matches[0] ?? '';
  for (const name of matches) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return { value: prefix.length > text.length ? prefix : text, matches };
}
