# Passwords and access

## The password

Set `NOTEFEED_PASSWORD` to lock the instance: posting then needs `Authorization: Bearer <password>`, and every page except the login page, the read-only views and the legal pages needs a login. Read links keep working, so feed readers need no change.

```sh
openssl rand -hex 32
```

There is one password for the whole instance. Changing it logs out every browser and breaks every script until you update them. Wrong passwords are rate-limited like posts.

!!! note "Logins don't expire"
    The login cookie stays valid for a year, and logging out only removes it from that browser. If you think a cookie leaked, change `NOTEFEED_PASSWORD`.

A single feed can have a password of its own as well, set by whoever creates it: see [Feed passwords](../using/feed-passwords.md). On a locked instance a protected feed needs both.

## Sign-in

Optional, and off unless the `NOTEFEED_OIDC_*` variables are set: people sign in through your OpenID Connect provider and their notes carry a sender. See [Sign-in and sender](sign-in/index.md).

## Reserved feeds

For feeds that only the operator posts to but everyone may subscribe to, such as `news` or `announcements`:

```yaml
NOTEFEED_RESERVED_FEEDS: news,announcements
NOTEFEED_RESERVED_PASSWORD: a-long-operator-password
```

At start-up each listed name that doesn't exist yet is created as a [protected feed](../using/feed-passwords.md#in-the-api) with that password, and its read id is its name: `/r/news/feed.xml` is the link to hand out, and it never changes. Nobody else can create a listed name (`400`, `reserved_feed`). Without the password the names are blocked but the feeds don't exist. A name that already exists as an open feed is not converted: delete its folder and restart.

## OAuth for MCP clients

Clients that can't send a header, such as the Claude.ai and Claude Desktop connectors for [MCP](../integrations/mcp.md), log in through notefeed's own OAuth login page with the instance password (or [sign-in](sign-in/index.md)). It only exists on a locked instance. `PUBLIC_URL` is the issuer, so set it with `https://`. Nothing is stored: codes and tokens are signed with a key derived from the secret and the password, so changing `NOTEFEED_PASSWORD` signs every client out. An access token lasts an hour, a refresh token 30 days.
