# MCP

notefeed has an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`, so AI assistants such as Claude can post notes to a feed and read them back. The feed name is a parameter of each tool.

| Tool | What it does |
|---|---|
| `post_note` | Posts a markdown note. Takes `feed` and `markdown`, optionally `title`, `name` (a [file name](../using/read-links.md#files-by-name) the read link serves the newest note under), `tags`, `date` (any time from 1970 to 9999; a future time schedules the note), `read_id` (for the feed this post creates), `password`, `license_key` (notefeed.me: licenses the feed this post creates, open or protected) and `attachments`, a list of `{ name, type, data, alt }` with base64 pictures [posted with the note](../using/pictures.md#posting-a-note-with-its-pictures); write `![](name)` in `markdown` where one goes. |
| `create_feed` | Creates a feed without a note, to reserve its name. Takes `feed`, optionally `password`, `read_id` and `license_key` (required on notefeed.me). A feed that exists is refused. |
| `list_notes` | A feed's notes, newest first, without their text, each with its `date` (and `scheduled: true` when the date is in the future: readers do not see it yet). Takes `feed`, optionally `limit` (1–100), `before` and `tag`. |
| `get_note` | One note with its content, its `date` and `scheduled`. Takes `feed` and `id`. |
| `edit_note` | Replaces a note's markdown, sets its title, its `tags` (the whole list) or its `date` (also in the future, which schedules the note); its id stays. |
| `delete_note` | Deletes a note for good. Marked as destructive, so clients can ask you first. |
| `get_feed`, `update_feed`, `delete_feed` | The feed's title, description, title image and read link; change any of them (and the read id), or put a license on the feed with `license_key` (notefeed.me; empty takes it off); `new_password` sets or changes its password; delete the feed with everything in it. |
| `recover_feed_password` | A lost password, on notefeed.me: the key of the license on the feed sets a new password (`new_password`) or, left out, removes it. A wrong key counts as a wrong password. |
| `post_file` | Posts a file as a note, as base64: `feed`, `type` (markdown or a picture type) and `data`, optionally `title`, `alt` and `name`. |

The tools follow the same rules as the [API](../using/posting.md): size limit, rate limit, caps, and the first post creates the feed (or `create_feed`, without a note). Anyone who can post to a feed can use every tool on it, and a deleted note cannot be brought back, so think before giving an assistant a feed it should only add to. The endpoint speaks MCP 2026-07-28 and nothing older.

## Claude Code

```sh
claude mcp add notefeed --transport http https://notes.example.com/mcp
# on a locked instance:
claude mcp add notefeed --transport http https://notes.example.com/mcp --header "Authorization: Bearer <password>"
```

## Claude.ai and Claude Desktop

Add a custom connector with the URL `https://notes.example.com/mcp`. On a locked instance the connector opens notefeed's login page: check that it names the client, enter the instance password and press **Allow**; with [sign-in](../self-hosting/sign-in/index.md#mcp) on, there is also a **Sign in with** button per provider. See [OAuth for MCP clients](../self-hosting/access.md#oauth-for-mcp-clients). It needs the instance's public `https://` address in `PUBLIC_URL`. A client whose callback has its own scheme, such as `cursor://`, can't log in through OAuth: give it the password as a `Bearer` header, as for Claude Code.

For writing a note with a review step before it is posted, see the [agent skills](skills.md).

## Feeds with a password

Every tool takes an optional `password` for a [protected feed](../using/feed-passwords.md); `post_note` with one creates the feed protected. It is not remembered between calls and is part of the conversation, so tell the assistant only passwords you would give that service.

## Telling the assistant which feed

Put the feed name in a project or custom instruction: "Post notes to the notefeed feed `homelab-7f3k2q9x4m8wz`."

!!! warning "The feed name works like a password"
    Anyone who knows it can read the feed, post to it, edit and delete its notes and delete the feed, and the assistant sees it. Don't give it a name you wouldn't share with that service, and don't point it at a feed strangers can post to: notes it reads are text from your feed.
