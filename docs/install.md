# Installing Outpost

Outpost runs as one container with the web UI, the API and the database (SQLite by default).
Images are published on the GitHub Container Registry as `ghcr.io/mobixon/outpost:<version>` for
linux/amd64; the versions are listed under [releases](https://github.com/mobixon/outpost/releases).
Pin a version. Pre-releases such as `0.2.0-rc.1` do not move the `latest` tag.

You need:

- Docker, or a platform that runs containers (CapRover, Portainer, Kubernetes…);
- a game server whose RCON port Outpost reaches over a private network — see
  [connecting a server](servers.md#connecting-a-server);
- for use over the internet, a domain with HTTPS in front of Outpost.

## Docker Compose

```yaml
services:
  outpost:
    image: ghcr.io/mobixon/outpost:0.3.0
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:3000' # for the reverse proxy on the same host
    volumes:
      - outpost-data:/data
    environment:
      OUTPOST_SECRET_KEY: ${OUTPOST_SECRET_KEY}
      OUTPOST_PUBLIC_URL: https://outpost.example.com
      OUTPOST_TRUST_PROXY: 'true'
      TZ: Europe/Berlin

volumes:
  outpost-data:
```

Generate the secret key once, with `openssl rand -base64 48`, and keep it. It encrypts the secrets
in the database (RCON passwords, 2FA secrets); with another key they cannot be read.

Put the game server into the same Compose project or Docker network, so that Outpost reaches RCON
by its service name. Do not publish the RCON port: RCON is not encrypted.

All settings are listed in [configuration](configuration.md).

## File access

Modules read and write the files of a game server through the **Files** connector. Mount the data
folder of each game server into Outpost below `/servers` (`OUTPOST_FILES_ROOT`):

```yaml
services:
  outpost:
    volumes:
      - outpost-data:/data
      - minecraft-data:/servers/survival # the data volume of the game server
```

Then choose the folder `survival` under **Settings → Files** of the server. Outpost runs as UID
1000, like `itzg/minecraft-server`; for writing with another game image, run Outpost as the user
that owns the files (`user: '1001'`). If modules should only read, mount the folder read-only
(`:ro`) and leave writing off.

## Behind a reverse proxy

- `OUTPOST_PUBLIC_URL` is the exact address people open. Requests from other origins are rejected,
  and `https` turns on secure cookies and HSTS.
- `OUTPOST_TRUST_PROXY=true` takes the client IP address (for rate limits and the audit log) from
  `X-Forwarded-For`. Set it only when Outpost can be reached through the proxy alone.
- Plain HTTP proxying is enough: this version uses no WebSockets.

## CapRover

1. Create an app, for example `outpost`, with **Has Persistent Data**, and add the persistent
   directory `/data`.
2. **App Configs** → environment variables: `OUTPOST_SECRET_KEY`,
   `OUTPOST_PUBLIC_URL=https://<domain>`, `OUTPOST_TRUST_PROXY=true` and `TZ`.
3. **HTTP Settings**: connect the domain, enable HTTPS and **Force HTTPS**, and set the
   **Container HTTP Port** to `3000`.
4. **Deployment** → deploy via image name: `ghcr.io/mobixon/outpost:<version>`.
5. Connect game servers by their service name: host `srv-captain--<app>`, port `25575`. CapRover
   apps share one overlay network, so RCON needs no public port.
6. For file access, add a persistent directory to the Outpost app with the **host path** of the
   game server's data (for example `/captain/data/<app>`) and the path in the app
   `/servers/<app>`, then choose the folder `<app>` under **Settings → Files**. A game server with a
   named volume keeps its data in `/var/lib/docker/volumes/captain--<volume>/_data` on the host.

## First run

Outpost prints a one-time setup token to its log (`docker compose logs outpost`, or the app logs
in CapRover). Open the public URL, enter the token and create the first administrator.
Administrators have to turn on two-factor authentication before they can use the panel. Then add
the game server and connect it, see [servers](servers.md).

## Updates

Deploy a newer version. Database migrations run on start, so an update cannot be undone by going
back to the old image: back up first. Before version 1.0, read the release notes of every version.

## Backups

Everything is in `/data`: the database `outpost.db` with its `-wal` and `-shm` files. Back up the
volume while the container is stopped, or copy the database while it runs with
`sqlite3 outpost.db ".backup backup.db"`. With PostgreSQL (`DATABASE_URL`), back up that database
instead.

Keep `OUTPOST_SECRET_KEY` safe and apart from the backups: a backup is of little use without it,
and together they reveal the stored RCON passwords.
