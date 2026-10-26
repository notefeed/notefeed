---
name: post-with-review
description: Write a note for a notefeed feed - a blog post, release notes, a status update, a newsletter, an announcement - show it as a draft, revise it until the user approves, and only then post it, optionally running a command afterwards (such as rebuilding a website that shows the feed). Use when the user asks to write, draft, post or publish something "on notefeed", "on my blog" or to a named feed, to turn a conversation, notes or a link into such a note, to show, revise or publish a draft, to fix a note already posted, or to set up where such notes go.
---

# Post with review

A note is written for readers, so it goes out only after the user has read it. The flow is the
same whatever the note is: **draft, show, revise, post on approval, then the follow-up.** The
places the user posts to are *targets* in a small config file; one may be a blog, another a
changelog or a team update feed.

## Before anything

1. **The notefeed MCP tools** (`post_note`, `edit_note`, `get_note`, `list_notes`,
   `delete_note`, `update_feed`) must be there. If not, tell the user to add the server and
   start a new session:

   ```bash
   claude mcp add notefeed --transport http https://notefeed.me/mcp -s user
   ```

   For their own instance they use its address; on a locked instance they add
   `--header "Authorization: Bearer <password>"`. On claude.ai it is a custom connector with
   the address `https://notefeed.me/mcp`.

2. **Read the config**: `~/.config/notefeed/targets.json`, or the path in
   `$NOTEFEED_TARGETS`. Without a file system (claude.ai), the same values come from the
   project instructions. No config, or no target that fits: see *Set up a target*.

   ```json
   {
     "targets": {
       "blog": {
         "url": "https://notefeed.me",
         "feed": "blog-…",
         "read_id": "you",
         "drafts_feed": "drafts-…",
         "link": "https://example.com/blog/{slug}",
         "after_post": "gh workflow run pages.yml -R you/example-site",
         "default_lang": "en",
         "style": "~/notes/blog-style.md",
         "tags": ["blog"]
       }
     }
   }
   ```

   | Key | Meaning |
   |---|---|
   | `url` | the instance, default `https://notefeed.me` |
   | `feed` | the feed name the note is posted to |
   | `read_id` | the feed's read id; readers see it at `<url>/r/<read_id>` |
   | `drafts_feed` | optional: a second feed for drafts, so the user (or someone they send the read link to) can review a draft as it will look. Without it the draft lives in the conversation |
   | `link` | optional: where readers find a note when the feed is shown elsewhere, with `{slug}` and `{id}` |
   | `after_post` | optional: a shell command to run after posting or editing, such as a website rebuild |
   | `default_lang` | optional: the language notes are written in |
   | `style` | optional: the user's style guide, a file or a few lines; it wins over the defaults below |
   | `tags` | optional: tags every note of this target gets |

   With one target, use it. With several, pick the one the request names ("on my blog"), or
   ask.

3. **Feed names are passwords.** Anyone who knows one can post to the feed and delete its
   notes. Never write `feed` or `drafts_feed` into a reply, a note, a commit or any file but the
   config, unless the user asks for it. Links you show use the read link or `link`.

## Write

1. **Gather the material** the user pointed at: this conversation, a repository, docs, a link
   (fetch it), their notes. If a notes or memory tool is connected, look up what the user
   already wrote on the topic. Check names, versions, numbers and links against the source;
   don't invent any.
2. **Ask only what you can't decide**: the angle, when there are several, or a fact you can't
   check. Otherwise write.
3. **Write the note** in the style below, adapted to what it is: a blog post tells a story,
   release notes list what changed for users, a status update says what happened and what's
   next. A `title` (one line, at most 100 characters) and markdown without a top-level heading,
   because the title is shown above it.
4. **Make it a draft.** With `drafts_feed`: `post_note` on it with the `title`, `markdown` and
   images as `attachments` (referenced as `![](name)`), no tags. Without: keep it in the
   conversation.
5. **Show it**: the title and the whole text in the reply, so the user can review it in place,
   plus the draft's read link (`<url>/r/<drafts read id>/<id>`, from the answer's `read_url`)
   when there is one. Say what they can do: ask for changes, or say "post it".

## Revise

