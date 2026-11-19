# MCP

notefeed has an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`, so AI assistants such as Claude can post notes to a feed and read them back. The feed name is a parameter of each tool.

| Tool | What it does |
|---|---|
| `post_note` | Posts a markdown note. Takes `feed` and `markdown`, optionally `title`, `sender` (who posted it, [as shown on the note](../using/posting.md#sender)), `name` (a [file name](../using/read-links.md#files-by-name) the read link serves the newest note under), `tags`, `date` (any time from 1970 to 9999; a future time schedules the note), `draft` (a [draft](../using/posting.md#drafts): readers do not see it until it is published), `read_id` (for the feed this post creates), `password` and `attachments`, a list of `{ name, type, data, alt }` with base64 pictures, or `{ name, upload_id, alt }` with [uploads](#sending-pictures-as-uploads), [posted with the note](../using/pictures.md#posting-a-note-with-its-pictures); write `![](name)` in `markdown` where one goes. |
| `create_feed` | Creates a feed without a note, to reserve its name. Takes `feed`, optionally `password` and `read_id`; on notefeed.me it needs the client's [account](#as-an-account) with room in its license. A feed that exists is refused. |
| `list_notes` | A feed's notes, newest first, without their text, each with its `date` (and `scheduled: true` when the date is in the future, `draft: true` for a draft: readers do not see either yet). Takes `feed`, optionally `limit` (1–100), `before` and `tag`. |
| `get_note` | One note with its content, its `date`, `scheduled` and `draft`. Takes `feed` and `id`, optionally `picture`: `true` brings a picture note's image along, also a draft's, so its pictures can be checked before it goes out. |
| `edit_note` | Replaces a note's markdown, sets its title, its `sender` (empty removes it), its `tags` (the whole list) its `date` (also in the future, which schedules the note) or `draft` (`false` publishes a draft, `true` hides the note from readers again); its id stays. |
| `delete_note` | Deletes a note for good. Marked as destructive, so clients can ask you first. |
| `set_feed_image` | Sets the feed's title image from base64 `data` and its `type`, or from an `upload_id`. It is the feed's own image, no post; a previous one set this way is deleted. Remove it with `update_feed` `image: ""`. |
| `get_feed`, `update_feed`, `delete_feed` | The feed's title, description, title image, read link and the link to the [iPhone Shortcut](../using/sharing.md#iphone) (`shortcut_url`); change any of them (and the read id; `name` [renames the feed](../using/feeds.md#renaming-a-feed), after which every call uses the new name), `sender_name` (the owner's name on their notes), `licensed` (notefeed.me: puts the owner's feed under the account's license, or takes it off); `new_password` sets or changes its password; delete the feed with everything in it. |
| `get_licenses` | On notefeed.me: what a license costs per feed, the license page (`buy_url`) and the account page where a license is managed (`manage_url`). |
| `get_license`, `buy_license`, `change_license_units` | On notefeed.me, for the client's [account](#as-an-account): its [license](../hosted/licenses.md) (subscriptions, how many feeds it covers, which), a checkout URL for `units` feeds per `period`, and a subscription's new number of feeds. |
| `create_upload` | Makes a short-lived URL to send one file to from a shell, so its bytes never pass through the conversation: `feed`, `type`, optionally `size` and `password`. See [Sending pictures as uploads](#sending-pictures-as-uploads). |
| `post_file` | Posts a file as a note: `feed` with `type` (markdown or a picture type) and base64 `data`, or with an `upload_id` instead; optionally `title`, `sender`, `alt`, `name`, `tags`, `date` and `draft`, as for a REST post. |
| `list_feeds` | The feeds of the [account](#as-an-account) the client signed in as. |
| `claim_feed` | Makes a feed the account's own: a protected one with its `password`, an open one with the password it gets now. |
| `list_feed_passwords`, `add_feed_password`, `revoke_feed_password` | An owned feed's [named passwords](../using/feed-passwords.md#a-feed-with-an-owner): list them, add one (`name`; the password comes back once), revoke one by its `id`. Only for the feed's owner. |
| `create_account_token`, `list_account_tokens`, `revoke_account_token` | The account's [tokens](../self-hosting/accounts.md#account-tokens) for scripts: make one (`name`, `scope` `read` or `read+write`, `days`; shown once), list them, revoke one. |

Every tool's answer carries `guidance`, a short list of what to tell you or do next, worked out from what the call did: that a post is a draft and how to publish it, that a renamed feed's old name must change in scripts, that an old read link stops working. The assistant sees it even when its client leaves out the tool descriptions.

## Sending pictures as uploads

A tool call is text the model writes, so a picture as base64 in `data` costs the model every byte: a phone photo is about a million characters. An upload keeps the bytes out of the conversation:

1. `create_upload` with the feed and the file's `type` answers with an `upload_id` and an `upload_url`.
2. The assistant sends the file from a shell: `curl -sS --fail-with-body -T photo.jpg "<upload_url>"`.
3. `post_file`, a `post_note` attachment or `set_feed_image` takes `upload_id` instead of `data` (and `type` may be left out).

The URL carries only a random token, never the feed's name or a password, and takes one file of at most the [image limit](../self-hosting/limits.md) (markdown: 100 KB) within 15 minutes; the post runs every check a post with `data` runs, then the upload is gone. A post that is refused keeps the upload for another try until it expires. Making an upload needs the feed's access and counts as a post against the rate limit; at most 10 uploads wait for one feed and 10 for one sender (the account, else the feed's password, else the address), and at most 32 files wait on the server (a file sent when they do is `429`; try again later). Waiting files are kept in the data directory's `.uploads` folder and are lost on a restart. This works wherever the assistant can run a shell that reaches the notefeed instance: Claude Code, or a sandbox that allows the instance's address.

**From claude.ai**, the upload runs in its code execution sandbox: a file attached to the chat is under `/mnt/user-data/uploads/`, and `curl` sends it from there. The sandbox reaches the internet through a proxy that by default lets only a few domains through (mostly package registries), so a `curl` to your instance is refused before notefeed sees it. Allow your instance's domain (for notefeed.me: `notefeed.me`) in claude.ai's settings for code execution's network access; on a Team or Enterprise plan an admin may have to. The tool's guidance tells the assistant to say so when the `curl` is refused. Without code execution, an assistant in claude.ai has only base64.

The tools follow the same rules as the [API](../using/posting.md): size limit, rate limit, caps, and the first post creates the feed (or `create_feed`, without a note). Anyone who can post to a feed can use every tool on it, and a deleted note cannot be brought back, so think before giving an assistant a feed it should only add to. The endpoint speaks MCP 2026-07-28 and nothing older.

## Claude Code

```sh
claude mcp add notefeed --transport http https://notes.example.com/mcp
# on a locked instance:
claude mcp add notefeed --transport http https://notes.example.com/mcp --header "Authorization: Bearer <password>"
```

## Claude.ai and Claude Desktop

Add a custom connector with the URL `https://notes.example.com/mcp`. On an instance the password locks, the connector opens notefeed's login page: check that it names the client, enter the instance password and press **Allow**. On an instance with [accounts](../self-hosting/accounts.md), it signs in as your account ([below](#as-an-account)). Both need the instance's public `https://` address in `PUBLIC_URL`; see [OAuth for MCP clients](../self-hosting/access.md#oauth-for-mcp-clients). A connector that offers **Request headers** can instead send the password as `Authorization: Bearer <password>`.

