# Security Policy

## Supported versions

Outpost is pre-1.0. Security fixes are released only for the latest version.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub:
[**Report a vulnerability**](https://github.com/mobixon/outpost/security/advisories/new).

Please include:

- the affected version or commit,
- how Outpost is deployed (Compose, Swarm/CapRover, …),
- steps to reproduce and the impact you observed,
- any suggested fix, if you have one.

This is a volunteer project; we aim to acknowledge reports within 7 days and to agree on a
disclosure date with you. Reporters are credited in the advisory unless they prefer otherwise.

## Deployment notes

Version 0.1 connects to game servers over RCON only and needs no access to Docker. Keep RCON ports
off the public internet (RCON is not encrypted), serve Outpost over HTTPS and enable 2FA for every
administrator — see [docs/install.md](docs/install.md).

The planned full connection will talk to the Docker Engine. Direct access to the Docker socket is
equivalent to root on the host, so the recommended setups will put a socket proxy with a read-only
allowlist between Outpost and Docker.
