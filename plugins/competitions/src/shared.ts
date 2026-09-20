import { PLAYER_NAME_PATTERN, normalizeUuid, templatePlaceholders } from '@outpost/shared';
import { z } from 'zod';

export * from './constants.js';

/** The most places a competition rewards. */
export const MAX_TOP = 10;
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_TEMPLATE_LENGTH = 600;
export const MAX_COMMANDS_PER_PLACE = 10;
export const MAX_COMMAND_LENGTH = 400;
export const MAX_EXCLUDED = 100;
export const MAX_BLOCKS = 50;
export const MAX_DURATION_DAYS = 366;
/** Chat lines a message may have once its placeholders are filled in. */
export const MAX_MESSAGE_LINES = 16;
export const MAX_ANNOUNCEMENTS = 10;
/** The longest a message can be sent before its moment (a week), in minutes. */
export const MAX_ANNOUNCEMENT_MINUTES = 7 * 24 * 60;
export const MIN_COUNT_MINUTES = 1;
export const MAX_COUNT_MINUTES = 60;
export const DEFAULT_COUNT_MINUTES = 5;

export const EVENT_STATES = ['scheduled', 'active', 'finishing', 'finished', 'cancelled'] as const;
export type EventState = (typeof EVENT_STATES)[number];

// --- What is counted -------------------------------------------------------------------------

/** Groups of blocks to pick from; the ids may use `*` for any part of a name. */
export const BLOCK_PRESETS = {
  wood: [
    'minecraft:*_log',
    'minecraft:*_wood',
    'minecraft:crimson_stem',
    'minecraft:warped_stem',
    'minecraft:stripped_crimson_stem',
    'minecraft:stripped_warped_stem',
    'minecraft:crimson_hyphae',
    'minecraft:warped_hyphae',
    'minecraft:stripped_crimson_hyphae',
    'minecraft:stripped_warped_hyphae',
  ],
  stone: [
    'minecraft:stone',
    'minecraft:cobblestone',
    'minecraft:deepslate',
    'minecraft:cobbled_deepslate',
    'minecraft:granite',
    'minecraft:diorite',
    'minecraft:andesite',
    'minecraft:tuff',
  ],
  ores: ['minecraft:*_ore', 'minecraft:ancient_debris'],
  earth: [
    'minecraft:dirt',
    'minecraft:grass_block',
    'minecraft:coarse_dirt',
    'minecraft:podzol',
    'minecraft:mycelium',
    'minecraft:rooted_dirt',
    'minecraft:mud',
  ],
} as const satisfies Record<string, readonly string[]>;
export const BLOCK_PRESET_IDS = Object.keys(BLOCK_PRESETS) as [BlockPreset, ...BlockPreset[]];
export type BlockPreset = keyof typeof BLOCK_PRESETS;

const BLOCK_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./*-]+$/;

/** A block id or pattern as the counters spell it: lowercase, with the `minecraft:` namespace. */
export function normalizeBlockPattern(text: string): string {
  const pattern = text.trim().toLowerCase();
  return pattern.includes(':') || pattern === '' ? pattern : `minecraft:${pattern}`;
}

export const isValidBlockPattern = (text: string) =>
  BLOCK_PATTERN.test(normalizeBlockPattern(text));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test for block ids from patterns, in which `*` stands for any part of a name. */
