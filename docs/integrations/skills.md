# Agent skills

A skill is a markdown file that tells an AI assistant how to do one job well. notefeed's skills work with the [MCP endpoint](mcp.md): the endpoint gives the assistant the tools, the skill the way of working.

| Skill | What it does |
|---|---|
| `create-notefeed-feed` | Creates a feed: makes a random feed name and saves it before the first note, sets the read id, title and description, and on notefeed.me puts your license on it at the start. |
| `post-to-notefeed` | Writes a note for a feed (a blog post, release notes, a status update), shows it to you as a draft, changes it until you approve, then posts it. Nothing is posted without your go-ahead. Other skills can build on it: a website skill, for example, lets it write and post, then rebuilds the site that shows the feed. |

## Claude Code

The skills come as a plugin from this repository:

```sh
claude plugin marketplace add notefeed/notefeed
claude plugin install notefeed@notefeed
```

Then add the [MCP endpoint](mcp.md#claude-code) if you haven't, and ask, for example: "write a blog post from this session". The first time, `post-to-notefeed` asks which feed to post to (or creates one with `create-notefeed-feed`) and keeps it in `~/.config/notefeed/feeds.json` under a short name such as `blog`, readable only by you, because it holds [feed names](../using/feeds.md).

## Other assistants

Each skill is one file, [`plugin/skills/<name>/SKILL.md`](https://github.com/notefeed/notefeed/tree/main/plugin/skills). Every release also posts them to notefeed.me's `skills` feed, where the newest version of each is always at the same address:

```sh
curl -O https://notefeed.me/r/skills/post-to-notefeed.md
curl -O https://notefeed.me/r/skills/create-notefeed-feed.md
```

Assistants that read skills take the file as it is; for the others, paste it into the project or custom instructions together with the feed to post to. Earlier versions stay in the feed, https://notefeed.me/r/skills, one note per skill and release.

## Drafts

`post-to-notefeed` can keep drafts in a second feed. Then you see a draft as readers will, and you can send its read link to someone else to review before anything reaches the real feed.

!!! warning "The assistant sees the feed names"
    The skill keeps them out of replies and files, but they are part of the conversation. Give it only feeds you would give that service; see [MCP](mcp.md#telling-the-assistant-which-feed).
