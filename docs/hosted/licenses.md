# Free tier and licenses

This page is about [notefeed.me](https://notefeed.me) only. A notefeed you run yourself has no free tier and no licenses: every feature is on, and the limits are [yours to set](../self-hosting/configuration.md).

## The free tier

Every feed on notefeed.me starts on the free tier, with nothing to sign up for:

- **It keeps its newest 100 notes.** At the cap, each new note drops the oldest one; a post is never refused for it.
- **No pictures.** A picture, posted on its own or with a note, is refused with `402` (`license_required`).
- **No feed password.** A [feed password](../using/feed-passwords.md) needs a license: on the post that creates the feed, with the key next to the password (below), or later, once the feed has one ([a password for an open feed](../using/feed-passwords.md#a-password-for-an-open-feed)). Without one it is refused with `402`. A license needs no password, though: an open feed can be licensed too.

The feed's settings show the tier under **License**, as *Free tier · N of 100 notes*, with a meter. From 90 % of the cap on, the feed's page tells whoever can post to it; readers, the read-only view and RSS never see it. Scripts read the same from the [Feeds API](../integrations/api.md): `GET /api/v1/feeds/<feed>` answers `free_tier` as `{ "notes": N, "cap": 100 }`, or `null` for a licensed feed.

## What a license is

A license is for one feed, by the month or by the year; the price is on the [license page](https://notefeed.me/license). With it the feed keeps every note, can have a feed password, takes pictures, and its posts, edits and deletes don't count against the per-client rate limit, so a burst from CI is never answered with `429`.

There are no accounts. A license is a **key** you keep: notefeed stores only a hash of it and nothing about you; the payment provider holds the purchase. The key is issued by the payment provider: it is shown on the page you land on after paying, and it is in the provider's receipt e-mail and customer portal, where you find it again if you lose it. notefeed itself cannot show it again.

## Entering the key

A key works on one feed at a time, and can be moved:

- **In the feed's settings:** open the **License** row and enter the key under *Use key*. Entering it on another feed later moves the license there. *Take the license off this feed* frees the key without moving it.
- **When creating a protected feed:** a new feed's **Protect this feed** section has a **License key** field under the password, so the first note creates the feed protected and licensed in one go. Without the key, the compose box says so and links to the license page. **Create feed without a note** in the same section makes the feed right away with the key (and the password, if given); on notefeed.me a feed without a note always needs a license key. An open feed with a license gets a password later in its settings ([a password for an open feed](../using/feed-passwords.md#a-password-for-an-open-feed)).
- **From a script, on the post that creates the feed:** send `X-License-Key`, with `X-Feed-Password` for a protected feed or without it for an open one. The [client libraries](../integrations/clients.md) take it as `license_key` (Python) or `licenseKey` (Node), and the [MCP server](../integrations/mcp.md)'s `post_note` as `license_key`. A password without a key is `402` (`license_required`); a key notefeed does not know is `400`, one whose license has lapsed `402`, and then nothing is created. On a feed that exists already, a key on a post is not used.

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "X-License-Key: ${LICENSE_KEY:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notefeed.me/homelab-7f3k2q9x4m8wz
```

- **From a script, on a feed that exists:** `PUT /api/v1/feeds/<feed>/license` with `{"key": "…"}` puts the license on the feed (moving it from the feed it was on), and `DELETE` takes it off. Both need what posting needs (the feed's password, if it has one) and answer the feed, with `free_tier` `null` while it is licensed. The clients have `attach_license` / `detach_license` (Python) and `attachLicense` / `detachLicense` (Node), and the MCP server's `update_feed` takes `license_key` (empty takes it off).

```sh
curl -X PUT -H "Content-Type: application/json" -d "{\"key\": \"${LICENSE_KEY:?}\"}" https://notefeed.me/api/v1/feeds/homelab-7f3k2q9x4m8wz/license
```

A key notefeed does not know counts as a wrong password, wherever it is sent.

## Cancelling, invoices, payment method

The subscription lives at the payment provider. The [license page](https://notefeed.me/license) opens its portal for your key: cancel there, change how you pay, or download invoices. The provider's receipt is your record of the purchase.

## A lost feed password

The feed's license key proves the feed is yours. On the feed's unlock screen, open **Forgot the password?** (or, in a browser that is still unlocked, **Forgot the current password?** under *Feed password* in the settings), enter the key and a new password, and the feed is unlocked with it; leave the new password empty to remove the password instead. Setting a new one needs an active license; removing it works with a lapsed one too. Scripts and agents do the same with `POST /api/v1/feeds/<feed>/password/recover` and JSON `{"key": "…", "password": "…"}`, the MCP tool `recover_feed_password`, or `recoverFeedPassword` / `recover_feed_password` in the client packages. A wrong key counts as a wrong password. Give the password to scripts and co-authors, but keep the key to yourself: it is also the way to the subscription and its invoices.

## When a license ends

When the subscription is cancelled the license runs to the end of the paid period; a refund or chargeback ends it at once. The feed then returns to the free tier, and nothing is deleted:

- The notes stay. The cap applies to new notes again: past 100, each new note drops the oldest one.
- A feed password that is set keeps protecting the feed, but cannot be changed until the feed is licensed again; it can be removed.
- Pictures already posted are still served; new ones are refused.

Deleting a feed, or its removal by the operator, takes the license off it, so the key can be entered on another feed.