export function blockMatcher(patterns: readonly string[]): (id: string) => boolean {
  const expressions = patterns.map(
    (pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[a-z0-9_./-]*')}$`),
  );
  return (id) => expressions.some((expression) => expression.test(id));
}

const minedMetricSchema = z.object({
  kind: z.literal('mined'),
  presets: z.array(z.enum(BLOCK_PRESET_IDS)).max(BLOCK_PRESET_IDS.length),
  blocks: z
    .array(
      z
        .string()
        .trim()
        .max(100)
        .refine(isValidBlockPattern, { error: 'Use ids like minecraft:oak_log or *_log' }),
    )
    .max(MAX_BLOCKS),
});
/** Fishing catches, as the game counts them (`custom: fish_caught`). */
const fishCaughtMetricSchema = z.object({ kind: z.literal('fish_caught') });

/** What is counted; more kinds can join this list. */
export const metricSchema = z.discriminatedUnion('kind', [
  minedMetricSchema,
  fishCaughtMetricSchema,
]);
export type Metric = z.infer<typeof metricSchema>;
export const METRIC_KINDS = ['mined', 'fish_caught'] as const satisfies readonly Metric['kind'][];

/** The block patterns of a metric that counts blocks; none for the others. */
export function metricPatterns(metric: Metric): string[] {
  if (metric.kind !== 'mined') return [];
  return [
    ...new Set([
      ...metric.presets.flatMap((preset) => BLOCK_PRESETS[preset]),
      ...metric.blocks.map(normalizeBlockPattern),
    ]),
  ];
}

/** Whether a metric says what it counts: a metric of blocks needs at least one. */
export const metricIsComplete = (metric: Metric) =>
  metric.kind !== 'mined' || metricPatterns(metric).length > 0;

/** How a counter becomes a score; more kinds can join this list. */
export const scoringSchema = z.discriminatedUnion('kind', [
  /** What the counter grew by from the start to the end of the competition. */
  z.object({ kind: z.literal('sum') }),
]);
export type Scoring = z.infer<typeof scoringSchema>;

// --- Who takes part and what they win -------------------------------------------------------

export const playerRefSchema = z.object({
  uuid: z.string().transform((value, context) => {
    const uuid = normalizeUuid(value);
    if (uuid === null) context.addIssue({ code: 'custom', message: 'Not a UUID' });
    return uuid ?? value;
  }),
  name: z.string().trim().min(1).max(32),
});
export type PlayerRef = z.infer<typeof playerRefSchema>;

export const participantsSchema = z.object({
  /** How many places count. */
  top: z.number().int().min(1).max(MAX_TOP),
  excludeOperators: z.boolean(),
  excluded: z.array(playerRefSchema).max(MAX_EXCLUDED),
});
export type Participants = z.infer<typeof participantsSchema>;

const commandSchema = z.string().trim().min(1).max(MAX_COMMAND_LENGTH);

export const rewardsSchema = z.object({
  places: z
    .array(
      z.object({
        place: z.number().int().min(1).max(MAX_TOP),
        /** Console commands with `{placeholders}`, run when the winner is online. */
        commands: z.array(commandSchema).min(1).max(MAX_COMMANDS_PER_PLACE),
      }),
    )
    .max(MAX_TOP),
});
export type Rewards = z.infer<typeof rewardsSchema>;

/** The rewards as people without the right to manage the competition see them: no commands. */
export const rewardsViewSchema = z.object({
  places: z.array(z.object({ place: z.number().int(), commands: z.array(z.string()) })),
});

// --- What players read ----------------------------------------------------------------------

/** The placeholders each text of a competition may use. */
export const PLACEHOLDERS = {
  top: [
    'command',
    'event',
    'description',
    'metric',
    'ends_at',
    'ends_in',
    'top',
    'player',
    'your_place',
    'your_score',
  ],
  join: [
    'command',
    'event',
    'description',
    'metric',
    'ends_at',
    'ends_in',
    'top',
    'player',
    'your_place',
    'your_score',
  ],
  results: ['event', 'description', 'metric', 'top'],
  reward: ['event', 'player', 'place', 'score'],
  entry: ['place', 'name', 'score'],
  command: ['player', 'uuid', 'place', 'score', 'event'],
  announce: [
    'command',
    'event',
    'description',
    'metric',
    'starts_at',
    'starts_in',
    'ends_at',
    'ends_in',
    'top',
  ],
} as const;
export type TemplateKind = keyof typeof PLACEHOLDERS;

const template = (kind: TemplateKind, minimum = 1) =>
  z
    .string()
    .max(MAX_TEMPLATE_LENGTH)
    .refine((text) => text.trim().length >= minimum, { error: 'Write something' })
    .superRefine((text, context) => {
      const allowed: readonly string[] = PLACEHOLDERS[kind];
      const unknown = templatePlaceholders(text).filter((name) => !allowed.includes(name));
      if (unknown.length > 0) {
        context.addIssue({
          code: 'custom',
          message: `Unknown placeholders: ${unknown.map((name) => `{${name}}`).join(', ')}`,
        });
      }
    });

export const messagesSchema = z.object({
  /** What a player types in the chat to see the standings, e.g. `!top`. */
  command: z
    .string()
    .trim()
    .regex(/^[!#.$%-][A-Za-z0-9_-]{1,30}$/, { error: 'Start with ! and use letters or digits' }),
  /** Free text about the competition, which the other texts show as `{description}`. */
  description: z.string().max(MAX_DESCRIPTION_LENGTH),
  /** The answer to the chat command; `{top}` is one line per place, made from `entry`. */
  top: template('top'),
  entry: template('entry'),
  /** Shown to a player who joins while the competition is on. */
  joinNotice: z.boolean(),
  join: template('join', 0),
  /** Told to everyone at the end. */
  announceResults: z.boolean(),
  results: template('results', 0),
  /** Told to a winner when the reward is given. */
  reward: template('reward', 0),
});
export type Messages = z.infer<typeof messagesSchema>;

/** A message the event sends to everyone by itself, at a time relative to its start or end. */
export const announcementSchema = z.object({
  anchor: z.enum(['start', 'end']),
  /** How many minutes before the start or the end; 0 is at that moment. */
  minutesBefore: z.number().int().min(0).max(MAX_ANNOUNCEMENT_MINUTES),
  text: template('announce'),
});
export type Announcement = z.infer<typeof announcementSchema>;

/** The key of an announcement in what has been sent: two of them never share a moment. */
export const announcementKey = (announcement: Pick<Announcement, 'anchor' | 'minutesBefore'>) =>
  `${announcement.anchor}:${announcement.minutesBefore}`;

export function defaultAnnouncements(): Announcement[] {
  return [
    {
      anchor: 'start',
      minutesBefore: 10,
      text: '&6&l{event}&r &7starts in &f{starts_in}&7! {description}',
    },
    {
      anchor: 'start',
      minutesBefore: 1,
      text: '&6&l{event}&r &7starts in &f{starts_in}&7. Get ready!',
    },
    {
      anchor: 'start',
      minutesBefore: 0,
      text: '&6&l{event}&r &7is on! It ends in &f{ends_in}&7. Type &f{command}&7 for the standings.',
    },
  ];
}

export function defaultMessages(): Messages {
  return {
    command: '!top',
    description: '',
    top: [
      '&6&l{event}&r &7- {metric}',
      '{description}',
      '{top}',
      '&7Your place: &f{your_place} &7({your_score}) &8| &7ends in &f{ends_in}',
    ].join('\n'),
    entry: '&e{place}. &f{name} &7- &a{score}',
    joinNotice: true,
    join: [
      '&6&l{event}&r &7ends in &f{ends_in}',
      '{description}',
      '&7Your place: &f{your_place} &7({your_score}). Type &f{command} &7for the standings.',
    ].join('\n'),
    announceResults: true,
    results: ['&6&l{event}&r &7is over! The winners:', '{top}'].join('\n'),
    reward: '&6[{event}] &aYou took place {place} with {score} - your reward is here!',
  };
}

// --- The competition ------------------------------------------------------------------------

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, { error: 'Unknown time zone' });

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const eventFields = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .regex(/^[^\r\n]+$/, { error: 'One line' }),
  /** Only for showing times; the start and the end are instants. */
  timezone: timezoneSchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  metric: metricSchema,
  scoring: scoringSchema,
  participants: participantsSchema,
  rewards: rewardsSchema,
  messages: messagesSchema,
  /** How often the standings of a running event are counted, in minutes. */
  countEveryMinutes: z
    .number()
    .int()
    .min(MIN_COUNT_MINUTES)
    .max(MAX_COUNT_MINUTES)
    .default(DEFAULT_COUNT_MINUTES),
  announcements: z.array(announcementSchema).max(MAX_ANNOUNCEMENTS).default([]),
});

