# Servers, roles and permissions

Every game server managed by Outpost has its own team. People see only the servers they are
members of, and on each server they can do what their role allows.

## Servers

Superadmins add servers on the home page with a game, a name and a short name, which appears in
the addresses of the web UI (`/servers/<short name>`), and connect them under **Settings**.

Every server is of one **game**, chosen when it is added. It cannot be changed, because everything
else depends on it: the game decides the defaults of the connectors, the connectors decide the
capabilities of the server, and the capabilities and the game decide which modules it has. Modules
declare the games they support; this version knows Minecraft: Java Edition, and all its modules
are for Minecraft.

Owners rename a server and delete it under **Settings**. Deleting removes the server from Outpost
with its members and invitations; the game server itself is not touched, and the audit log keeps
its entries.

## Modules of a server

Every module is on for every server until an owner switches it off under **Settings → Modules**
(superadmins can too). A module that is off does not show its tab, does not answer its routes
(`409 module_disabled`) and, above all, is not asked to look at the game server: the Players module
stops asking who is online every 15 seconds, the Scheduler runs nothing, an event of the Events
module waits as it is and stops following the log, and the rewards and tasks of the module wait for
it. Its data is kept, and it all goes on when the module is switched on again, so an event whose
time passed meanwhile starts or ends only then. The **essential** modules, now the Console, cannot be
switched off. Switching a module on or off is written to the audit log
(`server.module_enabled`, `server.module_disabled`).

To have a module off on every server, leave it out of `OUTPOST_PLUGINS` (see
[configuration](configuration.md)).

## Connecting a server

A server is connected through **connectors**, which superadmins set up under **Settings**. Each
connector is tested and saved on its own and adds **capabilities** to the server. Modules use the
capabilities and do not care which connector provides them.

| Connector | Capabilities                               | Needs                                                                  |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| RCON      | `commands.send`                            | the RCON port of the game server, reachable by Outpost                 |
| Files     | `files.read`, `files.write`, `logs.stream` | the data folder of the game server: mounted into Outpost, or over SFTP |

### RCON

**RCON** is the remote console of Minecraft.

1. RCON must be on (`enable-rcon=true` in `server.properties`; the `itzg/minecraft-server` image
   turns it on by default) and reachable from Outpost. Put both containers into one Docker network
   and use the container or service name as the host (CapRover: `srv-captain--<app>`). Never publish
   the RCON port to the internet: RCON is not encrypted.
2. The password is `rcon.password` in `server.properties`; with `itzg/minecraft-server` it is
   `RCON_PASSWORD`, or the generated `password=` line in `.rcon-cli.env` in the data directory.
3. **Test** connects, logs in and runs `list`, and shows which step fails. **Save** stores the
   connection; the password is encrypted with `OUTPOST_SECRET_KEY` and never shown again.

### Files

The **Files** connector gives modules the files of the server: `server.properties`, the whitelist,
the logs, the world. It has two sources:

- **Folder**: the data folder of the game server, mounted into the Outpost container below
  `OUTPOST_FILES_ROOT` (`/servers` by default), for game servers next to Outpost;
- **SFTP**: for game servers elsewhere, for example at a game host that offers SFTP.

With either source, **Save** runs the same test as **Test** and keeps the connector only if it
passes, and modules may **write** files only when writing is on.

**Folder**

