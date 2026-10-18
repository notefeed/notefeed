# Configuration

notefeed is configured with environment variables, under `environment:` in `compose.yaml` or in a `.env` file next to it. None is required: with none set, notefeed runs as an open instance. An empty value counts as unset.

## The instance

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | from the request | The base URL used in links, e.g. `https://notes.example.com`. Set it on a public instance, see [below](#public_url). |
| `NOTEFEED_PASSWORD` | none: open | The instance password: posting needs it as a bearer token, the web UI needs a login. Read links stay open. See [Passwords and access](access.md#the-password). |
| `NOTEFEED_SECRET` | random, kept in `DATA_DIR/.secret` | The server secret, at least 32 characters (`openssl rand -hex 32`). Required with a database backend. It signs unlock cookies and MCP tokens, and older feeds' read links derive from it, so changing it changes those. |
| `NOTEFEED_TRUST_PROXY` | off | `1` behind a reverse proxy: rate limits per client from `X-Forwarded-For`, and links follow `X-Forwarded-Proto` and `X-Forwarded-Host`. See [Reverse proxy](reverse-proxy.md). |
| `NOTEFEED_TITLE` | `notefeed` | Title of the RSS feed and the read-only view for a feed without a title of its own. |
| `TZ` | `UTC` | Time zone of the times shown in the web UI, e.g. `Europe/Berlin`. |
| `DATA_DIR` | `/data` | The folder holding the feeds (file storage), or the default place of the SQLite file. |
| `PUID`, `PGID` | owner of `DATA_DIR` | The user notefeed runs as, and so the owner of new note files. Docker image only. |

## Limits and caps

See [Rate limits and caps](limits.md).

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_RATE_LIMIT` | `60` | Posts, edits and deletes per client per minute, and separately wrong passwords. `0` turns it off. |
| `NOTEFEED_MAX_FEEDS` | `0`: no limit | Most feeds on the instance; beyond it a new feed answers `507`. |
| `NOTEFEED_MAX_NOTES_PER_FEED` | `0`: no limit | Most notes in one feed. |
| `NOTEFEED_MAX_IMAGE_BYTES` | `5242880` (5 MiB) | Largest picture, at most 10 MiB. |
| `NOTEFEED_MAX_IMAGES_PER_FEED` | `0`: no limit | Most image notes in one feed. |
| `NOTEFEED_SHRINK_IMAGE_BYTES` | `1048576` (1 MiB) | The size the web pages shrink a picture to before uploading it; `0` sends pictures as they are. |
| `NOTEFEED_IMAGE_UPLOADS` | on | `0` refuses every picture with `403` (`images_off`); stored ones keep being served. |
| `NOTEFEED_ALLOW_CUSTOM_IDS` | on | `0` leaves only random [read ids](../using/read-links.md#choosing-a-feeds-read-id). |
| `NOTEFEED_PARSE_TIMEOUT_MS` | `10000` | How long reading a text posted with pictures may take; past it the post is `400`. |

## Feeds and pages

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_RESERVED_FEEDS` | empty | Comma-separated names nobody can create, e.g. `news,announcements`. See [Reserved feeds](access.md#reserved-feeds). |
| `NOTEFEED_RESERVED_PASSWORD` | none | With it, each reserved name exists from start-up as a protected feed with its name as read id. |
| `NOTEFEED_IMPRINT_FILE`, `NOTEFEED_PRIVACY_FILE`, `NOTEFEED_TERMS_FILE` | none | A Markdown file each, shown at `/imprint`, `/privacy` and `/terms`. See [Imprint, privacy page and terms](legal-pages.md). |
| `NOTEFEED_NOTICE_FILE` | none | A Markdown file shown as a red banner on the start page. |
| `NOTEFEED_REPORT_URL` | none | A URL template for a **Report** link on every note, with `{read_id}`, `{note_id}` and `{file}` filled in. See [A report link on every note](legal-pages.md#a-report-link-on-every-note). |
| `NOTEFEED_REPORT_ENDPOINT` | none | Where the built-in report page `/report` sends a report. |
| `NOTEFEED_OPERATOR_TOKEN` | none | At least 32 characters. Turns on the operator's endpoints: the [image store clean-up](storage.md#cleaning-up-the-image-store) and [removing a feed](deleting.md#removing-a-feed-as-the-operator). |

## Sign-in

See [Sign-in and sender](sign-in/index.md). Sign-in is on only when all four of the first row are set.

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_OIDC_ISSUER`, `NOTEFEED_OIDC_CLIENT_ID`, `NOTEFEED_OIDC_CLIENT_SECRET`, `NOTEFEED_OIDC_ALLOW` | none: off | Your OpenID Connect provider and who may sign in. Needs `PUBLIC_URL` and `NOTEFEED_SECRET`. |
| `NOTEFEED_OIDC_LABEL` | the issuer's host | The text after **Sign in with** on the button. |
| `NOTEFEED_OIDC_SENDER_CLAIM` | `name,email` | The id_token claims tried in order for the sender shown on notes. |
| `NOTEFEED_OIDC_<NAME>_…` | none | [Further providers](sign-in/setup.md#several-providers), with a name of your choosing. |

## Storage

See [Storage](storage.md).

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_STORAGE` | `fs` | `fs` (files in `DATA_DIR`), `sqlite` or `postgres`. |
| `NOTEFEED_DATABASE_URL` | SQLite: `DATA_DIR/notefeed.db` | The database: `file:/data/notefeed.db` or `postgres://user:password@host:5432/dbname`. Required for `postgres`. |
| `NOTEFEED_IMAGES` | `db` | Where a database backend keeps image bytes: `db`, `fs` or `s3`. |
| `NOTEFEED_IMAGES_DIR` | `DATA_DIR/images` | The folder for `NOTEFEED_IMAGES=fs`. |
| `NOTEFEED_S3_ENDPOINT`, `NOTEFEED_S3_BUCKET`, `NOTEFEED_S3_ACCESS_KEY`, `NOTEFEED_S3_SECRET_KEY` | none | The object store for `NOTEFEED_IMAGES=s3`, all four required. |
| `NOTEFEED_S3_REGION` | `us-east-1` | The region the store expects in a request's signature. |
| `NOTEFEED_ENCRYPTION_KEY` | none: off | The main key of [encryption at rest](storage.md#encryption-at-rest), at least 32 characters (`openssl rand -hex 32`), not the same as `NOTEFEED_SECRET`, and without a comma. Needs `sqlite` or `postgres`. Losing it loses the data. |
| `NOTEFEED_ENCRYPTION_OLD_KEYS` | none | Former main keys, comma-separated, for the one start after [changing the main key](storage.md#changing-the-main-key) or [moving it to OpenBao](storage.md#the-main-key-in-openbao). |
| `NOTEFEED_KMS` | none: the local key | `openbao`: the main key is in [OpenBao](storage.md#the-main-key-in-openbao) instead of `NOTEFEED_ENCRYPTION_KEY`, which must then be empty. Needs `sqlite` or `postgres`. |
| `NOTEFEED_OPENBAO_ADDR` | none | OpenBao's address, e.g. `https://bao.internal:8200`. Required for `openbao`. For a certificate of a private CA, add the CA with `NODE_EXTRA_CA_CERTS`. |
| `NOTEFEED_OPENBAO_ROLE_ID`, `NOTEFEED_OPENBAO_SECRET_ID` | none | notefeed's AppRole. Both required for `openbao`. |
| `NOTEFEED_OPENBAO_MOUNT` | `transit` | Where the Transit engine is mounted. |
| `NOTEFEED_OPENBAO_KEY` | `notefeed` | The Transit key's name; it must be derived (`derived=true`). |

## Operating

| Variable | Default | Meaning |
|---|---|---|
| `NOTEFEED_LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` or `silent`. See [Logs](operating.md#logs). |
| `NOTEFEED_LOG_REQUESTS` | on | `0` turns off the line logged for every request. |
| `NOTEFEED_METRICS` | off | `1` turns on `GET /metrics`. See [Metrics](operating.md#metrics). |
| `NOTEFEED_METRICS_TOKEN` | none | With metrics on, `/metrics` needs `Authorization: Bearer <token>`. Set one unless the proxy keeps `/metrics` private. |

## `PUBLIC_URL`

When `PUBLIC_URL` is unset, notefeed builds links from the `Host` header over `http`; with `NOTEFEED_TRUST_PROXY=1` it uses the proxy's `X-Forwarded-Proto` and `X-Forwarded-Host` first.

!!! warning "Set `PUBLIC_URL` on a public instance"
    Otherwise the links in the RSS feed, in API responses and in redirects follow whatever `Host` header the client sent, and a cache in front could hand those links to everyone.

Also set it when feed readers reach notefeed by a different address than people do, for example over the LAN.
