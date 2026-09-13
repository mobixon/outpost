# Servers, roles and permissions

Every game server managed by Outpost has its own team. People see only the servers they are
members of, and on each server they can do what their role allows.

## Servers

Superadmins add servers on the home page with a name and a short name, which appears in the
addresses of the web UI (`/servers/<short name>`), and connect them under **Settings →
Connection**.

Owners rename a server and delete it under **Settings**. Deleting removes the server from Outpost
with its members and invitations; the game server itself is not touched, and the audit log keeps
its entries.

## Connecting a server

This version connects over **RCON**, the remote console of Minecraft. The **Full** connection — the
live server log, status and file access through Docker — is shown in the settings and arrives in a
later version.

1. RCON must be on (`enable-rcon=true` in `server.properties`; the `itzg/minecraft-server` image
   turns it on by default) and reachable from Outpost. Put both containers into one Docker network
   and use the container or service name as the host (CapRover: `srv-captain--<app>`). Never publish
   the RCON port to the internet: RCON is not encrypted.
2. The password is `rcon.password` in `server.properties`; with `itzg/minecraft-server` it is
   `RCON_PASSWORD`, or the generated `password=` line in `.rcon-cli.env` in the data directory.
3. **Test** connects, logs in and runs `list`, and shows which step fails. **Save** stores the
   connection; the password is encrypted with `OUTPOST_SECRET_KEY` and never shown again.

Only superadmins change connections, because a connection points Outpost at a host and port in its
network. Once connected, **Overview** shows whether the server answers and who is online, and the
**Console** tab runs commands (owners and admins) and sends chat messages (also moderators). Every
command and message is written to the audit log.

Limitations of the RCON connection:

- the console shows the replies to commands, not the live server log;
- on offline-mode servers, `whitelist add` for a player who has never joined stores the wrong
  (online) UUID, because Minecraft looks up unknown names at Mojang. Let such players join once with
  the whitelist off, or wait for the file access of the full connection.

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

## Roles

| Permission                                             | Owner | Admin | Moderator | Viewer |
| ------------------------------------------------------ | :---: | :---: | :-------: | :----: |
| See the server (`server.view`)                         |   ✓   |   ✓   |     ✓     |   ✓    |
| Rename and delete the server (`server.manage`)         |   ✓   |       |           |        |
| Manage members and invite people (`members.manage`)    |   ✓   |  ✓¹   |           |        |
| Read the server's audit log (`audit.view`)             |   ✓   |   ✓   |           |        |
| Run any console command (`console.execute`)            |   ✓   |   ✓   |           |        |
| Send chat messages (`chat.send`)                       |   ✓   |   ✓   |     ✓     |        |
| See the players, whitelist and bans (`players.view`)   |   ✓   |   ✓   |     ✓     |   ✓    |
| Kick players (`players.kick`)                          |   ✓   |   ✓   |     ✓     |        |
| Ban and unban players and IP addresses (`players.ban`) |   ✓   |   ✓   |     ✓     |        |
| Manage the whitelist (`players.whitelist`)             |   ✓   |   ✓   |     ✓     |        |
| Give and take operator rights (`players.op`)           |   ✓   |   ✓   |           |        |

¹ Admins manage only moderators and viewers: they can add, change, remove and invite people with
these roles, but cannot touch owners and other admins. Owners manage every role, including other
owners.

The console and player permissions come from the console and players modules: modules add their
own permissions with the roles that have them.

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
when the server lacks the capability, before the handler runs. `ctx.commands.send(serverId, command)` runs a console command
over the server's connection, `ctx.permissions.has()` checks a permission elsewhere (for example for live updates), and `ctx.secrets` encrypts secrets the plugin
stores. The web part of a plugin adds a tab to the server page with `serverTabs`, shown to users
with the tab's permission.