Change what the user asked for and nothing else. With a draft note: `edit_note` on
`drafts_feed` with the id and the new `markdown` (and `title`); the id and read link stay. Show
the changed parts, or the whole note when asked. Every round ends with the question whether to
post.

## Post, after approval

**Only when the user says to post** ("post it", "publish", "ship it"). Approval of one note is
not approval of the next, and changes after the approval need a new one.

1. With a draft note, read it back with `get_note`, so what goes out is what they reviewed.
2. **Choose the tags now: they can't be changed after posting.** Up to 10, lowercase letters,
   digits, `-`, `_`, `.` and `:`. The target's `tags`, 2 to 4 topic tags (reuse the feed's
   existing ones: `list_notes` on `feed` shows them), and `lang:<code>` when the note is not in
   `default_lang`. When `link` uses `{slug}`: the slug is the title before its first `:`, in
   lowercase with `-` between words; add `slug:<slug>` when that makes a bad address.
3. `post_note` on `feed` with the `title`, `markdown`, `tags` and attachments. On the feed's
   very first note, add `read_id` (the feed is created by its first note).
4. Delete the draft note: `delete_note` on `drafts_feed`.
5. Run `after_post` if set; report if it fails.
6. Give the user the link: `link` filled in, else the read link `<url>/r/<read_id>/<id>`.
   Offer the next step that fits, such as an announcement elsewhere that links to it (again
   only with approval of that text).

## Fix a note already posted

The same review: show the change, then `edit_note` on `feed` once approved. The id, address and
place in the feed stay. Run `after_post`. Tags can't be edited: if one is wrong, say so and
offer to delete and post again, which gives the note a new id and date and breaks links to the
old one.

## List

`list_notes` on `feed` for what's posted, on `drafts_feed` for open drafts, newest first.

## Set up a target

Ask in one go only what you can't default: what the target is for (its key: `blog`,
`releases`), the instance, the read id (3 to 64 characters of `a-z`, `0-9`, `-`, `_`; it is
the public part of the address), the feed's title and description, whether they want a drafts
feed, and the optional keys.

1. **Make the feed names yourself**, random, and write them into the config **before**
   posting anything, so a name is never lost. With a file system:

   ```bash
   umask 077; mkdir -p ~/.config/notefeed
   F="blog-$(openssl rand -hex 8)"; D="drafts-$(openssl rand -hex 8)"   # <key>-…, drafts-…
   ```

   Write `targets.json` (mode 600), merging into an existing one. On claude.ai, give the user
   the names to keep in their password manager and the project instructions.
2. A feed exists from its first note. It starts with the first note posted through this skill
   (with `read_id`). If the read id is taken, ask for another. Then `update_feed` with the
   title and description.
3. Tell the user the read link and its RSS (`<url>/r/<read_id>/feed.xml`), that feed names work
   like passwords, and on notefeed.me that a feed without a license keeps its newest 100 notes.
4. A website can show the feed without any secret through the read API:
   `GET <url>/api/v1/read/<read_id>/notes?limit=100`, paged with `before=<next>`. Each note has
   `title`, `content` (markdown), `tags`, `created_at` and `id`.

## Style

The default voice; the target's `style` wins where they differ.

- **Voice:** first person, a person talking to a peer. Plain words, short sentences; explain a
  term the first time or link it. Concrete over grand: what it does, with an example. No
  "game changer", "seamless", "unlock", "supercharge".
- **Honest:** what doesn't work yet, what was tried and dropped, what depends on the reader's
  setup. Numbers measured, said with what they were measured on, and rounded ("> 85 %").
- **Shape:** an opening of two or three sentences on the problem in the reader's terms; `###`
  headings for sections; lists for parallel items, prose for reasoning; code only where a
  reader would copy it, complete, in fenced blocks with a language; a ` ```mermaid ` block when
  a flow reads better as a picture; images with alt text that describes them. End with where
  to get it and an invitation for feedback, not a summary.
- **Links:** a project's docs site when it has one, else its repository; a discussion, issue
  or earlier note where the reader can go deeper, instead of repeating it. Link the first
  mention of a tool, not every one.
- **Length:** as long as the material needs. A blog post is usually 500 to 1200 words, release
  notes and status updates much shorter.
