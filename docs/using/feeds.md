# Feeds

## Feed names

A feed name is 1 to 64 characters of `a`–`z`, `0`–`9`, `-` and `_`. Names notefeed uses for its own routes (`r`, `api`, `login`, `health` and so on) and the operator's [reserved feeds](../self-hosting/access.md#reserved-feeds) are refused with `400`.

!!! warning "The name is the key"
    Anyone who knows a feed's name can read it, post to it, edit and delete its notes, and delete the feed. Pick one that's hard to guess, like `homelab-7f3k2q9x4m8wz`, and share the [read link](read-links.md) instead of the name.

## Feed settings in the web UI

![A feed's settings page: Profile, Sharing and Danger zone as groups of rows](../assets/screenshot-settings-light.png#only-light)
![A feed's settings page: Profile, Sharing and Danger zone as groups of rows](../assets/screenshot-settings-dark.png#only-dark)

The cog in the feed's details opens `/<feed>/settings`, once the feed has a note:

- **Profile:** the feed's **Title**, **Description** and **Title image**. An image chosen there is the feed's own: it shows in the header but is no post, so it stays out of the notes, RSS and the APIs' lists, and choosing another deletes it. A picture already posted can be the title image too (`image` below); it stays a post. They are shown in the feed's details, in the read-only view and as the RSS channel's title, description and image, so anyone with the read link sees them. The name never changes. With [sign-in](../self-hosting/sign-in/index.md) on, **Show who posted** hides the sender from readers.
- **Sharing:** the read link and the RSS link with copy buttons, a ready-to-copy `curl` command for this feed, and the **Read id** field (see [Choosing a feed's read id](read-links.md#choosing-a-feeds-read-id)).
- **Privacy & access:** on a protected feed you have unlocked, change or remove the [feed password](feed-passwords.md#in-the-web-ui) and lock this browser; on an open feed, [set one](feed-passwords.md#a-password-for-an-open-feed).
- **Danger zone:** **Delete this feed** removes the feed with all its notes, its settings, its password and its read link, for good. You confirm by typing the feed's name.

!!! note "On notefeed.me"
    A **License** row shows the feed's tier, *Free tier · N of 100 notes* with a meter or the licensed state, and is where a license key is entered, moved to another feed or taken off. See [Free tier and licenses](../hosted/licenses.md#entering-the-key).

Anyone who can open the feed can change its settings and delete it; the read-only view has no settings.

## Feed settings in the API

`GET /api/v1/feeds/<feed>` answers the feed's `name`, `title`, `description`, `show_sender`, `image_url`, `protected` and `read_url`. `PUT` on the same URL sets the title (at most 100 characters) and the description (at most 500), both at once; `image` names one of the feed's posted pictures as the title image (empty removes it), `show_sender` and `read_id` are optional. To upload a title image that is no post, `PUT /api/v1/feeds/<feed>/image` with the image as the body and its `Content-Type`; `DELETE` on the same URL removes it:

```sh
curl -X PUT -H "Content-Type: application/json" \
  -d '{"title": "Homelab", "description": "Deploys and alerts"}' \
  https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

`DELETE` removes the feed for good and answers `204`:

```sh
curl -X DELETE https://notes.example.com/api/v1/feeds/homelab-7f3k2q9x4m8wz
```

- **Who may:** whoever may post to the feed, with the same passwords. The read link can neither change settings nor delete.
- **The feed must exist:** it is created by its first note, or without one by `POST /api/v1/feeds/<feed>`, and `404` before that.
- **The name is free again** at once after a delete. A feed created there later is a new feed with a new read link; the old link stays empty for good.
- **Settings are public to readers,** through `GET /api/v1/read/<read id>` too.
- The errors are in the [REST API](../integrations/api.md).
