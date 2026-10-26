# notefeed plugin for Claude Code

Skills for posting to [notefeed](https://notefeed.me) feeds. Install and usage: [Agent skills](https://docs.notefeed.me/integrations/skills/).

- [`create-notefeed-feed`](skills/create-notefeed-feed/SKILL.md): create a feed, with its secret name saved first and a license at the start.
- [`post-to-notefeed`](skills/post-to-notefeed/SKILL.md): write a note, review it as a draft, post it on approval.

Each `SKILL.md` stands alone, so it can also be used outside the plugin. `skills.test.ts` checks that the skills only name tools the MCP endpoint has.