1. Mount the data folder of the game server into Outpost, for example at `/servers/survival` (see
   [file access](install.md#file-access)).
2. Enter the folder (`survival`) and choose whether modules may write files.
3. **Test** checks that the folder exists and holds `server.properties` and, with writing on, that
   Outpost can write there as the owner of the files: Outpost replaces files atomically, which makes
   the writer their owner, so it refuses to write as another user (UID). `itzg/minecraft-server` and
   Outpost both use UID 1000.

**SFTP**

1. Enter the host, the port (22), the username, the password or a private key (OpenSSH or PEM
   format, with its passphrase if it has one) and the folder of the game server on the SFTP server,
   for example `/` or `/minecraft`. Passwords and keys are encrypted with `OUTPOST_SECRET_KEY` and
   never shown again.
2. **Test** connects and shows the fingerprint of the **host key** (`SHA256:…`), logs in, and checks
   the folder, `server.properties` and, with writing on, that new files get the owner of the files
   of the server. Compare the fingerprint with the one your host shows.
3. **Save** pins the host key: Outpost refuses to connect when the server presents another key
   later. If your host really changed its key, test again and save to pin the new key.

Writes go to a temporary file that replaces the target, atomically where the server supports
`posix-rename@openssh.com`, as OpenSSH does. Modules share one SFTP session per server, which is
closed after a minute without use.

Paths cannot leave the folder: absolute paths, `..` and symbolic links that lead outside are
refused.

For games that write a log (`logs/latest.log` for Minecraft), the Files connector also gives
`logs.stream`: Outpost follows the log while somebody watches it — a mounted folder every second,
SFTP every two seconds — keeps its last 1000 lines and starts over when the server begins a new
log. The **Console** shows it live, and **Players** keeps the whitelist in `whitelist.json` (see
[the whitelist](#whitelist)). The settings editor will build on the files next.

Modules use only the files they declare: Players, for example, reads `server.properties` and
writes `whitelist.json`, and Outpost refuses it any other path.

### What modules get on top of the connectors

Some capabilities need a connector and a game that Outpost knows how to serve; for Minecraft they
come with the connectors:

| Capability           | Needs | What it gives modules                                              |
| -------------------- | ----- | ------------------------------------------------------------------ |
| `game.events`        | Files | chat messages, joins and leaves of players, read from the live log |
| `stats.read`         | Files | the statistics of the players from the world                       |
| `chat.tell`          | RCON  | messages to one player or to everyone, with `&` colors             |
| `players.whenOnline` | RCON  | things to do when a player is online, which wait through restarts  |

### Who connects

Only superadmins change connectors, because a connector points Outpost at a host or a folder of its
environment. Once RCON is connected, **Overview** shows whether the server answers and who is online, and the
**Console** tab runs commands (owners and admins) and sends chat messages (also moderators). Every
command and message is written to the audit log. With the Files connector the Console also shows
the **live log** of the server, to owners, admins and moderators (`console.read`): viewers do not
see it, because it contains the chat and the IP addresses of the players. The browser follows it
over server-sent events and gets the lines it missed when it reconnects. The commands a user runs
are kept in their **command history** for that server — the last 100, in the database, so it
follows the user to every browser: the history button lists them (narrowed to what is typed) and
puts the chosen one into the command line, and the arrow keys go through them.

Limitations of the RCON connection:

- without the Files connector the console shows the replies to commands, not the live server log;
- on offline-mode servers, `whitelist add` for a player who has never joined stores the wrong
  (online) UUID, because Minecraft looks up unknown names at Mojang. Let such players join once with
  the whitelist off, or connect the Files connector with writing on: then Outpost writes the
  whitelist itself (see [the whitelist](#whitelist)).

## Players

The **Players** tab shows who is online and manages the whitelist, bans (of players and IP
addresses), kicks and operator rights. It needs RCON or the Files connector; with the files alone
it shows and changes only the whitelist.

- Outpost asks every connected server who is online (`list uuids`) every 15 seconds, also while
  nobody has the page open. From that it keeps the history of every player: first and last seen,
  sessions and playtime, exact to about 15 seconds. RCON does not tell IP addresses or why a player
  left.
- **Online or offline mode** is set by hand by owners, else detected from the UUIDs of the players
  online (name-based UUIDs mean offline mode), else read from `online-mode` in `server.properties`
  (Files connector). Behind a proxy such as Velocity `server.properties` says offline while the
  players have Mojang UUIDs: Outpost goes by the players.
- On **offline-mode** servers, Minecraft resolves the names of players who have never joined at
  Mojang, so a ban or operator rights given to them would apply to the wrong UUID. Outpost keeps
  such actions as **waiting for the player** and runs them as soon as the player comes online (a
  banned player can play for up to one poll interval); they can also be applied at once or
  cancelled. Adding such a player to the whitelist works, with a warning (see the limitations above).
- Minecraft cannot tell over RCON who is an operator, so operator rights are actions only. Sessions
  are kept for 180 days; every action is written to the audit log.

### Whitelist

Where the whitelist comes from and how it is changed depends on the connectors of the server:

| Connectors                  | The list comes from | Changes                                                      |
| --------------------------- | ------------------- | ------------------------------------------------------------ |
| RCON only                   | `whitelist list`    | `whitelist add` and `remove` over RCON                       |
| Files, writing on, and RCON | `whitelist.json`    | Outpost edits `whitelist.json` and runs `whitelist reload`   |
| Files, writing on, no RCON  | `whitelist.json`    | Outpost edits `whitelist.json`; the server loads it on start |
| Files read-only, and RCON   | `whitelist.json`    | over RCON                                                    |
| Files read-only, no RCON    | `whitelist.json`    | none                                                         |

- On **offline-mode** servers Outpost writes the UUID itself: the name-based UUID Minecraft gives
  the player. It depends on the case of the name, so Outpost takes the spelling of players it has
  seen; type the names of new players exactly as they spell them.
- On **online-mode** servers the UUIDs are Mojang's. Outpost does not call the Mojang API: it adds
  players over RCON, and the server looks them up, so adding needs RCON there; removing edits the
  file.
- The **UUID doctor** marks the entries whose players cannot join because of their UUID: Mojang
  UUIDs on offline-mode servers (players whitelisted over RCON before they had joined), name-based
  UUIDs of another spelling of the name, and name-based UUIDs on online-mode servers. On
  offline-mode servers with writing on, **Fix UUIDs** gives these entries the UUIDs of their names.
  Other UUIDs, such as those of Bedrock players through Floodgate, are left alone.
- Whether the whitelist is on is read from `white-list` in `server.properties`; turning it on and
  off needs RCON.
- Outpost makes one change of `whitelist.json` at a time and replaces the file atomically. The
  server rewrites the file when the whitelist is changed in the game, so a change made there at the
  same moment can undo one made in Outpost.

## Player details

The **Player details** tab shows what the world files tell about every player who has joined:

- the inventory with the hotbar, armor and off hand, and the **ender chest**, with the
  enchantments and durability of every item and what shulker boxes and bundles hold;
- health, food, level and game mode;
- the **statistics**: play time, deaths, kills, distances, and the blocks mined, items used and
  crafted and mobs killed most;
- the **advancements** made, the last one first;
- where the player is, their respawn point and where they last died.

It needs the Files connector (reading is enough) and no RCON. The server writes the file of a
player when they leave and at every autosave (every 5 minutes by default), so for players online
the tab can be a few minutes behind; it shows when the file was saved. The **Players** tab links
the card of a player to their details.

Owners, admins and moderators see the tab (`player-details.view`). Where players are and died is
shown only to owners and admins (`player-details.location`), because it leads to their bases.

**Item icons.** Outpost ships no files of the game. An owner can let Outpost download the official
Minecraft client of the version of the world from Mojang: about 40 MB, once per version, after
accepting the [Minecraft EULA](https://www.minecraft.net/eula). Outpost keeps only the item icons
and the English and Russian names (about 1 MB in its database) and serves them itself, so the
browsers of viewers load nothing from other sites. Until then items are shown by name, with a
letter. The download needs Outpost to reach `piston-meta.mojang.com`, `piston-data.mojang.com`
and `resources.download.minecraft.net`. Items of mods have no icons and names made from their ids.

The module reads only `server.properties` (for `level-name`), `usercache.json` (for the names),
`level.dat` (for the version) and the player files: `<world>/players/data`, `stats` and
`advancements` in recent versions (26.x), `<world>/playerdata`, `stats` and `advancements` before.

## Scheduler

The **Scheduler** tab runs tasks on a schedule. It needs a connection.

- A **commands** task sends up to 20 console commands, one after another. An **announcement**
  sends one of its messages to all players per run, in turn; `&` codes color and style them (`&6`
  gold, `&c` red, `&l` bold, `&r` reset), with a preview in the editor.
- The schedule is a five-field cron expression (minute, hour, day of month, month, day of week) in
  the time zone of the task. The editor describes it in words and lists the next runs.
- **Only when players are online** skips the runs while nobody plays. A run is also skipped while
  the previous run of the task is still going, and when the server cannot be reached. Runs missed
  while Outpost was not running are not made up for.
- **Run now** runs a task at once. The last 100 runs of every task are kept with the result; the
  output of the commands is shown to those who manage tasks.
- A task never does more than its author could do by hand: managing tasks needs
  `scheduler.manage`, and commands tasks also need `console.execute`, announcements `chat.send`.
  Creating, changing, running and deleting tasks is written to the audit log; the scheduled runs
  are in the run history.
- The `stop` command shuts the server down. It starts again only if its container is restarted
  automatically, as CapRover and Docker with a restart policy do.

## Events

The **Events** tab runs timed competitions between players on a server. It needs the Files
connector to count and RCON to talk to the players and to give rewards. The first kind counts how
many blocks each player mines — the weekly top three wood cutters, for example.

- An event has a **period**: it starts and ends at the date and time you pick, in a time zone you
  choose. The editor offers 10 minutes, 30 minutes, 2 days, 1 week and 2 weeks as shortcuts; the end can be any moment. An
  event that starts in the past begins at once.
- **What is counted** is one of three things: the blocks mined; the fish caught (the game's own
  counter of fishing catches); or **another statistic** of the game: the items picked up, the mobs
  killed, the items crafted, used, broken or dropped, what killed the player, and the general
  counters such as deaths and animals bred. Blocks and items are picked from groups and any ids of
  your own, where `*` stands for any part of a name (`minecraft:cherry_log`, `*_log`). Groups of
  blocks: wood, stone, ores, earth and the blocks of biomes (cherry grove, pale garden, mangrove
  swamp, jungle, desert and badlands, snowy biomes, mushroom fields, Nether forests and terrain, deep
  dark, caves, ocean, the End, mountains). Groups of statistics: ore drops (raw copper, diamonds…),
  crops, hostile mobs, undead, farm animals, bosses and some counters. The score of a player is what
  their counter grew by from the start to the end. It is read from the statistics of the world, so
  no plugin or mod is needed.
- **Goals** are another kind of event: instead of a top, every player has goals such as "20 spruce
  logs" and "4 ore drops", each counting something of its own (any of the above), and everyone who
  reaches all of them gets the reward, once, as soon as a count sees it. Players ask `!goal` (the
  chat command of the event) and see their own progress, "✓ Spruce logs 20/20", and the event page
  shows the progress of every player. The order of those who reached the goals is the order of the
  counts and, within one count, by name: the files cannot tell more, so this is not a race. Blocks
  that drop themselves (logs, dirt) can be placed and broken again to reach a goal; goals on items
  that only drop from ores (raw copper, diamonds) cannot be reached that way.
- **Who takes part**: the top `N` places count. Operators (from `ops.json`) can be left out with a
  checkbox, and single players can be left out by picking them from the players Outpost knows.
  Of two players with one score the one who reached it first is ahead.
- The **standings** are counted every five minutes by default; each event can refresh them every
  1 to 60 minutes. They are no fresher than the game writes the statistics of a player: when they
  leave and at every autosave, about every five minutes, so counting more often only reads the files
  more often. **Count now** on the page of a running event makes the server save the world
  (`save-all flush`, which can make it hiccup for a moment) and counts from fresh files. At the end
  Outpost does the same, counts once more and freezes the result.
- **Players** can type a chat command, `!top` by default, to see the standings, with their own
  place; they answer only to the player who asked. A player who joins is shown a notice about the
  running event (once per 30 minutes at most). At the end the results are announced to everyone.
  All these texts are yours: the description of the event, the answer to the command, the line of
  one place, the notice, the announcement and the message to a winner, with `&` color codes and
  `{placeholders}` (`{event}`, `{description}`, `{metric}`, `{ends_at}`, `{ends_in}`, `{top}`,
  `{player}`, `{your_place}`, `{your_score}`, `{command}`) and a preview in the editor. Messages are in English
  unless you write them otherwise.
- **Announcements** are messages the event sends to everyone by itself, a number of minutes
  before its start or its end (0 is at that moment), for example "starts in 10 minutes", "starts in
  1 minute" and "is on". A new event has these three ready to edit. One message per moment; a
  message that is late by more than a few minutes, because Outpost was not running, is skipped.
- **Copy** starts a new event from an existing one, from the next minute on, with the same length.
- **JSON** in the editor shows the event as the JSON the API takes, to edit or replace by paste, for
  changing many things at once or moving an event to another server. What the JSON leaves out keeps
  its value from the form, one level down for the texts and the participants, so a small piece
  changes only what it says; mistakes are shown with their place (`participants.top: …`) and keys
  Outpost does not know are listed as ignored. **Copy as JSON** on an event puts it on the clipboard.
  The players left out and the commands of the rewards travel with the JSON; the UUIDs of players
  are those of the server it came from.
- **Rewards** are console commands for the winner of each place, such as `give {player} diamond 5`,
  with `{player}`, `{uuid}`, `{place}`, `{score}` and `{event}` filled in. A command runs when the
  winner is online, so a winner who is away gets it on joining. Every command has a status on the
  event page (waiting for the player, given, failed) and can be tried again or given up. A command
  the server refuses with a syntax error fails at once; **Test** in the editor runs the commands of a
  place for an online player of your choice, for real, and shows what the server answered; the names of players are checked before
  they go into a command.
- The chat command and the notices need the log of the server (`game.events`), which Outpost
  follows on servers that have a running event or rewards waiting. It reads the formats of vanilla,
  Fabric and Paper; a server with a plugin that changes the chat format may not be understood.
- What is counted and the start cannot change once an event has started; the end, the texts, the
  places and the rewards can. A running event can be cancelled, which gives no result and no
  rewards. If Outpost was not running when an event should have started, it starts counting when
  it can and warns that what happened before is not counted.
- Everyone on the server sees the events and their standings; only those who manage events see
  the commands of the rewards. Owners and admins manage events and rewards. Rewards run console
  commands, so setting them needs the right to run console commands (`console.execute`) besides
  managing events. Creating, changing, cancelling and deleting events and rewards are written to the
  audit log.
- Limits of the statistics: breaking a block counts, whatever it is broken with, and so does a block
  that was placed and broken again (with silk touch, for example); Outpost cannot tell these apart.
  The fish caught and the drops of ores, which silk touch does not give, do not have this problem,
  but an item that is dropped and picked up again counts every time.

## Roles

| Permission                                                           | Owner | Admin | Moderator | Viewer |
| -------------------------------------------------------------------- | :---: | :---: | :-------: | :----: |
| See the server (`server.view`)                                       |   ✓   |   ✓   |     ✓     |   ✓    |
| Rename and delete the server (`server.manage`)                       |   ✓   |       |           |        |
| Manage members and invite people (`members.manage`)                  |   ✓   |  ✓¹   |           |        |
| Read the server's audit log (`audit.view`)                           |   ✓   |   ✓   |           |        |
| Run any console command (`console.execute`)                          |   ✓   |   ✓   |           |        |
| Send chat messages (`chat.send`)                                     |   ✓   |   ✓   |     ✓     |        |
| See the players, whitelist and bans (`players.view`)                 |   ✓   |   ✓   |     ✓     |   ✓    |
| Kick players (`players.kick`)                                        |   ✓   |   ✓   |     ✓     |        |
| Ban and unban players and IP addresses (`players.ban`)               |   ✓   |   ✓   |     ✓     |        |
| Manage the whitelist (`players.whitelist`)                           |   ✓   |   ✓   |     ✓     |        |
| Give and take operator rights (`players.op`)                         |   ✓   |   ✓   |           |        |
| See inventories, statistics and advancements (`player-details.view`) |   ✓   |   ✓   |     ✓     |        |
| See where players are and died (`player-details.location`)           |   ✓   |   ✓   |           |        |
| See the scheduled tasks and their runs (`scheduler.view`)            |   ✓   |   ✓   |     ✓     |   ✓    |
| Create, change, run and delete tasks (`scheduler.manage`)            |   ✓   |   ✓   |           |        |
| See events and their standings (`competitions.view`)                 |   ✓   |   ✓   |     ✓     |   ✓    |
| Create, change, cancel and delete events (`competitions.manage`)     |   ✓   |   ✓   |           |        |
| Try rewards again and give them up (`competitions.rewards`)          |   ✓   |   ✓   |           |        |

¹ Admins manage only moderators and viewers: they can add, change, remove and invite people with
these roles, but cannot touch owners and other admins. Owners manage every role, including other
owners.

The console, player, scheduler and event permissions come from their modules: modules add their own
permissions with the roles that have them.

**Superadmins** are the administrators of the whole Outpost instance. They have every permission
on every server without being members, manage user accounts and see the audit log of the
instance.

## Members

Owners and admins manage the team under **Members**:

- **Add a member** — someone who already has an Outpost account, by their exact username;
- **Invite** — someone without an account gets an invitation link (single use, valid for 1, 7 or
  30 days). They choose a username, set a password or sign in with GitHub or OpenID Connect, and
  join the server with the role of the invitation;
- change a member's role or remove them.

Changes of the team need a recent password confirmation, like other sensitive actions (see
[authentication](authentication.md#sensitive-actions)). The full list of accounts is visible only
to superadmins.

## Audit log

Every change is recorded with the time, the user, the server and the client IP address. Owners and
admins read the log of their server under **Audit log**; superadmins read the log of the whole
instance under **Administration → Audit log**, filtered by server, user or action. Entries are kept
for `OUTPOST_AUDIT_RETENTION_DAYS` days (180 by default, `0` keeps them forever).

## For module authors

A plugin declares its permissions and the built-in roles that have them, and registers routes of a
server, which Outpost mounts at `/api/v1/servers/:serverId/plugins/<plugin id>/…`:

```ts
export default definePlugin({
  id: 'acme.greeter',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  games: ['minecraft-java'], // leave out for a module that works with any game
  files: { read: ['server.properties'] }, // the files the module uses through ctx.files
  permissions: [{ key: 'greeter.greet', roles: ['owner', 'admin', 'moderator'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'POST',
      url: '/greet',
      permission: 'greeter.greet',
      capability: 'commands.send', // the server must support sending commands
      handler: async ({ server, user }) => {
        await ctx.audit.record({ action: 'greeted', userId: user.id, serverId: server.id });
        return { ok: true };
      },
    });
  },
});
```

Outpost answers `404` when the user cannot see the server, `403` without the permission and `409`
when the plugin does not support the game of the server or the server lacks the capability,
before the handler runs. `games` lists the games a plugin supports (ids such as `minecraft-java`,
also of games Outpost does not know yet); a plugin without `games` works with any game. Its tabs
show only on servers of these games, and `ctx.servers.supports(server)` tells background jobs
which servers are theirs. `ctx.commands.send(serverId, command)` runs a console command
through the RCON connector (capability `commands.send`), `ctx.files` reads, writes, stats and lists the files of the server through the Files connector (`files.read`, `files.write`; paths relative to the server's folder) — only those the plugin declares in `files`, where `*` stands for any part of a name and `**` for any number of folders, and paths in `write` may also be read; other paths are refused with `403 file_out_of_scope`, and listings show only the declared files — `ctx.logs` gives the recent lines of the server log and the new ones as they are written (`logs.stream`), `ctx.http.serverEvents` streams server-sent events to the browser with the same checks as a server route, `ctx.permissions.has()` checks a permission elsewhere (for example for live updates), and `ctx.secrets` encrypts secrets the plugin
stores. The web part of a plugin adds a tab to the server page with `serverTabs`, shown to users
with the tab's permission.

A plugin with `games` is a module of servers, which owners can switch off for a server, unless it
sets `essential: true`; a plugin without `games` is not tied to servers. `ctx.servers.supports(server)`
is false for a server where the plugin is off, and `ctx.servers.enabledFor(serverId)` tells it
without the server; a background job must check one of them for every server before it touches it,
and listen to the event `outpost.module.changed` (`{ serverId, pluginId, enabled }`) if it keeps
something open per server.

More services of the platform, each with its capability (see above):

- `ctx.gameEvents.subscribe(serverId, listener)` calls the listener with what players do as the
  log tells: `{ type: 'chat', player, message }`, `{ type: 'joined', player }` and
  `{ type: 'left', player }`. The log is read once per server however many modules listen, and
  followed again after its connector changed.
- `ctx.chat.tell(serverId, player, message)` and `ctx.chat.broadcast(serverId, message)` send a
  message, or an array of lines that cost the server one command, with `&` colors through `tellraw`, with the JSON built by Outpost: neither the name nor
  the text can change the command. `@outpost/shared` has the helpers behind it (`parseMessage`,
  `tellrawCommand`, `renderTemplate` for `{placeholders}`).
- `ctx.stats` gives the statistics of the players: `list(serverId)` the players with the time
  their file was written, `read(serverId, uuid)` their counters (`mined`, `killed`, …), and
  `flush(serverId)` makes the server write them (`save-all flush`).
- `ctx.playerTasks` keeps things to do when a player is online, in the database: a plugin registers
  a handler for a kind of task with `handle(kind, handler)` during `setup`, adds tasks with
  `enqueue(...)`, and lists, retries (`retry`) and cancels (`cancel`) them. Outpost asks the
  servers who is online every 10 seconds; a plugin that follows joins can call `playerJoined()`
  to run a player's tasks at once. A handler that throws is tried again after a while, up to five
  times; a `PlayerTaskError` gives up at once.
- `ctx.services` lets plugins offer each other services: `provide(name, service)` during `setup`,
  `get(name)` in a plugin that lists the provider in `dependsOn` (`'outpost.players?'` when it is
  optional). A plugin types its service by adding to `OutpostServices` by declaration merging; the
  Players module offers `outpost.players` with `online(serverId)` and `known(serverId)`.
