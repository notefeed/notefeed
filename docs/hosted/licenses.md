# Free tier and licenses

This page is about [notefeed.me](https://notefeed.me) only. A notefeed you run yourself has no free tier and no licenses: every feature is on, and the limits are [yours to set](../self-hosting/configuration.md).

## The free tier

Every feed on notefeed.me starts on the free tier, with nothing to sign up for:

- **It keeps its newest 1000 notes.** At the cap, each new note drops the oldest one; a post is never refused for it.
- **No pictures.** A picture, posted on its own or with a note, is refused with `402` (`license_required`).
- **No feed password.** A [feed password](../using/feed-passwords.md) is set when the feed is created, and on notefeed.me that first post needs a license key next to the password (below). Without one it is refused with `402`.

The feed's settings show the tier under **License**, as *Free tier · N of 1000 notes*, with a meter. From 90 % of the cap on, the feed's page tells whoever can post to it; readers, the read-only view and RSS never see it. Scripts read the same from the [Feeds API](../integrations/api.md): `GET /api/v1/feeds/<feed>` answers `free_tier` as `{ "notes": N, "cap": 1000 }`, or `null` for a licensed feed.

## What a license is

A license is for one feed, by the month or by the year; the price is on the [license page](https://notefeed.me/license). With it the feed keeps every note, can have a feed password and takes pictures.

There are no accounts. A license is a **key** you keep: notefeed stores only a hash of it and nothing about you; the payment provider holds the purchase. The key is shown once, on the page you land on after paying. Keep it: notefeed cannot show it again or recover a lost one.

## Entering the key

A key works on one feed at a time, and can be moved:

- **In the feed's settings:** open the **License** row and enter the key under *Use key*. Entering it on another feed later moves the license there. *Take the license off this feed* frees the key without moving it.
- **When creating a protected feed:** the compose box of a new feed has a **License key** field next to the password, so the first note creates the feed protected and licensed in one go. A feed can only get a password when it is created, so this is the only way to a protected feed. Without the key, the box says so and links to the license page.
- **From a script:** send `X-License-Key` next to `X-Feed-Password` on the post that creates the feed. The [client libraries](../integrations/clients.md) take it as `license_key` (Python) or `licenseKey` (Node), and the [MCP server](../integrations/mcp.md)'s `post_note` as `license_key`. Without it the post is `402` (`license_required`); a key notefeed does not know is `400`. On an existing feed the key goes in through the settings.

```sh
curl -H "X-Feed-Password: ${FEED_PASSWORD:?}" -H "X-License-Key: ${LICENSE_KEY:?}" -H "Content-Type: text/markdown" \
  --data-binary @note.md https://notefeed.me/homelab-7f3k2q9x4m8wz
```

## Cancelling, invoices, payment method

The subscription lives at the payment provider. The [license page](https://notefeed.me/license) opens its portal for your key: cancel there, change how you pay, or download invoices. The provider's receipt is your record of the purchase.

## When a license ends

When the subscription is cancelled the license runs to the end of the paid period; a refund or chargeback ends it at once. The feed then returns to the free tier, and nothing is deleted:

- The notes stay. The cap applies to new notes again: past 1000, each new note drops the oldest one.
- A feed password that is set keeps protecting the feed, but cannot be changed until the feed is licensed again; it can be removed.
- Pictures already posted are still served; new ones are refused.

Deleting a feed, or its removal by the operator, takes the license off it, so the key can be entered on another feed.
