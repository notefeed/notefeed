# Rate limits and caps

Each client may post, edit or delete `NOTEFEED_RATE_LIMIT` notes per minute (60 by default), from the API and the web UI together; wrong passwords have their own budget of the same size. Over it, notefeed answers `429` with a `Retry-After` header. On an instance that sells licenses, writes to a feed with an active license don't count (ADR 0046); wrong passwords and keys always do. The counters live in memory and reset on restart.

!!! warning "Behind a reverse proxy, set `NOTEFEED_TRUST_PROXY=1`"
    Without it notefeed can't see a client's address, so **all clients share one bucket**: one busy script slows everyone down, and a stranger's wrong password guesses can lock the owner out for a minute. With it, the last address in `X-Forwarded-For` is the client. Set it only when the proxy sets that header and clients can't reach notefeed directly. See [Reverse proxy](reverse-proxy.md).

On a public open instance, cap how much space strangers can take:

```yaml
environment:
  NOTEFEED_MAX_FEEDS: 100
  NOTEFEED_MAX_NOTES_PER_FEED: 1000
  NOTEFEED_MAX_IMAGE_BYTES: 5242880      # 5 MiB per picture as sent; 10 MiB by default and at most
  NOTEFEED_MAX_IMAGES_PER_FEED: 200
```

Over a cap, posting answers `507`; over the image size, `413`. The caps are checked, not locked, so several posts at the same moment can overshoot by a few. Delete notes or feeds to make room, see [Deleting notes and feeds](deleting.md).

## No pictures at all

`NOTEFEED_IMAGE_UPLOADS=0` refuses every picture with `403` (`images_off`), from the API, MCP and the web UI alike, and the compose box shows no **Add image** button. Pictures already stored keep being served, and deleting and the operator's [clean-up](storage.md#cleaning-up-the-image-store) keep working.
