# Feed passwords

A feed can have a password of its own, so that strangers who guess or learn its name can neither read nor post. It is set only when the feed is created. The [read link](read-links.md) and the RSS feed stay open, so readers need no password. On an instance with its own password you need both.

## In the web UI

On a feed that doesn't exist yet, the feed's details (under its card, on the right on a wide screen) have a **Protect this feed** section with an optional **Password** field: fill it in and the first note creates a protected feed. The password is 1 to 256 printable ASCII characters, with no space at the start or end, so that it works from a script too.

A protected feed shows an **Unlock** form before anything else. The browser then stays unlocked until the password changes or you press **Lock this browser**. Once unlocked, the settings page has a **Privacy & access** group to change or remove the password (both need the current one) and to lock the browser again. Changing the password signs every other browser out.

!!! note "On notefeed.me"
    A feed password needs a license. Fill in the **License key** field under the password, or send its key as `X-License-Key` on the post that creates the feed; without it the post is `402` (`license_required`). See [Free tier and licenses](../hosted/licenses.md#entering-the-key).

## In the API

Send the password as `X-Feed-Password` with the feed's first note, and on every request after that:

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notes.example.com/homelab-7f3k2q9x4m8wz
```

!!! warning "An empty password creates an open feed"
    curl leaves out a header whose value is empty, so with `$FEED_PASSWORD` unset the first post creates an open feed, and an open feed can never get a password afterwards (`409`). `${FEED_PASSWORD:?}` makes the shell stop instead.

A wrong or missing password is `401`, and wrong ones count toward the [rate limit](../self-hosting/limits.md). The `notefeed` command reads the password from `NOTEFEED_FEED_PASSWORD`; the client libraries take it as an option.

To change the password, `PUT /api/v1/feeds/<feed>/password` with the current one in the header and the new one in a JSON body; to remove it, `DELETE` the same URL. The feed stays, open to anyone who knows its name.

```sh
curl -X PUT -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "Content-Type: application/json" \
  -d '{"password": "a-new-password"}' https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz/password
```

## A lost password

The password is stored only as a salted hash, so nobody can look it up. On an instance that sells licenses, the feed's license key recovers it: the unlock screen's **Forgot the password?** sets a new password or removes it ([hosted](../hosted/licenses.md#a-lost-feed-password)).

Otherwise the operator removes it and the feed is open at once, with its notes intact. With the file storage the hash is `DATA_DIR/<feed>/.password`: delete that file, and back it up with the notes. With SQLite or PostgreSQL there is no file: the operator clears the feed's password hash in the database (its `password_hash`, on the row the feed's name finds; with encryption at rest, ADR 0033, that name is stored as a keyed hash). Without a license the feed cannot get a password again: to keep it protected, copy its notes to a new feed created with a new password.
