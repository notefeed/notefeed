---
status: accepted
date: 2026-11-20
decision-makers: Marcel Bruckner
---

# The server fetches a public file for a post

## Context and Problem Statement

An assistant gives a picture as base64 in `data`, which costs every byte as output tokens, or as an upload (ADR 0064), which needs a shell that can run `curl`. An assistant without a shell (claude.ai with code execution off, many MCP clients) can post a picture that is already public on the web only as base64, shrunk until it fits. ADR 0064 left `source_url` for later because the server fetching a URL on a caller's behalf is its own security surface: server-side request forgery. Issue #422.

## Considered Options

* `source_url` on the MCP tools, fetched by the server under strict rules.
* No fetching: such an assistant keeps using base64.

## Decision Outcome

Chosen option: `source_url`, as a third way to give a file wherever `data` and `upload_id` are taken (`post_file`, `post_note`'s attachments, `set_feed_image`), exactly one of the three. The fetch (`backend/fetchurl.ts`) follows these rules:

* **Admitted first**: the feed's access, counted as a post against the rate limit, and for a picture whose `type` is given, image uploads on and a license where licenses are sold (`fetchSource` in `backend/posting.ts`, the same check as `create_upload`). No one makes the server fetch for a feed they can't post to.
* **Only `https` on port 443**, no user name or password in the URL.
* **Only public addresses**: IPv4 without the private, loopback, link-local (cloud metadata), carrier-grade NAT, documentation, benchmarking, multicast and reserved ranges; IPv6 only inside global unicast (`2000::/3`), less Teredo, 6to4 and documentation, which also refuses IPv4-mapped and NAT64 addresses. An IP literal in the URL is checked as written; a host name is checked by every address DNS gives, and the connection goes to the address that was checked, through the request's own `lookup`, with no pooled connection, so a second lookup can't swap it (DNS rebinding).
* **Redirects**: at most 3, each a new request checked the same way.
* **Size and time**: the image limit (`NOTEFEED_MAX_IMAGE_BYTES`; markdown's 100 KB is checked by the post), refused by `Content-Length` before reading and while reading; 15 seconds for the whole fetch; at most 4 fetches at once (busy past that).
* **No credentials**: no cookies or authorization, a fixed `User-Agent`.
* **The type**: `type` when given (the post checks the bytes' signature against it), else the site's `Content-Type`; the post then runs every check a post with `data` runs.
* **`NOTEFEED_FETCH_URLS=0`** turns it off. It is on by default: the rules above keep it to public sites, and an instance on a private network reaches nothing private through it.

REST and the client packages don't get `source_url`: a script has the file or downloads it itself, and posts it in the request's body, as ADR 0064 decided for uploads.

### Consequences

* Good, because an assistant without a shell can post a public picture at full size, for no more tokens than its URL.
* Bad, because the server now makes requests to other sites on a caller's behalf: the site sees the instance's address. The rules above are what keeps that to public files.
* Bad, because a fetch counts as a post against the rate limit, and the post that follows counts again, as with uploads.

### Confirmation

`backend/fetchurl.test.ts` checks the address rules (private, loopback, link-local, metadata, mapped, NAT64, documentation ranges), the scheme, port and user-name refusals, the size limit by `Content-Length` and while reading, the deadline, redirects (checked, limited), a host name that resolves to a private address refused before any connection, and a request without credentials. `backend/mcp.test.ts` covers the three tools taking `source_url`, the refusals before any fetch (a wrong password, the switch off), the type, and exactly one source; `backend/licensing.test.ts` that a picture by URL needs a license before anything is fetched.
