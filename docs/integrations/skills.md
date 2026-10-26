# Agent skills

A skill is a markdown file that tells an AI assistant how to do one job well. notefeed's skills work with the [MCP endpoint](mcp.md): the endpoint gives the assistant the tools, the skill the way of working.

| Skill | What it does |
|---|---|
| `post-with-review` | Writes a note for a feed (a blog post, release notes, a status update), shows it to you as a draft, changes it until you approve, then posts it and runs a follow-up command if you set one, such as rebuilding the website that shows the feed. Nothing is posted without your go-ahead. |

## Claude Code

The skills come as a plugin from this repository:

```sh
claude plugin marketplace add notefeed/notefeed
claude plugin install notefeed@notefeed
```

Then add the [MCP endpoint](mcp.md#claude-code) if you haven't, and ask, for example: "write a blog post from this session". The first time, the skill asks where notes should go and keeps that in `~/.config/notefeed/targets.json`, readable only by you, because it holds [feed names](../using/feeds.md).

## Other assistants

Each skill is one file, [`plugin/skills/<name>/SKILL.md`](https://github.com/notefeed/notefeed/tree/main/plugin/skills). Assistants that read skills take it as it is; for the others, paste it into the project or custom instructions together with where notes should go.

## Drafts

`post-with-review` can keep drafts in a second feed. Then you see a draft as readers will, and you can send its read link to someone else to review before anything reaches the real feed.

!!! warning "The assistant sees the feed names"
    The skill keeps them out of replies and files, but they are part of the conversation. Give it only feeds you would give that service; see [MCP](mcp.md#telling-the-assistant-which-feed).