/** What is stored of a competition besides its name and times. */
export const eventConfigSchema = eventFields.pick({
  metric: true,
  scoring: true,
  participants: true,
  rewards: true,
  messages: true,
  countEveryMinutes: true,
  announcements: true,
});
export type EventConfig = z.output<typeof eventConfigSchema>;

export const eventInputSchema = eventFields.superRefine((event, context) => {
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (end <= start) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'The end must be after the start',
    });
  } else if (end - start > MAX_DURATION_DAYS * 24 * 60 * 60_000) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: `A competition lasts at most ${MAX_DURATION_DAYS} days`,
    });
  }
  if (!metricIsComplete(event.metric)) {
    context.addIssue({ code: 'custom', path: ['metric'], message: 'Pick what is counted' });
  }
  const moments = new Set<string>();
  event.announcements.forEach((announcement, index) => {
    const key = announcementKey(announcement);
    if (moments.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['announcements', index, 'minutesBefore'],
        message: 'Two messages cannot go out at the same moment',
      });
    }
    moments.add(key);
  });
  const places = new Set<number>();
  event.rewards.places.forEach((reward, index) => {
    if (reward.place > event.participants.top || places.has(reward.place)) {
      context.addIssue({
        code: 'custom',
        path: ['rewards', 'places', index, 'place'],
        message: 'Every place of the top can have one reward',
      });
    }
    places.add(reward.place);
    reward.commands.forEach((command, at) => {
      const allowed: readonly string[] = PLACEHOLDERS.command;
      const unknown = templatePlaceholders(command).filter((name) => !allowed.includes(name));
      if (unknown.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['rewards', 'places', index, 'commands', at],
          message: `Unknown placeholders: ${unknown.map((name) => `{${name}}`).join(', ')}`,
        });
      }
    });
  });
});
export type EventInput = z.input<typeof eventInputSchema>;
export type EventFields = z.output<typeof eventInputSchema>;

