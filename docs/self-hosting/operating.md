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

With `NOTEFEED_METRICS=1`, `GET /metrics` serves the Prometheus text format; with `NOTEFEED_METRICS_TOKEN` set, it needs `Authorization: Bearer <token>`. It exists to answer one question with data: is reading a feed slow enough to be worth another storage? The counters live in memory and start at 0 on restart, so query with `rate()` or `increase()`.

| Metric | What it shows |
|---|---|
| `notefeed_request_duration_seconds` | A histogram of request times by `kind` (the API operation id, `rss`, `feed_page`, …), `status` class and `feed_size` (`lt10`, `lt100`, `lt1000`, `gte1000`). |
| `notefeed_request_dir_reads`, `notefeed_request_file_reads` | Histograms of the directory and file reads one request made, on file storage. |
| `notefeed_parse_*` | The worker that reads a text posted with pictures: duration, timeouts, waiting. |
| `notefeed_images_*` | What the last [image store clean-up](storage.md#cleaning-up-the-image-store) found. |
| `notefeed_nodejs_*`, `notefeed_process_*` | Event-loop lag, memory, CPU, garbage collection. |

No feed name, read id, note text or address is ever a label. A rule of thumb: the 95th percentile of `feed_page` over 200 ms for feeds under 1000 notes means reading notes is worth optimising; look at a few days of real use first.

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