For writing a note with a review step before it is posted, see the [agent skills](skills.md).

## As an account

On an instance with [accounts](../self-hosting/accounts.md), an MCP client signs in as an account. Add notefeed with its URL alone (`claude mcp add notefeed --transport http https://notes.example.com/mcp`, or a connector): the client opens the authorize page, which asks you to **Sign in to your account first** (number and recovery key, a passkey or your identity provider) and then shows **Allow as your account** and **Deny**. The client then acts as the account: feeds it creates are the account's, its notes carry [the owner's name](../using/posting.md#sender), and the account tools above work. Once you allowed a client, it isn't asked again. Every call is checked against the account: deleting it, or taking its person off the identity provider's allow-list, ends the client's access at once. An account token is never accepted on MCP. On an open instance, a client without a sign-in still works as no one, like any open instance: it posts to and edits feeds by their name or password. Calling a tool that needs an account (its feeds, license, tokens or feed passwords, or `update_feed` with `licensed` or `sender_name`) is what asks it to sign in: the client then opens the authorize page.

## Feeds with a password

Every tool takes an optional `password` for a [protected feed](../using/feed-passwords.md); `post_note` with one creates the feed protected. It is not remembered between calls and is part of the conversation, so tell the assistant only passwords you would give that service.

## Telling the assistant which feed

Put the feed name in a project or custom instruction: "Post notes to the notefeed feed `homelab-7f3k2q9x4m8wz`."

!!! warning "The feed name works like a password"
    Anyone who knows it can read the feed, post to it, edit and delete its notes and delete the feed, and the assistant sees it. Don't give it a name you wouldn't share with that service, and don't point it at a feed strangers can post to: notes it reads are text from your feed.
