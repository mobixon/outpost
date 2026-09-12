# Servers, roles and permissions

Every game server managed by Outpost has its own team. People see only the servers they are
members of, and on each server they can do what their role allows.

## Servers

Superadmins add servers on the home page with a name and a short name, which appears in the
addresses of the web UI (`/servers/<short name>`). Connecting a server to Docker, RCON and its
files arrives with the connection wizard in an upcoming version; until then a server is shown as
"not connected", but its team can already be set up.

Owners rename a server and delete it under **Settings**. Deleting removes the server from Outpost
with its members and invitations; the game server itself is not touched, and the audit log keeps
its entries.

## Roles

| Permission                                          | Owner | Admin | Moderator | Viewer |
| --------------------------------------------------- | :---: | :---: | :-------: | :----: |
| See the server (`server.view`)                      |   ✓   |   ✓   |     ✓     |   ✓    |
| Rename and delete the server (`server.manage`)      |   ✓   |       |           |        |
| Manage members and invite people (`members.manage`) |   ✓   |  ✓¹   |           |        |
| Read the server's audit log (`audit.view`)          |   ✓   |   ✓   |           |        |

¹ Admins manage only moderators and viewers: they can add, change, remove and invite people with
these roles, but cannot touch owners and other admins. Owners manage every role, including other
owners.

Modules add their own permissions with the roles that have them — for example, the console and
players modules will let moderators kick players and send chat messages, and owners and admins run
any console command.

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
when the server lacks the capability, before the handler runs. `ctx.permissions.has()` checks a
permission elsewhere (for example for live updates), and `ctx.secrets` encrypts secrets the plugin
stores. The web part of a plugin adds a tab to the server page with `serverTabs`, shown to users
with the tab's permission.
