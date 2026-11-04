# Health, logs and metrics

## Health check

`GET /health` says whether the instance can answer. It is always on, needs no password and is never cached: `200` with `{"status":"ok","checks":{…}}` when the app and every part it needs answered, `503` with `"status":"unavailable"` when a part did not. `checks` has `storage` and, with an [image store](storage.md#image-bytes-outside-the-database), `images`; the reason is in the logs, never in the answer. Point an uptime monitor or a load balancer's probe at it and alert on anything but `200`.

### Docker

The image has a `HEALTHCHECK` that asks `/health` every 30 seconds, so `docker ps` shows `(healthy)` or `(unhealthy)` and other services can wait with `depends_on: { notefeed: { condition: service_healthy } }`. Docker only marks the container; it does not restart it. Override the timing, or turn it off, in Compose:

```yaml
services:
  notefeed:
    healthcheck:
      interval: 10s      # or: disable: true
```

## Logs

notefeed writes JSON lines to standard output: `level`, `time`, `component`, a fixed `msg` and fields with the details. Read them with `docker compose logs -f notefeed`, filter with `grep '"level":"warn"'` or `jq`, or pipe through `npx pino-pretty` for lines a person can read. `NOTEFEED_LOG_LEVEL` sets how much: `error`, `warn`, `info` (the default), `debug` or `silent`.

### The request line

Every request gets one line when its answer is done:

```json
{"level":"info","time":"2026-10-09T10:00:00.120Z","component":"http","req":"q0Zr1fJx","method":"POST","route":"/api/v1/feeds/[feed]/notes","status":201,"ms":12,"bytes":412,"msg":"request"}
```

`req` is a random id shared by every line logged while the request was answered; `route` is the pattern of the route, never the path asked for; `outcome` names the reason of a refusal (`auth`, `rate_limited`, `not_found` and so on, the `code` of the API's error body). Static files, `/metrics` and `/health` are logged at `debug`. `NOTEFEED_LOG_REQUESTS=0` turns the line off.

With it you do not need your reverse proxy's access log, and the proxy's log is the risky one: the path holds the feed name, which works like a password, next to the client's address. Turn it off, or make it leave out the path and the address.

### What is never logged

Note content, feed names (a reserved feed's name, which you chose, is the one exception), passwords, tokens, secrets, cookies, e-mail addresses, names, client IP addresses, and request headers or bodies. A feed is logged as `feed created` or `feed deleted`, a note as `note posted` or `note deleted` with its kind and size, a sign-in as `sign-in succeeded` with the provider only. Warnings at start-up name misconfiguration: a sign-in provider with a variable missing, reserved feeds without a password, a log level that isn't one. An unexpected failure is `request failed` at `error`, with paths below the data folder replaced by `<path>`.

## Metrics

With `NOTEFEED_METRICS=1`, `GET /metrics` serves the Prometheus text format; with `NOTEFEED_METRICS_TOKEN` set, it needs `Authorization: Bearer <token>`. It answers two questions with data: is reading a feed slow enough to be worth another storage, and how is the instance used? The counters live in memory and start at 0 on restart, so query with `rate()` or `increase()`.

| Metric | What it shows |
|---|---|
| `notefeed_request_duration_seconds` | A histogram of request times by `kind` (the API operation id, `rss`, `feed_page`, …), `status` class and `feed_size` (`lt10`, `lt100`, `lt1000`, `gte1000`). |
| `notefeed_request_dir_reads`, `notefeed_request_file_reads` | Histograms of the directory and file reads one request made, on file storage. |
| `notefeed_parse_*` | The worker that reads a text posted with pictures: duration, timeouts, waiting. |
| `notefeed_images_*` | What the last [image store clean-up](storage.md#cleaning-up-the-image-store) found. |
| `notefeed_nodejs_*`, `notefeed_process_*` | Event-loop lag, memory, CPU, garbage collection. |

**Usage** ([ADR 0039](../adr/0039-usage-metrics-for-the-operator.md)): what the instance holds, counted at most every 5 minutes (a pass over every feed), never per scrape. A scrape that finds the count older starts the next one and answers with the last; until the first count is done they are absent.

| Metric | What it shows |
|---|---|
| `notefeed_feeds`, `notefeed_feeds_protected`, `notefeed_feeds_with_read_link` | Feeds, protected feeds, feeds that have a read link. |
| `notefeed_feeds_active{within="1d"\|"7d"\|"30d"}` | Feeds with a note written (posted or its content replaced) within that time. |
| `notefeed_notes{kind}`, `notefeed_notes_bytes{kind}` | Stored notes and their bytes, by kind (`markdown`, `image`). For images the bytes are wherever the image store keeps them. |
| `notefeed_feeds_free_cap{notes="near"\|"at"\|"over"}` | With licensing on: feeds by their markdown notes against `NOTEFEED_FREE_NOTE_CAP`. `near` is 80% of it or more, `at` is the cap (a free feed there drops its oldest note with each new one), `over` is more (a license, or one that lapsed since). |
| `notefeed_licenses{state="active"\|"unattached"\|"lapsed"}` | With licensing on: licenses paid and on a feed, paid with the key not entered on one, and lapsed (by the provider or because the paid period ended). |
| `notefeed_database_size_bytes`, `notefeed_database_connections` | On a database: its size on disk; on PostgreSQL also its open connections (from every client, not only notefeed). |
| `notefeed_usage_counted_timestamp_seconds`, `notefeed_usage_count_duration_seconds` | When the last count ran and how long it took. |

**Events**, counted as they happen, for trends:

| Metric | What it counts |
|---|---|
| `notefeed_feeds_created_total{protected}` | Feeds created, protected from the start or not. |
| `notefeed_feeds_deleted_total{reason="deleted"\|"takedown"}` | Feeds deleted by their owner, or taken down by the operator. |
| `notefeed_notes_posted_total{kind}` | Notes posted. |
| `notefeed_notes_edited_total{kind,what="content"\|"meta"}` | Notes whose content was replaced, or whose title or alt text changed. |
| `notefeed_notes_deleted_total{kind,reason="deleted"\|"free_cap"\|"takedown"}` | Notes deleted by a writer, dropped past the free tier's cap, or taken down by the operator with their post. |
| `notefeed_license_events_total{event="bought"\|"attached"\|"renewed"\|"lapsed"}` | License events from the payment provider's webhook and from entering a key. A license that ends because its period ran out, with no webhook, shows only in `notefeed_licenses`. |

No feed name, read id, note text, sender, license key or address is ever a label or a value: the usage metrics are counts over all feeds. A rule of thumb: the 95th percentile of `feed_page` over 200 ms for feeds under 1000 notes means reading notes is worth optimising; look at a few days of real use first.

### Scraping

```yaml
scrape_configs:
  - job_name: notefeed
    metrics_path: /metrics
    authorization:
      credentials: <the value of NOTEFEED_METRICS_TOKEN>   # leave out without a token
    static_configs:
      - targets: ["notefeed:3000"]
```

Telegraf's `inputs.prometheus` takes the same endpoint for InfluxDB. A starter Grafana dashboard (import it, pick the Prometheus data source): [grafana-notefeed.json](../assets/grafana-notefeed.json). Its panels are `feed_page` p95 by feed size, requests per second by kind, reads per request, texts refused for time, event-loop lag and memory.
