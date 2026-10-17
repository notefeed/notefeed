# On notefeed.me

[notefeed.me](https://notefeed.me) is notefeed run as a service: nothing to install and no account to make. Open it, pick a feed name and post. To keep the notes on your own disk, run [your own server](own-server.md) instead.

**1. Pick a feed name.** Open [notefeed.me](https://notefeed.me); it suggests a random one, such as `homelab-7f3k2q9x4m8wz`. The name is what lets someone read and post, and the whole internet can reach notefeed.me, so take a long one nobody can guess. Write a note in the box, or post the first one from a shell:

```sh
curl -H "Content-Type: text/markdown" --data-binary $'# Hello\nMy first note.' https://notefeed.me/homelab-7f3k2q9x4m8wz
```

**2. Read it back.** The answer holds the feed's `read_url`, a read-only RSS link that never shows the feed's name. Add it to any feed reader or dashboard; see [Read links](../using/read-links.md).

**3. Post from your scripts.** The [command line](../integrations/cli.md) and the [client libraries](../integrations/clients.md) take the server and the feed from the environment (an AI assistant posts over [MCP](../integrations/mcp.md) instead):

```sh
export NOTEFEED_URL=https://notefeed.me NOTEFEED_FEED=homelab-7f3k2q9x4m8wz
notefeed post "Backup done, 12 GB in 4 min"
```

Wherever these docs say `https://notes.example.com`, use `https://notefeed.me`.

## What differs from your own server

Every feed on notefeed.me starts on the **free tier**: it keeps its newest 1000 notes, and has no pictures and no feed password. A [license](../hosted/licenses.md) for the feed lifts that. Everything else works as described in [Using notefeed](../using/web-ui.md) and [Integrations](../integrations/clients.md); where a page differs on notefeed.me, a box titled *On notefeed.me* says so.

Who runs the service, where the notes are and how to report content is on [the notefeed.me page](../hosted/index.md).

**Next:** [Concepts](concepts.md) explains feeds, names and read links.
