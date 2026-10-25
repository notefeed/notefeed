# RSS and dashboards

## What's in the feed

The RSS feed at the [read link](read-links.md) holds the newest 50 notes. Its title, description and image are the feed's (see [Feed settings](feeds.md#feed-settings-in-the-web-ui)), or `NOTEFEED_TITLE` when the feed has no title. Each item has the note's title, a link to its read-only page, its time, its tags as `<category>` elements, and the note's text as HTML for its description, rendered as the page renders it (raw HTML in a note stays text). The first picture in the text is also the item's `<media:content>` and `<media:thumbnail>`, for readers that show one picture per item. A [picture](pictures.md) is an item with an `<enclosure>`, which most readers show inline; without a title it is titled by its alternative text, else the name it was posted with, else "Picture" and its time. The sender shows as `<dc:creator>` only with [sign-in](../self-hosting/sign-in/index.md) on and **Show who posted** on.

`/r/<read id>/feed.xml?tag=ci` is the same feed with only the notes tagged `ci`.

!!! note "Links need the right public address"
    Links are built from `PUBLIC_URL`, or from the request when it's unset. If a reader fetches the feed over a LAN address, set `PUBLIC_URL` so links still point at the public site. See [Configuration](../self-hosting/configuration.md).

## Title and description

The feed's title, description and title image are visible to anyone with the read link. Don't put anything private in them. The feed's name is never shown.

## Glance and Dynacat

Add an `rss` widget to a page, with the feed's read link:

```yaml
- type: rss
  title: Homelab
  limit: 15
  collapse-after: 5
  cache: 5m
  feeds:
    - url: http://192.168.1.10:3000/r/q2Zc9kD0bTnVx4LmAe7sWp/feed.xml
      title: notefeed
```

`cache: 5m` keeps new notes showing up within minutes. The widget shows titles and times, not the markdown. For several feeds, list several read links.

## Other readers

Any RSS reader works (Miniflux, FreshRSS, NetNewsWire, and so on). Subscribe to the read link.
