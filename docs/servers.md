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

## Connecting a server

A server is connected through **connectors**, which superadmins set up under **Settings**. Each
connector is tested and saved on its own and adds **capabilities** to the server. Modules use the
capabilities and do not care which connector provides them.

| Connector | Capabilities                | Needs                                                                  |
| --------- | --------------------------- | ---------------------------------------------------------------------- |
| RCON      | `commands.send`             | the RCON port of the game server, reachable by Outpost                 |
| Files     | `files.read`, `files.write` | the data folder of the game server: mounted into Outpost, or over SFTP |

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
refused. No module of this version uses the files yet; the offline-mode whitelist, the live log from
`logs/latest.log` and the settings editor will build on them.

### Who connects

Only superadmins change connectors, because a connector points Outpost at a host or a folder of its
environment. Once RCON is connected, **Overview** shows whether the server answers and who is online, and the
**Console** tab runs commands (owners and admins) and sends chat messages (also moderators). Every
command and message is written to the audit log.

Limitations of the RCON connection:

- the console shows the replies to commands, not the live server log;
- on offline-mode servers, `whitelist add` for a player who has never joined stores the wrong
  (online) UUID, because Minecraft looks up unknown names at Mojang. Let such players join once with
  the whitelist off; a module on top of the Files connector will fix this.

## Players

The **Players** tab shows who is online and manages the whitelist, bans (of players and IP
addresses), kicks and operator rights. It needs a connection.

- Outpost asks every connected server who is online (`list uuids`) every 15 seconds, also while
  nobody has the page open. From that it keeps the history of every player: first and last seen,
  sessions and playtime, exact to about 15 seconds. RCON does not tell IP addresses or why a player
  left.
- **Online or offline mode** is detected from the UUIDs of the players online (name-based UUIDs mean
  offline mode) and can be set by hand by owners.
- On **offline-mode** servers, Minecraft resolves the names of players who have never joined at
  Mojang, so a ban or operator rights given to them would apply to the wrong UUID. Outpost keeps
  such actions as **waiting for the player** and runs them as soon as the player comes online (a
  banned player can play for up to one poll interval); they can also be applied at once or
  cancelled. Adding such a player to the whitelist works, with a warning (see the limitations above).
- Minecraft cannot tell over RCON whether the whitelist is on or who is an operator, so these are
  actions only. Sessions are kept for 180 days; every action is written to the audit log.

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

## Roles

| Permission                                                | Owner | Admin | Moderator | Viewer |
| --------------------------------------------------------- | :---: | :---: | :-------: | :----: |
| See the server (`server.view`)                            |   ✓   |   ✓   |     ✓     |   ✓    |
| Rename and delete the server (`server.manage`)            |   ✓   |       |           |        |
| Manage members and invite people (`members.manage`)       |   ✓   |  ✓¹   |           |        |
| Read the server's audit log (`audit.view`)                |   ✓   |   ✓   |           |        |
| Run any console command (`console.execute`)               |   ✓   |   ✓   |           |        |
| Send chat messages (`chat.send`)                          |   ✓   |   ✓   |     ✓     |        |
| See the players, whitelist and bans (`players.view`)      |   ✓   |   ✓   |     ✓     |   ✓    |
| Kick players (`players.kick`)                             |   ✓   |   ✓   |     ✓     |        |
| Ban and unban players and IP addresses (`players.ban`)    |   ✓   |   ✓   |     ✓     |        |
| Manage the whitelist (`players.whitelist`)                |   ✓   |   ✓   |     ✓     |        |
| Give and take operator rights (`players.op`)              |   ✓   |   ✓   |           |        |
| See the scheduled tasks and their runs (`scheduler.view`) |   ✓   |   ✓   |     ✓     |   ✓    |
| Create, change, run and delete tasks (`scheduler.manage`) |   ✓   |   ✓   |           |        |

¹ Admins manage only moderators and viewers: they can add, change, remove and invite people with
these roles, but cannot touch owners and other admins. Owners manage every role, including other
owners.

The console, player and scheduler permissions come from their modules: modules add their own
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
through the RCON connector (capability `commands.send`), `ctx.files` reads, writes, stats and lists the files of the server through the Files connector (`files.read`, `files.write`; paths relative to the server's folder), `ctx.permissions.has()` checks a permission elsewhere (for example for live updates), and `ctx.secrets` encrypts secrets the plugin
stores. The web part of a plugin adds a tab to the server page with `serverTabs`, shown to users
with the tab's permission.
