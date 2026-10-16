# notefeed

notefeed is a small inbox for short markdown notes. You post notes to a named feed from scripts over HTTP, or by hand in a web UI, and read them back as RSS. Each note is a plain file on disk, `.md` or an image, exactly as posted, with its metadata in a small `.json` file next to it; or a row in SQLite or PostgreSQL if you prefer a database.

It exists because dashboards like [Glance](https://github.com/glanceapp/glance) and Dynacat can *read* RSS but have nowhere to *post* to. A backup job, a deploy script or a cron check can drop a note into notefeed, and it shows up on the dashboard a few minutes later.

![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-light.png#only-light)
![A notefeed feed page: a header with read-only, RSS and settings buttons, a compose box, and notes grouped by day](assets/screenshot-dark.png#only-dark)

notefeed is private by default and stores nothing about a person. [Sign-in with a verified sender](self-hosting/sign-in/index.md) is opt-in.

## Two ways to use it

- **Use notefeed.me.** Nothing to install: open [notefeed.me](https://notefeed.me), pick a feed name and post. Every feed starts on the free tier; a license lifts it. Start with [On notefeed.me](get-started/notefeed-me.md), then read [what notefeed.me is](hosted/index.md) and the [free tier and licenses](hosted/licenses.md).
- **Run your own.** One container with Docker Compose, the notes as plain files on your disk, every feature on, no free tier. Start with [On your own server](get-started/own-server.md), then [Self-hosting](self-hosting/configuration.md).

Both run the same software, and everything under [Using notefeed](using/web-ui.md) and [Integrations](integrations/clients.md) applies to both. Where a page differs on notefeed.me, a box titled *On notefeed.me* says so.

## Where to go next

- **Get started:** [On notefeed.me](get-started/notefeed-me.md) and [On your own server](get-started/own-server.md) post a first note; [Concepts](get-started/concepts.md) explains feeds, names and read links; [Compared to other tools](get-started/comparison.md) says when to use notefeed, ntfy or both.
- **Using notefeed:** the [web UI](using/web-ui.md), [posting notes](using/posting.md), [pictures](using/pictures.md), [feeds](using/feeds.md) and how to [read them back](using/read-links.md) in Glance, Dynacat and other readers.
- **Integrations:** [client libraries](integrations/clients.md) and the [command line](integrations/cli.md), the [REST API](integrations/api.md) and [MCP](integrations/mcp.md) for AI assistants.
- **notefeed.me:** [what it is](hosted/index.md), who runs it and where your data is; the [free tier and licenses](hosted/licenses.md).
- **Self-hosting:** [configuration](self-hosting/configuration.md), [passwords and access](self-hosting/access.md), a [reverse proxy](self-hosting/reverse-proxy.md), [storage](self-hosting/storage.md), [backups](self-hosting/backups.md), [health, logs and metrics](self-hosting/operating.md) and [upgrading](self-hosting/upgrading.md).
