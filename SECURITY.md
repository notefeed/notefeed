# Security policy

## Reporting a vulnerability

Report it privately through [**Report a vulnerability**](https://github.com/notefeed/notefeed/security/advisories/new) on this repository's Security tab. Please do not open a public issue for it.

This covers the server, the image `ghcr.io/notefeed/notefeed`, the client packages `notefeed` on npm and PyPI, and the hosted service at notefeed.me.

Helpful in a report: the version or image tag, how the instance is configured as far as it matters, and the steps that show the problem.

You get an answer within seven days. Once a fix is released, the advisory is published and names you, unless you would rather not be named.

A note on notefeed.me that should not be there is not a vulnerability: use the **Report** link on the note, or [notefeed.me/report](https://notefeed.me/report).

## Supported versions

Security fixes go into a new release, and only the newest release gets them. There are no backports to older versions.

| Version | Security fixes |
|---|---|
| newest release (`:latest`, and the `:X` and `:X.Y` tags that follow it) | yes |
| anything older | no: upgrade to the newest release |

How to upgrade: [Upgrading](https://docs.notefeed.me/self-hosting/upgrading/).

## What each release carries

Each [release](https://github.com/notefeed/notefeed/releases) has two SBOM files (CycloneDX), and the image carries an SBOM and a build provenance attestation. See [Security fixes and SBOM](https://docs.notefeed.me/self-hosting/security/).