export const standingSchema = z.object({
  place: z.number().int(),
  uuid: z.string(),
  name: z.string(),
  score: z.number(),
});
export type Standing = z.infer<typeof standingSchema>;

export const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  state: z.enum(EVENT_STATES),
  startsAt: z.string(),
  endsAt: z.string(),
  metric: metricSchema,
  scoring: scoringSchema,
  participants: participantsSchema,
  rewards: rewardsViewSchema,
  messages: messagesSchema,
  countEveryMinutes: z.number().int(),
  announcements: z.array(announcementSchema),
  /** When the counters at the start were taken; later than `startsAt` when Outpost was late. */
  baselineAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** Why the competition cannot go on, e.g. the statistics cannot be read. */
  problem: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CompetitionEvent = z.infer<typeof eventSchema>;

export const eventListSchema = z.object({ events: z.array(eventSchema) });

export const rewardStatusSchema = z.object({
  id: z.string(),
  place: z.number().int(),
  /** The position of the command among those of the place. */
  index: z.number().int(),
  playerUuid: z.string(),
  playerName: z.string(),
  command: z.string(),
  status: z.enum(['pending', 'done', 'failed', 'cancelled']),
  attempts: z.number().int(),
  error: z.string().nullable(),
  updatedAt: z.string(),
});
export type RewardStatus = z.infer<typeof rewardStatusSchema>;

export const eventDetailSchema = z.object({
  event: eventSchema,
  /** The top, from the last count (`countedAt`); frozen once the competition is over. */
  standings: z.array(standingSchema),
  countedAt: z.string().nullable(),
  rewards: z.array(rewardStatusSchema),
  /** What the server can do, so that the page can say what will not work. */
  capabilities: z.object({
    stats: z.boolean(),
    chat: z.boolean(),
    events: z.boolean(),
    tasks: z.boolean(),
  }),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

export const candidateListSchema = z.object({
  players: z.array(z.object({ uuid: z.string(), name: z.string(), operator: z.boolean() })),
});
export type CandidateList = z.infer<typeof candidateListSchema>;

export const isPlayerName = (name: string) => PLAYER_NAME_PATTERN.test(name);

export const rewardTestInputSchema = z.object({
  /** A player who is online; the commands run for them. */
  player: z.string().trim().regex(PLAYER_NAME_PATTERN),
  eventName: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  place: z.number().int().min(1).max(MAX_TOP),
  commands: z.array(commandSchema).min(1).max(MAX_COMMANDS_PER_PLACE),
});
export type RewardTestInput = z.input<typeof rewardTestInputSchema>;

export const rewardTestResultSchema = z.object({
  results: z.array(
    z.object({
      command: z.string(),
      /** What the server answered. */
      reply: z.string(),
      ok: z.boolean(),
    }),
  ),
});
export type RewardTestResult = z.infer<typeof rewardTestResultSchema>;
