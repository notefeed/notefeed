# Health check

`GET /health` says whether the instance can answer. It is always on, needs no password or token (also on an instance with `NOTEFEED_PASSWORD`), and is never cached.

| Answer | Meaning |
|---|---|
| `200` `{"status":"ok"}` | The app runs and its [storage](storage.md) answered a lookup. |
| `503` `{"status":"unavailable"}` | The app runs, but the storage did not answer: the database is away, or the data cannot be read. The reason is in the [logs](logs.md) (`"component":"health"`), never in the answer. |

No answer at all means the app itself is down. The check is one lookup by name, so probing every few seconds costs nothing. With the file system as storage that lookup is answered from memory once the app has started, so `503` mostly shows a database that is away; with files, the check tells you that the process is up and serving.

The probe is logged at `debug`, like the scrape of `/metrics`, so it does not fill the request log. `health` is a reserved feed name.

## Docker

The image has a `HEALTHCHECK` that asks `/health` every 30 seconds (on `PORT`, from inside the container), so there is nothing to set up: `docker ps` shows `(healthy)` or `(unhealthy)`, and a monitor that reads Docker's health status, such as Beszel, shows the same. After three failed checks in a row the container is `unhealthy`; the first 20 seconds after a start do not count.

Docker only marks the container; it does not restart it. Other services can wait for it with `depends_on: { notefeed: { condition: service_healthy } }`. To change the timing or turn the check off, override it in Compose:

```yaml
services:
  notefeed:
    healthcheck:
      interval: 10s      # or: disable: true
```

## Uptime monitors and reverse proxies

Point the monitor at `https://<your host>/health` and alert on anything but `200`. A reverse proxy or load balancer that probes its upstream takes the same path.
