---
name: post-to-notefeed
description: Post to notefeed with a review step: write a note for a notefeed feed (a blog post, release notes, a status update, a newsletter, an announcement), show it as a draft, revise it until the user approves, and only then post it. Use when the user asks to write, draft, post or publish something "on notefeed" or to one of their feeds, to turn a conversation, notes or a link into such a note, to show, revise or publish a draft, to fix a note already posted, or to set up which feeds to post to. Other skills can use it for the writing and posting and add their own steps.
---

# Post to notefeed

A note is written for readers, so it goes out only after the user has read it. The flow is the
same whatever the note is: **draft, show, revise, post on approval.**

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

2. **Find the feed.** The user's feeds are in `~/.config/notefeed/feeds.json` (or the path in
   `$NOTEFEED_FEEDS`), each under a short name of the user's choosing. Without a file system
   (claude.ai), they come from the project instructions in the same shape.

   ```json
   {
     "feeds": {
       "blog": { "url": "https://notefeed.me", "feed": "blog-…", "read_id": "you", "drafts_feed": "drafts-…" },
       "homelab": { "feed": "homelab-…", "read_id": "homelab-you" }
     }
   }
   ```

   | Key | Meaning |
   |---|---|
   | `url` | the instance, default `https://notefeed.me` |
   | `feed` | the feed name the note is posted to |
   | `read_id` | the feed's read id; readers see it at `<url>/r/<read_id>` |
   | `drafts_feed` | optional: a second feed for drafts, so the user (or someone they send its read link to) sees a draft as readers will. Without it the draft lives in the conversation |

   Use the feed the request or the calling skill names; with only one, use it; otherwise
   ask. None fits, or no `feeds.json` yet: see *Add a feed*. This skill writes the file
   itself; the user never has to edit it.

3. **Feed names are passwords.** Anyone who knows one can post to the feed and delete its
   notes. Never write `feed` or `drafts_feed` into a reply, a note, a commit or any file but
   `feeds.json`, unless the user asks for it. Links you show use the read link.

4. **Other instructions add to this skill.** A skill that calls this one, or the user's own
   instructions, may set the style, tags the note must carry, where readers find it (a website
   that shows the feed) and what to do after posting (rebuild that website). Follow them; they
   win over the defaults here.

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
   digits, `-`, `_`, `.` and `:`: the tags other instructions require, plus 2 to 4 topic tags,
   reusing the feed's existing ones (`list_notes` on `feed` shows them).
3. `post_note` on `feed` with the `title`, `markdown`, `tags` and attachments. On the feed's
   very first note, add `read_id` (the feed is created by its first note).
4. Delete the draft note: `delete_note` on `drafts_feed`.
5. Give the user the read link `<url>/r/<read_id>/<id>`, then hand back to the calling skill
   or the user's instructions for what comes after.

## Fix a note already posted

The same review: show the change, then `edit_note` on `feed` once approved. The id, address and
place in the feed stay. Tags can't be edited: if one is wrong, say so and offer to delete and
post again, which gives the note a new id and date and breaks links to the old one.

## List

`list_notes` on `feed` for what's posted, on `drafts_feed` for open drafts, newest first.

## Add a feed

**A feed the user already has:** ask for a short name, the feed name and the instance; get its
read id with `get_feed`; ask whether they want a drafts feed (made as below). Write the entry
into `feeds.json` and confirm with the read link, never by repeating the feed name.

**A new feed:** ask in one go: a short name for it (`blog`, `releases`), the instance, the read id (3 to 64
characters of `a-z`, `0-9`, `-`, `_`; the public part of the address), the feed's title and
description, and whether they want a drafts feed.

1. **Make the feed names yourself**, random, and write them into `feeds.json` **before**
   posting anything, so a name is never lost:

   ```bash
   umask 077; mkdir -p ~/.config/notefeed
   F="blog-$(openssl rand -hex 8)"; D="drafts-$(openssl rand -hex 8)"
   ```

   Merge into an existing file and keep it at mode 600. On claude.ai, give the user the names
   for their password manager and the project instructions.
2. A feed exists from its first note, posted through this skill with `read_id`. If the read id
   is taken, ask for another. Then `update_feed` with the title and description.
3. Tell the user the read link and its RSS (`<url>/r/<read_id>/feed.xml`), that feed names work
   like passwords, and on notefeed.me that a feed without a license keeps its newest 100 notes.
4. A website can show the feed without any secret through the read API:
   `GET <url>/api/v1/read/<read_id>/notes?limit=100`, paged with `before=<next>`. Each note has
   `title`, `content` (markdown), `tags`, `created_at` and `id`.

## Style

The default voice; other instructions win where they differ.

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
