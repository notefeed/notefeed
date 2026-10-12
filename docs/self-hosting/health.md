# Health check

`GET /health` says whether the instance can answer. It is always on, needs no password or token (also on an instance with `NOTEFEED_PASSWORD`), and is never cached.

| Answer | Meaning |
|---|---|
| `200` `{"status":"ok","checks":{…}}` | The app runs and every part it needs answered. |
| `503` `{"status":"unavailable","checks":{…}}` | The app runs, but a part did not answer. `checks` says which; the reason is in the [logs](logs.md) (`"component":"health"`), never in the answer. |

No answer at all means the app itself is down.

`checks` has one entry per part, each `ok` or `unavailable`:

| Check | What is asked |
|---|---|
| `storage` | The [storage](storage.md), by one lookup by name. With a database it fails when the database is away. With the file system the lookup is answered from memory once the app has started, so there it says little more than that the process is up and serving. |
| `images` | The [image store](storage.md#image-bytes-outside-the-database), only when `NOTEFEED_IMAGES` is `fs` or `s3`. For `s3`: one listing of at most one object, which needs the endpoint, the keys and the bucket to be right; it waits 3 seconds at most and is not repeated. For `fs`: the folder can be read. Nothing is written. |

With the image store away, text notes still work, but pictures do not, and the answer is `503` all the same: a health check has one status.

Every probe is one small query, and one request to the object store where there is one: fine every few seconds for a store you run yourself. With a provider that bills requests, a probe every 30 seconds is about 2,900 listings a day.

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
